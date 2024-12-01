const io = require('socket.io-client')
// const { Socket } = require('socket.io') // Server-side
const mediasoupClient = require('mediasoup-client')

const roomName = window.location.pathname.split('/')[2]

const baseURL = `${window.location.protocol}//${window.location.hostname}${window.location.port ? ':' + window.location.port : ''}`;
console.log(baseURL); // https://127.0.0.1:3000

const thisNamespace = '/SFU_2'
const socket_main = io(thisNamespace)
// let socket_secondary // = io("/anotherSFU")
let socket_ = []

socket_main.on('connection-success', ({ socketId }) => {
    console.log("Connection Success. Socket: ", socketId)
    getLocalStream()
})

let device
let rtpCapabilities
let audioProducers = []
let videoProducers = []
let producerTransports = []
// let numProducerTransports; // Not needed
// let producerTransport_primary
// let producerTransport_secondary
let consumerTransports = []

// https://mediasoup.org/documentation/v3/mediasoup-client/api/#ProducerOptions
// https://mediasoup.org/documentation/v3/mediasoup-client/api/#transport-produce
let params = {
    encodings: [
        {
            rid: 'r0',
            maxBitrate: 100000,
            scalabilityMode: 'S1T3'
        },
        {
            rid: 'r1',
            maxBitrate: 300000,
            scalabilityMode: 'S1T3'
        },
        {
            rid: 'r2',
            maxBitrate: 900000,
            scalabilityMode: 'S1T3'
        }
    ],
    // https://mediasoup.org/documentation/v3/mediasoup-client/api/#ProducerCodecOptions
    codecOptions: {
        videoGoogleStartBitrate: 1000
    }
}

let audioParams;
let videoParams = { params };
let consumingTransports = []; // ? should be dealt with when closing transport

const joinRoom = (socket, isFirst) => {
    socket.emit('joinRoom', { roomName, consumeHere: isFirst }, (data) => {
        console.log(`Router RTP Capabilities... ${data.rtpCapabilities}`)
        rtpCapabilities = data.rtpCapabilities
        if (isFirst) {
            // rtpCapabilities = data.rtpCapabilities
            createDevice()
        } else {
            console.log("Joined different room.")
            createSendTransport(socket, false)
        }
    })
}

// Let's not assign twice
const streamSuccess = (stream) => {
    localVideo.srcObject = stream // ? 

    // audioParams = { track: stream.getAudioTracks()[0], ...audioParams };
    videoParams = { track: stream.getVideoTracks()[0], ...videoParams };

    joinRoom(socket_main, true)
}

const getLocalStream = () => {
    navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
            width: {
                min: 640,
                max: 1920,
            },
            height: {
                min: 360,
                max: 1080,
            }
        }
    })
    .then(streamSuccess)
    .catch(error => {
        console.log(error.message)
    })
}

async function createDevice() {
    try {
        device = new mediasoupClient.Device()
        await device.load({
            routerRtpCapabilities: rtpCapabilities
        })
        console.log('Device RTP Capabilities', device.rtpCapabilities)
        
        // Directly pass in the socket_main due to the architectural design
        createSendTransport(socket_main, true)
    } catch (error) {
        console.log(error)
        if (error.name === 'UnsupportedError')
            console.warn('browser not supported')
    }
}

