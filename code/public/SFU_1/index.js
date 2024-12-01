//index.js
const io = require("socket.io-client");
const mediasoupClient = require("mediasoup-client");

const roomName = window.location.pathname.split("/")[2];
let isLocal = 0;
const socket1 = io("/mediasoup");
let socket2 = io();
socket1.on("connection-success", async ({ socketId, remoteURL }) => {
    console.log(socketId, remoteURL);

    joinRoom(socket1);
    socket2 = io(remoteURL);
    socket2.on("connection-success", async ({ socketId }) => {
        console.log("remote client connected " + socketId);
        joinRoom(socket2);
    });
    socket2.on("new-producer", ({ producerId }) => {
        console.log("NEWPRODUCER");
        getProducers(socket2);
    });
    socket2.on("producer-closed", ({ remoteProducerId }) => {
        // server notification is received when a producer is closed
        // we need to close the client-side consumer and associated transport
        const producerToClose = consumerTransports.find(
            (transportData) => transportData.producerId === remoteProducerId
        );
        producerToClose.consumerTransport.close();
        producerToClose.consumer.close();

        // remove the consumer transport from the list
        consumerTransports = consumerTransports.filter(
            (transportData) => transportData.producerId !== remoteProducerId
        );

        // remove the video div element
        videoContainer.removeChild(
            document.getElementById(`td-${remoteProducerId}`)
        );
    });

    //getLocalStream();
});

let device;
let rtpCapabilities;
let producerTransport;
let consumerTransports = [];
let audioProducer;
let videoProducer;
let consumer;
let isProducer = false;

// https://mediasoup.org/documentation/v3/mediasoup-client/api/#ProducerOptions
// https://mediasoup.org/documentation/v3/mediasoup-client/api/#transport-produce
let params = {
    // mediasoup params
    encodings: [
        {
            rid: "r0",
            maxBitrate: 100000,
            scalabilityMode: "S1T3",
        },
        // {
        //   rid: "r1",
        //   maxBitrate: 300000,
        //   scalabilityMode: "S1T3",
        // },
        // {
        //   rid: "r2",
        //   maxBitrate: 900000,
        //   scalabilityMode: "S1T3",
        // },
    ],
    // https://mediasoup.org/documentation/v3/mediasoup-client/api/#ProducerCodecOptions
    codecOptions: {
        videoGoogleStartBitrate: 1000,
    },
};

let audioParams;
let videoParams = { params };
let consumingTransports = [];

const streamSuccess = (stream, socket) => {
    localVideo.srcObject = stream;

    audioParams = { track: stream.getAudioTracks()[0], ...audioParams };
    videoParams = { track: stream.getVideoTracks()[0], ...videoParams };
    createSendTransport(socket);
    //joinRoom();
};

const joinRoom = (socket) => {
    socket.emit("joinRoom", { roomName }, (data) => {
        console.log(`Router RTP Capabilities... ${data.rtpCapabilities}`);
        // we assign to local variable and will be used when
        // loading the client Device (see createDevice above)
        rtpCapabilities = data.rtpCapabilities;

        // once we have rtpCapabilities from the Router, create Device

        // else getProducers(socket);
        if (socket === socket1) createDevice(socket);
        getProducers(socket);
        if (socket === socket1) getLocalStream(socket);
        //getProducers(socket);
        //createDevice();
    });
};

const getLocalStream = (socket) => {
    navigator.mediaDevices
        .getUserMedia({
            audio: true,
            video: {
                width: {
                    min: 640,
                    max: 1920,
                },
                height: {
                    min: 400,
                    max: 1080,
                },
            },
        })
        .then(function (steam) {
            streamSuccess(steam, socket);
        })
        .catch((error) => {
            console.log(error.message);
            getProducers(socket);
        });
};

