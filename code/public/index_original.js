// index.js
const io = require('socket.io-client')
const mediasoupClient = require('mediasoup-client')

const roomName = window.location.pathname.split('/')[2]
/**
 * URL: https://example.com/a/b
 * pathname: /a/b
 * split('/'): ["", "a", "b"]
 */

const socket = io("/mediasoup")
/**
 * By default, if no URL is provided, Socket.IO will attempt to connect to 
 * the server that served the web page, using the same hostname and port.
 */

/**
 * Socket.IO is a real-time, bidirectional and event-based communication 
 * between web clients and servers.
 * 
 * "/mediasoup" specifies the namespace or path that this particular 
 * socket connection should connect to. Namespaces in Socket.IO are a way 
 * to divide the socket connections into different paths or channels.
 */

socket.on('connection-success', ({ socketId }) => {
    console.log("Connection Success. Socket: ", socketId)
    getLocalStream()
})

let device
let rtpCapabilities
let audioProducer
let videoProducer
let producerTransport
let consumerTransports = []
// NO LONGER NEEDED
// let consumer
// let isProducer = false

// https://mediasoup.org/documentation/v3/mediasoup-client/api/#ProducerOptions
// https://mediasoup.org/documentation/v3/mediasoup-client/api/#transport-produce
// mediasoup params
let params = {
    // track: videoTrack, // Will be added later
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
let consumingTransports = []; // ? Should be dealt with when closing transport

// ********************************************************************************
// Starting up
const streamSuccess = (stream) => {
    localVideo.srcObject = stream // ?

    audioParams = { track: stream.getAudioTracks()[0], ...audioParams };
    videoParams = { track: stream.getVideoTracks()[0], ...videoParams };

    joinRoom()
}

const joinRoom = () => {
    socket.emit('joinRoom', { roomName }, (data) => {
        console.log(`Router RTP Capabilities... ${data.rtpCapabilities}`)
        // we assign to local variable and will be used when
        // loading the client Device (see createDevice above)
        rtpCapabilities = data.rtpCapabilities // ? to be checked

        // once we have rtpCapabilities from the Router, create Device
        createDevice()
    })
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
    .then(streamSuccess) // stream is passed in
    .catch(error => {
        console.log(error.message)
    })
}
// Starting up
// ********************************************************************************

// A device is an endpoint connecting to a router on the server side to send/receive media
const createDevice = async () => {
    try {
        device = new mediasoupClient.Device()

        // https://mediasoup.org/documentation/v3/mediasoup-client/api/#device-load
        // Loads the device with RTP capabilities of the Router (server side)
        await device.load({
            // see getRtpCapabilities() below
            routerRtpCapabilities: rtpCapabilities
        })

        console.log('Device RTP Capabilities', device.rtpCapabilities)

        // once the device loads, create transport
        createSendTransport()

    } catch (error) {
        console.log(error)
        if (error.name === 'UnsupportedError')
            console.warn('browser not supported')
    }
}

const createSendTransport = () => {
    // see server's socket.on('createWebRtcTransport', sender?, ...)
    // this is a call from Producer, so sender = true
    socket.emit('createWebRtcTransport', { consumer: false }, ({ params }) => {
        // The server sends back params needed 
        // to create Send Transport on the client side
        if (params.error) {
            console.log(params.error)
            return
        }

        console.log("Parameters from the server: ", params)

        // creates a new WebRTC Transport to send media
        // based on the server's producer transport params
        // https://mediasoup.org/documentation/v3/mediasoup-client/api/#TransportOptions
        producerTransport = device.createSendTransport(params)

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
                await socket.emit('transport-produce', {
                        kind: parameters.kind,
                        rtpParameters: parameters.rtpParameters,
                        appData: parameters.appData,
                    },
                    ({ id, producersExist }) => {
                        // Tell the client side transport that parameters were transmitted
                        // and provide it with the server side producer's id.
                        callback({ id })

                        // if producers exist, then join room?
                        if (producersExist) getProducers() // Connect to existing producers
                    }
                )

            } catch (error) {
                errback(error)
            }
        })

        connectSendTransport()
    })
}

const connectSendTransport = async () => {
    // we now call produce() to instruct the producer transport
    // to send media to the Router
    // https://mediasoup.org/documentation/v3/mediasoup-client/api/#transport-produce
    // this action will trigger the 'connect' and 'produce' events above

    // audioProducer = await producerTransport.produce(audioParams);
    videoProducer = await producerTransport.produce(videoParams);
    console.log("Video Producer created.")

    // ?
    // audioProducer.on('trackended', () => {
    //     console.log('audio track ended')
    //     // close audio track
    //     audioProducer.close()
    // })

    // audioProducer.on('transportclose', () => {
    //     console.log('audio transport ended')
    //     // close audio track
    //     audioProducer.close()
    // })

    videoProducer.on('trackended', () => {
        console.log('video track ended')
        // close video track
        videoProducer.close()
    })

    videoProducer.on('transportclose', () => {
        console.log('video transport ended')
        // close video track
        videoProducer.close()
    })
}

// ********************************************************************************

const signalNewConsumerTransport = async (remoteProducerId) => {
    //check if we are already consuming the remoteProducerId
    if (consumingTransports.includes(remoteProducerId)) return;
    consumingTransports.push(remoteProducerId);

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

                // Tell the transport that parameters were transmitted.
                callback()
            } catch (error) {
                // Tell the transport that something was wrong
                errback(error)
            }
        })
        
        // Unlike createSendTransport, no 'produce' event will be triggered here

        connectRecvTransport(consumerTransport, remoteProducerId, params.id)
    })
}

// Server informing the client a new producer just joined
// The client use this instead of getProucers() later 
socket.on('new-producer', ({ producerId }) => signalNewConsumerTransport(producerId))

// Get all the other producers in the room
// Called when joining the room for the first time
const getProducers = () => {
    socket.emit('getProducers', producerIds => {
        console.log("Producers in the room: ", producerIds)
        // for each of the producer create a consumer
        // producerIds.forEach(id => signalNewConsumerTransport(id))
        producerIds.forEach(signalNewConsumerTransport)
    })
}

const connectRecvTransport = async (consumerTransport, remoteProducerId, serverConsumerTransportId) => {
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
                newElem.innerHTML = '<video id="' + remoteProducerId + '" autoplay class="video" ></video>'
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

socket.on('producer-closed', ({ remoteProducerId }) => {
    // server notification is received when a producer is closed
    // we need to close the client-side consumer and associated transport
    const producerToClose = consumerTransports.find(transportData => transportData.producerId === remoteProducerId)
    producerToClose.consumerTransport.close()
    producerToClose.consumer.close()

    // remove the consumer transport from the list
    consumerTransports = consumerTransports.filter(transportData => transportData.producerId !== remoteProducerId)

    // remove the video div element
    videoContainer.removeChild(document.getElementById(`td-${remoteProducerId}`))
})