const createSendTransport = (socket, isFirstTransport) => {
    // see server's socket.on('createWebRtcTransport', sender?, ...)
    // this is a call from Producer, so sender = true
    socket.emit('createWebRtcTransport', { consumer: false }, ({ params }) => {
        // The server sends back params needed 
        // to create Send Transport on the client side
        if (params.error) {
            console.log(params.error)
            return
        }

        // console.log("Parameters from the server: ", params)

        // creates a new WebRTC Transport to send media
        // based on the server's producer transport params
        // https://mediasoup.org/documentation/v3/mediasoup-client/api/#TransportOptions
        // ???!!! Make sure it's assigned to the right transport
        const producerTransport = device.createSendTransport(params)
        // producerTransport = {
        //     producerTransport,
        //     hasProduced: false,
        // }
        producerTransports.push({producerTransport, hasProduced: false})
        // numProducerTransports = producerTransports.length

        // https://mediasoup.org/documentation/v3/communication-between-client-and-server/#producing-media
        // this event is raised when a first call to transport.produce() is made
        // see connectSendTransport() below
        producerTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
            try {
                // Signal local DTLS parameters to the server side transport
                // see server's socket.on('transport-connect', ...)
                console.log("Event \"transport-connect\" is to be emitted.")
                await socket.emit('transport-connect', {
                    dtlsParameters,
                },
                (SFUInfo) => {
                    if (isFirstTransport) { // The second time and later transport creation doesn't need to do this again.
                        // No matter what, clients should establish connection with another SFU (in development)
                        const filteredInfo = SFUInfo.filter(info => info.namespace !== thisNamespace);
                        
                        // // Create an object with the results
                        // const otherSFUinfo = {
                        //     namespace: filteredInfo.map(info => info.namespace),
                        //     url: filteredInfo.map(info => info.url)
                        // };

                        console.log(`Start establishing connection with other SFUs.`)
                        filteredInfo.forEach(async (info) => { // Use async function to allow for await
                            await new Promise((resolve) => setTimeout(resolve, 250)); // Sleep for 0.5 second
                            
                            const new_socket = io(`${info.url}${info.namespace}`)
                            console.log(`==== Connecting to ${info.url}${info.namespace} ====`)

                            new_socket.on('connection-success', ({ socketId }) => {
                                console.log("Connection Success. (with a new server) Socket: ", socketId)
                                joinRoom(new_socket, false)
                            })
    
                            // socket_secondary.on('new-producer', ({ producerId }) => signalNewConsumerTransport(socket_secondary, producerId))
    
                            // Needed?
                            // new_socket.on('producer-closed', ({ remoteProducerId }) => {
                            //     // server notification is received when a producer is closed
                            //     // we need to close the client-side consumer and associated transport
                            //     const producerToClose = consumerTransports.find(transportData => transportData.producerId === remoteProducerId)
                            //     producerToClose.consumerTransport.close()
                            //     producerToClose.consumer.close()
                            
                            //     // remove the consumer transport from the list
                            //     consumerTransports = consumerTransports.filter(transportData => transportData.producerId !== remoteProducerId)
                            //     consumingTransports = consumingTransports.filter(producerId => producerId !== remoteProducerId)
    
                            //     // remove the video div element
                            //     videoContainer.removeChild(document.getElementById(`td-${remoteProducerId}`))
                            // })

                            socket_.push(new_socket);
                        })
                    }
                })
                // Tell the transport that parameters were transmitted.
                callback()

            } catch (error) {
                errback(error)
            }
        })

        producerTransport.on('produce', async (parameters, callback, errback) => {
            console.log(parameters)
            try {
                // tell the server to create a Producer
                // with the following parameters and produce
                // and expect back a server side producer id
                // see server's socket.on('transport-produce', ...)
  	   
                // If isFirstTransport === true, servedByCurrSFU === true
                const servedByCurrSFU = isFirstTransport ? true : false
                await socket.emit('transport-produce', {
                        kind: parameters.kind,
                        rtpParameters: parameters.rtpParameters,
                        appData: { servedByCurrSFU }
                    },
                    ({ id, producersExist }) => {
                        // Tell the client side transport that parameters were transmitted
                        // and provide it with the server side producer's id.
                        callback({ id })

                        // if producers exist, then join room?
                        if (isFirstTransport && producersExist) getProducers(socket) // Connect to existing producers
                    }
                )

            } catch (error) {
                errback(error)
            }
        })
        
        console.log("Start connecting send transport. isFirstTransport: ", isFirstTransport)
        // connectSendTransport(isFirstTransport)
        connectSendTransport()
    })
}

// const connectSendTransport = async (isFirstTransport) => {
const connectSendTransport = async () => {
    // we now call produce() to instruct the producer transport
    // to send media to the Router
    // https://mediasoup.org/documentation/v3/mediasoup-client/api/#transport-produce
    // this action will trigger the 'connect' and 'produce' events above
    
    // let producerTransport
    // if (isFirstTransport) {
    //     producerTransport = producerTransports[0]
    // } else {
    //     producerTransport = producerTransports[1]
    // }
    let transport = producerTransports[producerTransports.length - 1]
    if (transport.hasProduced) {
        console.error("Error. Transport already produced.")
        return;
    }
    const videoProducer = await transport.producerTransport.produce(videoParams);
    videoProducers.push(videoProducer)
    console.log("Video Producer created.")
    transport.hasProduced = true
    console.log(videoProducers.length)

    videoProducer.on('trackended', () => {
        console.log('Video track ended')
        // close video track
        // videoProducer.close()
    })

    videoProducer.on('transportclose', () => {
        console.log('Video transport closed')
        // close video track
        // videoProducer.close()
    })

    // producerTransports.forEach(async (transport) => {
    //     // const audioProducer = await producerTransport.produce(audioParams);
    //     // audioProducers.push(videoProducer)
    //     // console.log("Audio Producer created.")

    //     // audioProducer.on('trackended', () => {
    //     //     console.log('Audio track ended')
    //     //     // close audio track
    //     //     audioProducer.close()
    //     // })

    //     // audioProducer.on('transportclose', () => {
    //     //     console.log('Audio transport closed')
    //     //     // close audio track
    //     //     audioProducer.close()
    //     // })
        
    //     if (transport.hasProduced) continue;
    //     else {
    //         const videoProducer = await transport.producerTransport.produce(videoParams);
    //         videoProducers.push(videoProducer)
    //         console.log("Video Producer created.")
    //         transport.hasProduced = true
    //         console.log(videoProducers.length)

    //         videoProducer.on('trackended', () => {
    //             console.log('Video track ended')
    //             // close video track
    //             // videoProducer.close()
    //         })

    //         videoProducer.on('transportclose', () => {
    //             console.log('Video transport closed')
    //             // close video track
    //             // videoProducer.close()
    //         })
    //     }
    // })
}

