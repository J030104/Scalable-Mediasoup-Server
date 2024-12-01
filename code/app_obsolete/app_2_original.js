import express from 'express'
const app = express()

import https from 'httpolyglot'
import fs from 'fs'
import path from 'path'
const __dirname = path.resolve()

import { Server } from 'socket.io'
import mediasoup from 'mediasoup'
import cors from 'cors'

const IP = '192.168.100.100'
const port = 7000
const rtcPorts = [8000, 8999]
const primaryURL = 'https://192.168.100.100:5000'
// const primaryPort = 5000
// const limit = 1 // When the limit is reached, the room is full

app.use(cors())

app.get('/sfu/*', (req, res, next) => {
    const path = '/sfu/'

    if (req.path.indexOf(path) == 0 && req.path.length > path.length) return next()
    res.send(`You need to specify a room name in the path e.g. 'https://ipaddr:${port}/sfu/room'`)
})

app.use('/sfu/:room', express.static(path.join(__dirname, 'public')))

const options = {
    key: fs.readFileSync('./server/ssl/key.pem', 'utf-8'),
    cert: fs.readFileSync('./server/ssl/cert.pem', 'utf-8'),
    passphrase: 'mediasoup',
}

const httpsServer = https.createServer(options, app)
httpsServer.listen(port, () => {
    console.log('HTTP server is listening on port: ' + port)
})

const io = new Server(httpsServer, {
    cors: {
        origin: true,
        methods: '*'
    }
});

const localPeers = io.of('/currentSFU')
const remotePeers = io.of('/anotherSFU')

let worker
let rooms = {}
// { roomName1: {
//      Router,
//      peers: [ socketId1, ... ] (not rooms)
//   },
//   ...
// }

let peers = {}          
// { socketId1: {
//      socket,
//      roomName1,
//      transports: [id1, id2, ...], 
//      producers: [id1, id2, ...],
//      consumers: [id1, id2, ...],
//      peerDetails: {
//         name,
//         isAdmin,
//      }
//   },
//   ...
// }

let transports = []     // [ { socketId1, roomName1, transport, consumer }, ... ] (consumer is a boolean)
let producers = []      // [ { socketId1, roomName1, producer, }, ... ]
let consumers = []      // [ { socketId1, roomName1, consumer, }, ... ]

const createWorker = async () => {
    worker = await mediasoup.createWorker({
        rtcMinPort: rtcPorts[0],
        rtcMaxPort: rtcPorts[1],
    })
    console.log(`Worker PID: ${worker.pid}`)

    worker.on('died', error => {
        // This implies something serious happened, so kill the application
        console.error('Mediasoup worker has died, exiting in 2 seconds...', error)
        setTimeout(() => process.exit(1), 2000) // exit in 2 seconds
    })

	// to connect to the main SFU 
    worker.observer.on('newrouter', router => {
        console.log('A new router was created')
    })

    return worker
}

worker = createWorker()

const mediaCodecs = [ // Used to create a router (Room)
    {
        kind: 'audio',
        mimeType: 'audio/opus',
        clockRate: 48000,
        channels: 2,
    },
    {
        kind: 'video',
        mimeType: 'video/VP8',
        clockRate: 90000,
        parameters: {
            'x-google-start-bitrate': 1000,
        },
    },
]