// A device is an endpoint connecting to a Router on the
// server side to send/recive media
const createDevice = async (socket) => {
    try {
        device = new mediasoupClient.Device();

        // https://mediasoup.org/documentation/v3/mediasoup-client/api/#device-load
        // Loads the device with RTP capabilities of the Router (server side)
        await device.load({
            // see getRtpCapabilities() below
            routerRtpCapabilities: rtpCapabilities,
        });

        console.log("Device RTP Capabilities", device.rtpCapabilities);

        // once the device loads, create transport
        //getLocalStream(socket);
        // getProducers(socket);
    } catch (error) {
        console.log(error);
        if (error.name === "UnsupportedError")
            console.warn("browser not supported");
    }
};

const createSendTransport = (socket) => {
    // see server's socket.on('createWebRtcTransport', sender?, ...)
    // this is a call from Producer, so sender = true
    socket.emit("createWebRtcTransport", { consumer: false }, ({ params }) => {
        // The server sends back params needed
        // to create Send Transport on the client side
        if (params.error) {
            console.log(params.error);
            return;
        }

        console.log(params);

        // creates a new WebRTC Transport to send media
        // based on the server's producer transport params
        // https://mediasoup.org/documentation/v3/mediasoup-client/api/#TransportOptions
        producerTransport = device.createSendTransport(params);

        // https://mediasoup.org/documentation/v3/communication-between-client-and-server/#producing-media
        // this event is raised when a first call to transport.produce() is made
        // see connectSendTransport() below
        producerTransport.on(
            "connect",
            async ({ dtlsParameters }, callback, errback) => {
                try {
                    // Signal local DTLS parameters to the server side transport
                    // see server's socket.on('transport-connect', ...)
                    await socket.emit("transport-connect", {
                        dtlsParameters,
                    });

                    // Tell the transport that parameters were transmitted.
                    callback();
                } catch (error) {
                    errback(error);
                }
            }
        );

        producerTransport.on("produce", async (parameters, callback, errback) => {
            console.log(parameters);

            try {
                // tell the server to create a Producer
                // with the following parameters and produce
                // and expect back a server side producer id
                // see server's socket.on('transport-produce', ...)
                await socket.emit(
                    "transport-produce",
                    {
                        kind: parameters.kind,
                        rtpParameters: parameters.rtpParameters,
                        appData: parameters.appData,
                    },
                    ({ id, producersExist }) => {
                        // Tell the transport that parameters were transmitted and provide it with the
                        // server side producer's id.
                        callback({ id });

                        // if producers exist, then join room
                        if (producersExist) getProducers(socket);
                    }
                );
            } catch (error) {
                errback(error);
            }
        });

        connectSendTransport(socket);
    });
};

const connectSendTransport = async (socket) => {
    // we now call produce() to instruct the producer transport
    // to send media to the Router
    // https://mediasoup.org/documentation/v3/mediasoup-client/api/#transport-produce
    // this action will trigger the 'connect' and 'produce' events above

    audioProducer = await producerTransport.produce(audioParams);
    videoProducer = await producerTransport.produce(videoParams);

    audioProducer.on("trackended", () => {
        console.log("audio track ended");

        // close audio track
    });

    audioProducer.on("transportclose", () => {
        console.log("audio transport ended");

        // close audio track
    });

    videoProducer.on("trackended", () => {
        console.log("video track ended");

        // close video track
    });

    videoProducer.on("transportclose", () => {
        console.log("video transport ended");

        // close video track
    });
};

