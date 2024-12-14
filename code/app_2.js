import express from 'express'
import session from 'express-session'
import bodyParser from 'body-parser'
import cors from 'cors'
import https from 'httpolyglot'
import fs from 'fs'
import path from 'path'
import { Server } from 'socket.io'
import mediasoup from 'mediasoup'
import EventEmitter from 'events'

const app = express()
const __dirname = path.resolve()

// Obsolete
// const secondaryURL = 'https://192.168.100.100:7000'
// const localPeers = io.of('/currentSFU')
// const remotePeers = io.of('/anotherSFU')

const thisURL = 'https://140.118.138.79:4000'
const nextURL = 'https://140.118.138.79:5000'
const lastSFU = false
const URLs = ['https://140.118.138.79:3000', 'https://140.118.138.79:4000', 'https://140.118.138.79:5000']
const url = new URL(thisURL)
const IP = url.hostname
const port = url.port
const rtcPorts = [4001, 4100]

const staticFileFolderName = 'SFU_2'
const thisNamespace = '/' + staticFileFolderName
// const nextNamespace = '/SFU_2' // Not needed?
const namespaces = ['/SFU_1', '/SFU_2', '/SFU_3'] // Every participant will connect to all namespaces
const SFUInfo = namespaces.map((namespace, index) => ({
    namespace,
    url: URLs[index]
}));

// Testing
const localParticipants = []
const limit = 3 // When the limit is reached, redirect to the secondary SFU

// Middleware to parse application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cors())

app.get('/', (req, res, next) => {
    res.sendFile(path.join(__dirname, 'public', staticFileFolderName, 'lobby.html'));
});

app.post('/join', (req, res, next) => {
    // Here, you can process the form data, such as storing the user's name and room name
    const name = req.body.name;
    const _room = req.body.room;

    if (!_room) {
        res.status(400).send('Room name is required');
        // next() // Not this
        return
    } else {
        const room = _room.toLowerCase();

        // For this example, we'll just redirect to the conference room
        // req.session.joinedConference = true;
        res.redirect(`/vc/${room}`);
        // next()
    }
});

app.get('/vc/*', (req, res, next) => {
    const path = '/vc/'
    // Before proceeding, we have to ensure the last one has joined the room

    // console.log('Checking...')
    // A double check (has been checked at the front end)
    if (req.path.indexOf(path) === 0 && req.path.length > path.length) {
        if (numConsumers() >= limit) { // Redirect to the next SFU
            if (lastSFU === false && nextURL !== null) {
                const roomName = req.path.substring(path.length)
                const dest = `${nextURL}/vc/${roomName}`
                console.log('Redirecting...')
                return res.redirect(dest)
            } else { // If this is the last SFU
                console.log('Maximum participants reached.')
                return res.send(`Sorry, the room is full. Please try again later.`)
            }
        }
        console.log('Proceeding...')
        return next();
    } else { // If the path is not correct
        return res.send(`You are required to specify a room name in the path e.g. 'https://ipaddr:port/vc/room'`)
    }
})

app.use('/vc/:room', express.static(path.join(__dirname, 'public', staticFileFolderName)))

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

// Create an object to hold all namespace connections
const participantTypes = namespaces.reduce((acc, namespace) => {
    acc[namespace] = io.of(namespace);
    return acc;
}, {});


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
//         isProducerHere,
//         isAdmin,
//      }
//   },
//   ...
// }

let transports = []     // [ { socketId1, roomName1, transport, isConsumer }, ... ]
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

const handleConnections = (connections, isThisNamespace) => {
    connections.on('connection', async socket => {
        // await sleep(5000)
        console.log("===============================================")
        console.log(`NEW CONNECTION - Socket ID: ${socket.id}`)
        console.log("===============================================")

        // Send the socket id back to the client
        socket.emit('connection-success', {
            socketId: socket.id,
        })

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
        socket.on('joinRoom', async ({ roomName, isProducerHere }, callback) => {
            // create Router if it does not exist
            // const router1 = rooms[roomName] && rooms[roomName].get('data').router || await createRoom(roomName, socket.id)
            const router1 = await createRoom(roomName, socket.id) // Use await to ensure the room is created before proceeding

            // If a peer joins a room, record everything about them
            peers[socket.id] = {
                socket,
                roomName,              // Name for the Router this Peer joined
                transports: [],
                producers: [],
                consumers: [],
                peerDetails: {
                    name: '',
                    isProducerHere,       // Consume in this SFU
                    isAdmin: false,    // Is this Peer the Admin?
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

        if (isThisNamespace) { // Not all consumers need to produce.
            // see client's socket.emit('transport-connect', ...)
            socket.on('transport-connect', ({ dtlsParameters }, callback) => {
                // console.log('DTLS Parameters: ', { dtlsParameters })
                getTransport(socket.id).connect({ dtlsParameters })
                
                // testing, client will establish connection with another server
                // if (isThisNamespace) localParticipants.push("person") // WRONG
                callback(SFUInfo)
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
                addProducer(socket, producer, roomName)
                // console.log(servedByCurrSFU)

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
        }

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
            // console.log(`Consumer ${serverConsumerId} resum ed.`)
            
            // setTimeout(async () => {
            //     await consumer.resume()
            // }, 2000)
        })
    })
}

function numConsumers() {
    let count = 0;
    for (const peerId in peers) {
        if (peers[peerId].peerDetails.isProducerHere) {
            count++;
        }
    }
    return count;
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
                listenInfos: [
                    {
                        ip: '0.0.0.0',
                        announcedAddress: IP,
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

function addProducer(socket, producer, roomName) {
    producers = [
        ...producers,
        { socketId: socket.id, producer, roomName}
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
    // producers.forEach(producerData => {
    //     if (producerData.socketId !== socketId && producerData.roomName === roomName && producerData.servedByCurrSFU) {
    //         const producerSocket = peers[producerData.socketId].socket
    //         // use socket to send producer id to producer
    //         producerSocket.emit('new-producer', { producerId: id })
    //     }
    // })
    
    Object.values(peers).forEach((peerInfo) => {
        if (peerInfo.socket.id !== socketId && peerInfo.roomName === roomName) {
            const skt = peerInfo.socket;
            // use socket to send producer id to producer
            skt.emit("new-producer", { producerId: id });
        }
    });
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

// handleConnections(localPeers, true)
// handleConnections(remotePeers, false)

// Handle connections for all namespaces
Object.keys(participantTypes).forEach(namespace => {
    handleConnections(participantTypes[namespace], namespace === thisNamespace);
});

// handleConnections(participantTypes['/SFU_1'], true)
// handleConnections(participantTypes['/SFU_2'], false)
// handleConnections(participantTypes['/SFU_3'], false)