const handleConnections = (connections, isLocal) => {
    connections.on('connection', async socket => {
        console.log("===============================================")
        console.log(`NEW CONNECTION - Socket ID: ${socket.id}`)
        console.log("===============================================")

        // Send back the socket id to the client
        socket.emit('connection-success', {
            socketId: socket.id,
        })

        // Who triggers this?
        socket.on('disconnect', () => {
            // do some cleanup
            console.log('peer disconnected')
            consumers = removeItems(consumers, socket.id, 'consumer')
            producers = removeItems(producers, socket.id, 'producer')
            transports = removeItems(transports, socket.id, 'transport')

            // console.log('peer id:', socket.id)
            if (peers[socket.id]) { // Do this to avoid errors
                const { roomName } = peers[socket.id]
                delete peers[socket.id]

                // remove socket from room
                rooms[roomName] = {
                    router: rooms[roomName].router,
                    peers: rooms[roomName].peers.filter(socketId => socketId !== socket.id)
                }
            }
        })
        
        // Use async to make this process non-blocking
        socket.on('joinRoom', async ({ roomName }, callback) => {
            // create Router if it does not exist
            // const router1 = rooms[roomName] && rooms[roomName].get('data').router || await createRoom(roomName, socket.id)
            const router1 = await createRoom(roomName, socket.id) // Use await to ensure the room is created before proceeding
            
            // If a peer joins a room, record everything about them
            peers[socket.id] = {
                socket,
                roomName,           // Name for the Router this Peer joined
                transports: [],
                producers: [],
                consumers: [],
                peerDetails: {
                    name: '',
                    isAdmin: false,   // Is this Peer the Admin?
                }
            }

            // get Router RTP Capabilities
            const rtpCapabilities = router1.rtpCapabilities

            // call callback from the client and send back the rtpCapabilities
            callback({ rtpCapabilities })
        })

        // Client emits a request to create server side Transport
        // We need to differentiate between the producer and consumer transports
        socket.on('createWebRtcTransport', async ({ consumer }, callback) => {
            // get Room Name from Peer's properties
            const roomName = peers[socket.id].roomName

            // get Router (Room) object this peer is in based on RoomName
            const router = rooms[roomName].router
            
            // console.log(`Start creating WebRTC ${consumer ? "Recv" : "Send"} Transport`)
            createWebRtcTransport(router).then(
                transport => {
                    callback({
                        params: {
                            id: transport.id,
                            iceParameters: transport.iceParameters,
                            iceCandidates: transport.iceCandidates,
                            dtlsParameters: transport.dtlsParameters,
                        }
                    })

                    // add transport to Peer's properties
                    addTransport(socket, transport, roomName, consumer)
                },
                error => {
                    console.log(error)
                    callback({
                        params: {
                            error: error
                        }
                    })
                }
            )
        })

		// see client's socket.emit('transport-connect', ...)
        socket.on('transport-connect', ({ dtlsParameters }, callback) => {
            // console.log('DTLS Parameters: ', { dtlsParameters })
            getTransport(socket.id).connect({ dtlsParameters })
            // testing, client will establish connection with another server
            callback(primaryURL)
        })

        // see client's socket.emit('transport-produce', ...)
        socket.on('transport-produce', async ({ kind, rtpParameters, appData }, callback) => {
            // call produce based on the prameters from the client
            const producer = await getTransport(socket.id).produce({
                kind,
                rtpParameters,
            })

            // add producer to the producers array
            const { roomName } = peers[socket.id]
            addProducer(socket, producer, roomName, appData.servedByCurrSFU)

            informConsumers(roomName, socket.id, producer.id)

            // console.log('Producer ID: ', producer.id) // Already printed in `informConsumers` 
            // console.log("Producer's kind: ", producer.kind) // Video and audio are different producers
            console.log("-")

            producer.on('transportclose', () => {
                producer.close()
                console.log(`The transport for producer ${producer.id} is closed.`)
            })
            
            try {
                // Send back to the client the Producer's id
                callback({
                    id: producer.id,
                    producersExist: producers.length > 1 ? true : false
                })
            } catch (error) {
                console.log(error)
            }
        })
        
        if (isLocal) { // Like a double check (since both the clients and the servers care about this) 
            // Only local peers need this (used right after they first produce)
            socket.on('getProducers', callback => {
                //return all producer transports
                const { roomName } = peers[socket.id]

                let producerList = []
                producers.forEach(producerData => {
                    if (producerData.socketId !== socket.id && producerData.roomName === roomName) {
                        producerList = [...producerList, producerData.producer.id]
                    }
                })

                // return the producer list back to the client
                callback(producerList)
            })

            // see client's socket.emit('transport-recv-connect', ...)
            socket.on('transport-recv-connect', async ({ dtlsParameters, serverConsumerTransportId }) => {
                // console.log(`DTLS PARAMS: ${dtlsParameters}`)
                const consumerTransport = transports.find(transportData => (
                    transportData.isConsumer && transportData.transport.id == serverConsumerTransportId
                )).transport
                await consumerTransport.connect({ dtlsParameters })
            })

            socket.on('consume', async ({ rtpCapabilities, remoteProducerId, serverConsumerTransportId }, callback) => {
                try {
                    const { roomName } = peers[socket.id]
                    const router = rooms[roomName].router
                    let consumerTransport = transports.find(transportData => (
                        transportData.isConsumer && transportData.transport.id == serverConsumerTransportId
                    )).transport

                    // check if the router can consume the specified producer ? the term
                    if (router.canConsume({
                        producerId: remoteProducerId,
                        rtpCapabilities
                    })) {
                        // transport can now consume and return a consumer
                        const consumer = await consumerTransport.consume({
                            producerId: remoteProducerId,
                            rtpCapabilities,
                            paused: true,
                        })

                        consumer.on('transportclose', () => { // ?
                            console.log('Transport closed from consumer')
                        })

                        consumer.on('producerclose', () => {
                            console.log('A producer closed')
                            socket.emit('producer-closed', { remoteProducerId })

                            consumerTransport.close()
                            transports = transports.filter(transportData => transportData.transport.id !== consumerTransport.id)
                            consumer.close()
                            consumers = consumers.filter(consumerData => consumerData.consumer.id !== consumer.id)
                        })

                        addConsumer(socket, consumer, roomName)

                        // from the consumer extract the following params
                        // to send back to the Client
                        const params = {
                            id: consumer.id,
                            producerId: remoteProducerId,
                            kind: consumer.kind,
                            rtpParameters: consumer.rtpParameters,
                            serverConsumerId: consumer.id,
                        }

                        // send the parameters to the client
                        callback({ params })
                    }
                } catch (error) {
                    console.log(error.message)
                    callback({
                        params: {
                            error: error
                        }
                    })
                }
            })

            socket.on('consumer-resume', async ({ serverConsumerId }) => {
                const { consumer } = consumers.find(consumerData => consumerData.consumer.id === serverConsumerId)
                await consumer.resume()
                // console.log(`Consumer ${serverConsumerId} resumed.`)
                // setTimeout(async () => {
                //     await consumer.resume()
                // }, 2000)
            })
        }
    })
}