const signalNewConsumerTransport = async (remoteProducerId, socket) => {
    //check if we are already consuming the remoteProducerId
    if (consumingTransports.includes(remoteProducerId)) return;
    consumingTransports.push(remoteProducerId);

    await socket.emit(
        "createWebRtcTransport",
        { consumer: true },
        ({ params }) => {
            // The server sends back params needed
            // to create Send Transport on the client side
            if (params.error) {
                console.log(params.error);
                return;
            }
            console.log(`PARAMS... ${params}`);

            let consumerTransport;
            try {
                consumerTransport = device.createRecvTransport(params);
            } catch (error) {
                // exceptions:
                // {InvalidStateError} if not loaded
                // {TypeError} if wrong arguments.
                console.log(error);
                return;
            }

            consumerTransport.on(
                "connect",

                async ({ dtlsParameters }, callback, errback) => {
                    try {
                        // Signal local DTLS parameters to the server side transport
                        // see server's socket.on('transport-recv-connect', ...)
                        await socket.emit("transport-recv-connect", {
                            dtlsParameters,
                            serverConsumerTransportId: params.id,
                        });

                        // Tell the transport that parameters were transmitted.
                        callback();
                    } catch (error) {
                        // Tell the transport that something was wrong
                        errback(error);
                    }
                }
            );

            connectRecvTransport(
                consumerTransport,
                remoteProducerId,
                params.id,
                socket
            );
        }
    );
};

// server informs the client of a new producer just joined
socket1.on("new-producer", ({ producerId }) => {
    getProducers(socket1);
    console.log("NEWPRODUCER");
});

const getProducers = (socket) => {
    socket.emit("getProducers", (producerIds) => {
        console.log("getProducers" + producerIds.length);
        // for each of the producer create a consumer
        // producerIds.forEach(id => signalNewConsumerTransport(id))
        producerIds.forEach(function (item, index, producerIds) {
            signalNewConsumerTransport(item, socket);
        });
    });
};

const connectRecvTransport = async (
    consumerTransport,
    remoteProducerId,
    serverConsumerTransportId,
    socket
) => {
    // for consumer, we need to tell the server first
    // to create a consumer based on the rtpCapabilities and consume
    // if the router can consume, it will send back a set of params as below
    await socket.emit(
        "consume",
        {
            rtpCapabilities: device.rtpCapabilities,
            remoteProducerId,
            serverConsumerTransportId,
        },
        async ({ params }) => {
            if (params.error) {
                console.log("Cannot Consume");
                return;
            }

            console.log(`Consumer Params ${params}`);
            // then consume with the local consumer transport
            // which creates a consumer
            const consumer = await consumerTransport.consume({
                id: params.id,
                producerId: params.producerId,
                kind: params.kind,
                rtpParameters: params.rtpParameters,
            });

            consumerTransports = [
                ...consumerTransports,
                {
                    consumerTransport,
                    serverConsumerTransportId: params.id,
                    producerId: remoteProducerId,
                    consumer,
                },
            ];
            console.log("consumertransport數量:" + consumerTransports.length);
            // create a new div element for the new consumer media
            const newElem = document.createElement("div");
            newElem.setAttribute("id", `td-${remoteProducerId}`);

            if (params.kind == "audio") {
                //append to the audio container
                newElem.innerHTML =
                    '<audio id="' + remoteProducerId + '" autoplay></audio>';
            } else {
                //append to the video container
                newElem.setAttribute("class", "remoteVideo");
                newElem.innerHTML =
                    '<video id="' +
                    remoteProducerId +
                    '" autoplay class="video" ></video>';
            }

            videoContainer.appendChild(newElem);

            // destructure and retrieve the video track from the producer
            const { track } = consumer;

            document.getElementById(remoteProducerId).srcObject = new MediaStream([
                track,
            ]);

            // the server consumer started with media paused
            // so we need to inform the server to resume
            socket.emit("consumer-resume", {
                serverConsumerId: params.serverConsumerId,
            });
        }
    );
};

socket1.on("producer-closed", ({ remoteProducerId }) => {
    // server notification is received when a producer is closed
    // we need to close the client-side consumer and associated transport
    const producerToClose = consumerTransports.find(
        (transportData) => transportData.producerId === remoteProducerId
    );
    producerToClose.consumerTransport.close();
    producerToClose.consumer.close();

    // remove the consumer transport from the list
    consumerTransports = consumerTransports.filter(
        (transportData) => transportData.producerId !== remoteProducerId
    );

    // remove the video div element
    videoContainer.removeChild(document.getElementById(`td-${remoteProducerId}`));
});