// ********************************************************************************

const signalNewConsumerTransport = async (socket, remoteProducerId) => {
    // check if we are already consuming the remoteProducerId
    if (consumingTransports.includes(remoteProducerId)) return;
    // consumingTransports.push(remoteProducerId);

    await socket.emit('createWebRtcTransport', { consumer: true }, ({ params }) => {
        // The server sends back params needed to create Recv Transport on the client side
        if (params.error) {
            console.log(params.error)
            return
        }
        console.log("Parameters: ", params)

        let consumerTransport
        try {
            consumerTransport = device.createRecvTransport(params)
        } catch (error) {
            // exceptions: 
            // {InvalidStateError} if not loaded
            // {TypeError} if wrong arguments.
            console.log(error)
            return
        }

        // The transport will emit “connect” if this is the first call to transport.consume().
        consumerTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
            try {
                // Signal local DTLS parameters to the server side transport
                // see server's socket.on('transport-recv-connect', ...)
                await socket.emit('transport-recv-connect', {
                    dtlsParameters,
                    serverConsumerTransportId: params.id,
                })

                consumingTransports.push(remoteProducerId);
                
                // Tell the transport that parameters were transmitted.
                callback()
            } catch (error) {
                // Tell the transport that something was wrong
                errback(error)
            }
        })
        
        // Unlike createSendTransport, no 'produce' event will be triggered here

        connectRecvTransport(socket, consumerTransport, remoteProducerId, params.id)
    })
}

// Server informing the client a new producer just joined
// The client use this instead of getProucers() later 
socket_main.on('new-producer', ({ producerId }) => signalNewConsumerTransport(socket_main, producerId))

// Get all the other producers in the room
// Called when joining the room for the first time
const getProducers = (socket) => {
    socket.emit('getProducers', producerIds => {
        console.log("Producers in the room: ", producerIds)
        // for each of the producer create a consumer
        // producerIds.forEach(id => signalNewConsumerTransport(id))
        producerIds.forEach(producerId => { signalNewConsumerTransport(socket_main, producerId) })
    })
}

const connectRecvTransport = async (socket, consumerTransport, remoteProducerId, serverConsumerTransportId) => {
    // for consumer, we need to tell the server first
    // to create a consumer based on the rtpCapabilities and consume
    // if the router can consume, it will send back a set of params as below
    await socket.emit('consume', {
            rtpCapabilities: device.rtpCapabilities,
            remoteProducerId,
            serverConsumerTransportId,
        },
        async ({ params }) => {
            if (params.error) {
                console.log('Cannot Consume')
                return
            }
            // console.log(`Consumer parameters: ${params}`)
            console.log("Consumer parameters received")
            
            // then consume with the local consumer transport which creates a consumer
            const consumer = await consumerTransport.consume({
                id: params.id,
                producerId: params.producerId,
                kind: params.kind,
                rtpParameters: params.rtpParameters
            })
            
            consumerTransports = [
                ...consumerTransports,
                {
                    consumerTransport,
                    serverConsumerTransportId: params.id,
                    producerId: remoteProducerId,
                    consumer,
                },
            ]

            // create a new div element for the new consumer media
            const newElem = document.createElement('div')
            newElem.setAttribute('id', `td-${remoteProducerId}`)

            if (params.kind == 'audio') {
                //append to the audio container
                newElem.innerHTML = '<audio id="' + remoteProducerId + '" autoplay></audio>'
            } else {
                //append to the video container
                newElem.setAttribute('class', 'remoteVideo')
                newElem.innerHTML = '<video id="' + remoteProducerId + '" autoplay class="video"></video>'
            }

            videoContainer.appendChild(newElem)

            // destructure and retrieve the video track from the producer
            const { track } = consumer

            document.getElementById(remoteProducerId).srcObject = new MediaStream([track])

            // the server consumer started with media paused so we need to inform the server to resume
            socket.emit('consumer-resume', { serverConsumerId: params.serverConsumerId })
        }
    )
}

socket_main.on('producer-closed', ({ remoteProducerId }) => {
    // server notification is received when a producer is closed
    // we need to close the client-side consumer and associated transport
    const producerToClose = consumerTransports.find(transportData => transportData.producerId === remoteProducerId)
    producerToClose.consumerTransport.close()
    producerToClose.consumer.close()

    // remove the consumer transport from the list
    consumerTransports = consumerTransports.filter(transportData => transportData.producerId !== remoteProducerId)
    consumingTransports = consumingTransports.filter(producerId => producerId !== remoteProducerId)

    // remove the video div element
    videoContainer.removeChild(document.getElementById(`td-${remoteProducerId}`))
})