async function createRoom(roomName, socketId) {
    let router1
    let peers = []
    if (rooms[roomName]) { // The room already exists
        router1 = rooms[roomName].router
        peers = rooms[roomName].peers || [] // ? ...peers
    } else {
        router1 = await worker.createRouter({ mediaCodecs, })
        console.log(`Router ID: ${router1.id}`)
        console.log("===============================================")
    }

    // console.log(`There were ${peers.length} peers.`)
    // console.log("===============================================")
    
    // No matter what, update the room with the new peer
    rooms[roomName] = {
        router: router1,
        peers: [...peers, socketId], // Append 
    }

    return router1
}

async function createWebRtcTransport(router) {
    return new Promise(async (resolve, reject) => {
        try {
            // https://mediasoup.org/documentation/v3/mediasoup/api/#WebRtcTransportOptions
            const WebRtcTransport_options = {
                // DEPRECATED: Use TransportListenInfo instead.
                // listenIps: [
                //     {
                //         ip: '0.0.0.0', // replace with relevant IP address // ?
                //         announcedIp: '10.0.0.115',
                //     }
                // ],
                // If you use “0.0.0.0” or “::” as ip value, then you need to also provide announcedAddress
                // announcedAddress is the IP address the client should connect to.
                listenInfos: [
                    {
                        ip: '0.0.0.0',
                        announcedAddress: IP, // Under same subnet, private IP can work
                        
                        // ip: '127.0.0.1', // This doesn't work
                        // announcedAddress: '127.0.0.1', // This points to the local machine, works.
                        
                        /**
                         * Wireless LAN adapter Wi-Fi:
                         *    Connection-specific DNS Suffix  . :
                         *    Link-local IPv6 Address . . . . . : fe80::be1d:215f:6f2a:cc1%21
                         *    IPv4 Address. . . . . . . . . . . : 192.168.100.101
                         *    Subnet Mask . . . . . . . . . . . : 255.255.255.0
                         *    Default Gateway . . . . . . . . . : 192.168.100.1
                         */

                        // announcedAddress: '172.25.0.2', // Not exposed, only used in docker network
                        // announcedAddress: '180.177.241.217', // Public IP doesn't if not registered
                    }
                ],
                enableUdp: true,
                enableTcp: true,
                preferUdp: true,
            }

            // https://mediasoup.org/documentation/v3/mediasoup/api/#router-createWebRtcTransport
            let transport = await router.createWebRtcTransport(WebRtcTransport_options)
            // console.log(`A new transport ID: ${transport.id}`)

            transport.on('dtlsstatechange', dtlsState => {
                if (dtlsState === 'closed') {
                    transport.close()
                }
            })

            transport.on('close', () => {
                console.log('Transport closed')
            })

            resolve(transport)

        } catch (error) {
            reject(error)
        }
    })
}

function addTransport(socket, transport, roomName, isConsumer) {
    transports = [
        ...transports,
        { socketId: socket.id, transport, roomName, isConsumer, }
    ]

    peers[socket.id] = {
        ...peers[socket.id],
        transports: [
            ...peers[socket.id].transports,
            transport.id,
        ]
    }
}

function addProducer(socket, producer, roomName, servedByCurrSFU) {
    producers = [
        ...producers,
        { socketId: socket.id, producer, roomName, servedByCurrSFU}
    ]

    peers[socket.id] = {
        ...peers[socket.id],
        producers: [
            ...peers[socket.id].producers,
            producer.id,
        ]
    }
}

function addConsumer(socket, consumer, roomName) {
    consumers = [
        ...consumers,
        { socketId: socket.id, consumer, roomName, }
    ]

    peers[socket.id] = {
        ...peers[socket.id],
        consumers: [
            ...peers[socket.id].consumers,
            consumer.id,
        ]
    }
}

function informConsumers(roomName, socketId, id) {
    // A new producer just joined
    console.log(`ID ${id} just joined room ${roomName}.`)
    console.log(`Socket: ${socketId}`)

    // let all consumers to consume this producer
    producers.forEach(producerData => {
        if (producerData.socketId !== socketId && producerData.roomName === roomName && producerData.servedByCurrSFU) {
            const producerSocket = peers[producerData.socketId].socket
            // use socket to send producer id to producer
            producerSocket.emit('new-producer', { producerId: id })
        }
    })
}

function getTransport(socketId) {
    // Use array destructuring to assign the first element of the filtered array to the variable producerTransport
    const [producerTransport] = transports.filter(transport => transport.socketId === socketId && !transport.isConsumer)
    return producerTransport.transport
}

function removeItems(items, socketId, type) {
    items.forEach(item => {
        if (item.socketId === socketId) {
            item[type].close()
        }
    })
    items = items.filter(item => item.socketId !== socketId)

    return items
}

handleConnections(localPeers, true)
handleConnections(remotePeers, false)
