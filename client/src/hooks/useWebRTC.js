import { useState, useEffect, useRef, useCallback } from 'react';

const CHUNK_SIZE = 16384; // 16KB

const MSG_FILES_OFFER = 'FILES_OFFER';
const MSG_FILE_REQUEST = 'FILE_REQUEST';
const MSG_FILE_CANCEL = 'FILE_CANCEL';
const MSG_FILE_START = 'FILE_START';
const MSG_HANDSHAKE_SYN = 'HANDSHAKE_SYN';
const MSG_HANDSHAKE_ACK = 'HANDSHAKE_ACK';
const RTC_CONFIG = {
    iceServers: [
        {
            urls: [
                'stun:stun.l.google.com:19302',
                'stun:stun1.l.google.com:19302'
            ]
        }
    ],
    iceCandidatePoolSize: 4
};

export function useWebRTC(socket, myId) {
    const [history, setHistory] = useState([]);
    const [connectionStatus, setConnectionStatus] = useState('DISCONNECTED');
    const [channelReady, setChannelReady] = useState(false);
    const [error, setError] = useState(null);

    const pcRef = useRef(null);
    const dataChannelRef = useRef(null);
    const availableFilesRef = useRef(new Map()); // id -> { file, peerId }
    const incomingFileRef = useRef(null);
    const pendingOfferIdsRef = useRef(new Set());
    const cancelledTransfersRef = useRef(new Set());
    const iceCandidateQueue = useRef([]);
    const remoteDescriptionSet = useRef(false);
    const activePeerIdRef = useRef(null);
    const historyRef = useRef([]);
    const downloadUrlsRef = useRef(new Map());

    useEffect(() => {
        historyRef.current = history;
    }, [history]);

    const updateHistoryItem = useCallback((id, updates) => {
        setHistory(prev => prev.map(item => item.id === id ? { ...item, ...updates } : item));
    }, []);

    const revokeDownloadUrl = useCallback((fileId) => {
        const url = downloadUrlsRef.current.get(fileId);
        if (!url) {
            return;
        }

        downloadUrlsRef.current.delete(fileId);
        window.setTimeout(() => {
            URL.revokeObjectURL(url);
        }, 1000);
    }, []);

    const removeOutgoingFile = useCallback((fileId) => {
        availableFilesRef.current.delete(fileId);
        pendingOfferIdsRef.current.delete(fileId);
        cancelledTransfersRef.current.delete(fileId);
    }, []);

    const expireOutgoingFilesForPeer = useCallback((peerId, reason) => {
        if (!peerId) return;

        const fileIds = [];
        availableFilesRef.current.forEach((entry, id) => {
            if (entry.peerId === peerId) {
                fileIds.push(id);
            }
        });

        if (fileIds.length === 0) return;

        const idSet = new Set(fileIds);
        fileIds.forEach(removeOutgoingFile);

        setHistory(prev => prev.map(item => {
            if (!idSet.has(item.id) || item.direction !== 'out') {
                return item;
            }

            if (item.status === 'completed' || item.status === 'cancelled' || item.status === 'error') {
                return item;
            }

            return {
                ...item,
                status: 'error',
                error: reason
            };
        }));
    }, [removeOutgoingFile]);

    const resetConnection = useCallback(() => {
        setConnectionStatus('DISCONNECTED');
        setChannelReady(false);
        incomingFileRef.current = null;
        remoteDescriptionSet.current = false;
        iceCandidateQueue.current = [];
        activePeerIdRef.current = null;

        if (pcRef.current) {
            pcRef.current.close();
            pcRef.current = null;
        }

        if (dataChannelRef.current) {
            dataChannelRef.current.close();
            dataChannelRef.current = null;
        }
    }, []);

    const flushPendingOffers = useCallback(() => {
        const peerId = activePeerIdRef.current;
        const channel = dataChannelRef.current;

        if (!peerId || !channel || channel.readyState !== 'open') {
            return;
        }

        const fileIds = Array.from(pendingOfferIdsRef.current).filter((id) => {
            const entry = availableFilesRef.current.get(id);
            return entry && entry.peerId === peerId;
        });

        if (fileIds.length === 0) {
            return;
        }

        const files = fileIds.map((id) => {
            const entry = availableFilesRef.current.get(id);
            return {
                id,
                name: entry.file.name,
                size: entry.file.size,
                type: entry.file.type
            };
        });

        channel.send(JSON.stringify({ type: MSG_FILES_OFFER, files }));
        fileIds.forEach((id) => pendingOfferIdsRef.current.delete(id));
    }, []);

    const setupPC = useCallback((targetId) => {
        const pc = new RTCPeerConnection(RTC_CONFIG);

        pcRef.current = pc;
        remoteDescriptionSet.current = false;
        iceCandidateQueue.current = [];

        pc.onicecandidate = (event) => {
            if (event.candidate && socket) {
                socket.emit('ice-candidate', { target: targetId, candidate: event.candidate, sender: myId });
            }
        };

        pc.onconnectionstatechange = () => {
            console.log('Connection State:', pc.connectionState);

            if (pc.connectionState === 'connected') {
                setConnectionStatus('CONNECTED');
                return;
            }

            if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
                expireOutgoingFilesForPeer(
                    activePeerIdRef.current,
                    'Connection lost before the transfer could finish.'
                );
                resetConnection();
                setError('Connection lost');
            }
        };

        return pc;
    }, [socket, myId, expireOutgoingFilesForPeer, resetConnection]);

    const sendData = useCallback((data) => {
        const channel = dataChannelRef.current;

        if (channel && channel.readyState === 'open') {
            if (typeof data === 'object' && !(data instanceof ArrayBuffer) && !(data instanceof Blob)) {
                console.log('Sending Data:', data.type || 'Binary');
                channel.send(JSON.stringify(data));
            } else {
                channel.send(data);
            }
        } else {
            console.warn('Channel not open, cannot send:', data);
        }
    }, []);

    const handleBinaryData = useCallback((data) => {
        if (!incomingFileRef.current) return;

        const file = incomingFileRef.current;
        file.buffers.push(data);
        file.received += data.byteLength;

        const percent = Math.round((file.received / file.size) * 100);
        if (percent % 5 === 0 || file.received >= file.size) {
            updateHistoryItem(file.id, { progress: percent });
        }

        if (file.received < file.size) {
            return;
        }

        setHistory(prev => {
            const item = prev.find(i => i.id === file.id);
            if (!item || item.downloadUrl) return prev;

            const type = item.fileType || 'application/octet-stream';
            let url = item.downloadUrl;

            try {
                const finalBlob = new Blob(file.buffers, { type });
                url = URL.createObjectURL(finalBlob);
                downloadUrlsRef.current.set(file.id, url);
            } catch (blobError) {
                console.error('Blob creation failed', blobError);
                return prev.map(i => i.id === file.id ? { ...i, status: 'error' } : i);
            }

            return prev.map(i => i.id === file.id ? {
                ...i,
                status: 'completed',
                progress: 100,
                downloadUrl: url
            } : i);
        });

        setTimeout(() => {
            if (incomingFileRef.current && incomingFileRef.current.id === file.id) {
                incomingFileRef.current.buffers = null;
                incomingFileRef.current = null;
            }
        }, 500);
    }, [updateHistoryItem]);

    const saveReceivedFile = useCallback((fileId) => {
        const item = historyRef.current.find((entry) => entry.id === fileId);
        const url = item?.downloadUrl || downloadUrlsRef.current.get(fileId);

        if (!item || !url) {
            return;
        }

        const link = document.createElement('a');
        link.href = url;
        link.download = item.fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        updateHistoryItem(fileId, {
            saved: true,
            downloadUrl: null
        });
        revokeDownloadUrl(fileId);
    }, [revokeDownloadUrl, updateHistoryItem]);

    const startUpload = useCallback(async (fileId) => {
        const entry = availableFilesRef.current.get(fileId);
        if (!entry) {
            console.error('File requested but not found in memory');
            return;
        }

        cancelledTransfersRef.current.delete(fileId);
        updateHistoryItem(fileId, { status: 'uploading', progress: 0, error: null });

        const file = entry.file;
        sendData({ type: MSG_FILE_START, id: fileId, size: file.size });

        const arrayBuffer = await file.arrayBuffer();
        const totalSize = arrayBuffer.byteLength;
        const channel = dataChannelRef.current;
        let offset = 0;

        const sendLoop = () => {
            if (!channel || channel.readyState !== 'open') {
                return;
            }

            if (cancelledTransfersRef.current.has(fileId)) {
                removeOutgoingFile(fileId);
                return;
            }

            if (channel.bufferedAmount > 16 * 1024 * 1024) {
                setTimeout(sendLoop, 50);
                return;
            }

            while (offset < totalSize && channel.bufferedAmount < 4 * 1024 * 1024) {
                if (cancelledTransfersRef.current.has(fileId)) {
                    removeOutgoingFile(fileId);
                    return;
                }

                const chunk = arrayBuffer.slice(offset, offset + CHUNK_SIZE);
                channel.send(chunk);
                offset += chunk.byteLength;

                if (offset % (CHUNK_SIZE * 50) === 0 || offset === totalSize) {
                    const percent = Math.round((offset / totalSize) * 100);
                    updateHistoryItem(fileId, { progress: percent });
                }
            }

            if (offset < totalSize) {
                requestAnimationFrame(sendLoop);
                return;
            }

            updateHistoryItem(fileId, { status: 'completed', progress: 100 });
            removeOutgoingFile(fileId);
        };

        sendLoop();
    }, [sendData, updateHistoryItem, removeOutgoingFile]);

    const handleSignalingMessage = useCallback((msg) => {
        switch (msg.type) {
            case MSG_FILES_OFFER: {
                const newIncoming = msg.files.map(f => ({
                    id: f.id,
                    fileName: f.name,
                    fileSize: f.size,
                    fileType: f.type,
                    direction: 'in',
                    status: 'idle',
                    progress: 0,
                    peerId: activePeerIdRef.current || 'Unknown'
                }));

                setHistory(prev => {
                    const existingIds = new Set(prev.map(i => i.id));
                    const unique = newIncoming.filter(i => !existingIds.has(i.id));
                    return [...prev, ...unique];
                });
                break;
            }

            case MSG_HANDSHAKE_SYN:
                console.log('Received Handshake SYN. Sending ACK.');
                sendData({ type: MSG_HANDSHAKE_ACK });
                setConnectionStatus('CONNECTED');
                setChannelReady(true);
                break;

            case MSG_HANDSHAKE_ACK:
                console.log('Received Handshake ACK. Channel Fully Ready.');
                setConnectionStatus('CONNECTED');
                setChannelReady(true);
                break;

            case MSG_FILE_REQUEST:
                startUpload(msg.fileId);
                break;

            case MSG_FILE_CANCEL:
                cancelledTransfersRef.current.add(msg.fileId);
                removeOutgoingFile(msg.fileId);
                updateHistoryItem(msg.fileId, { status: 'cancelled' });
                if (incomingFileRef.current && incomingFileRef.current.id === msg.fileId) {
                    incomingFileRef.current = null;
                }
                break;

            case MSG_FILE_START:
                incomingFileRef.current = {
                    id: msg.id,
                    size: msg.size,
                    received: 0,
                    buffers: []
                };
                updateHistoryItem(msg.id, { status: 'downloading', progress: 0, error: null });
                break;
        }
    }, [removeOutgoingFile, sendData, startUpload, updateHistoryItem]);

    const setupChannelListeners = useCallback((channel) => {
        channel.onopen = () => {
            console.log('Channel Open Event Fired. Initiating Handshake...');
            channel.send(JSON.stringify({ type: MSG_HANDSHAKE_SYN }));
        };

        channel.onmessage = async (event) => {
            const data = event.data;
            if (typeof data === 'string') {
                try {
                    const msg = JSON.parse(data);
                    handleSignalingMessage(msg);
                } catch (parseError) {
                    console.error('Failed to parse msg', parseError);
                }
            } else {
                handleBinaryData(data);
            }
        };

        channel.onclose = () => {
            console.log('Channel Closed');

            expireOutgoingFilesForPeer(
                activePeerIdRef.current,
                'Connection closed before the transfer completed.'
            );

            setHistory(prev => prev.map(item =>
                (item.status === 'downloading' || item.status === 'uploading')
                    ? { ...item, status: 'error', error: 'Connection closed during transfer.' }
                    : item
            ));

            setConnectionStatus('DISCONNECTED');
            setChannelReady(false);
            dataChannelRef.current = null;
            pcRef.current = null;
            remoteDescriptionSet.current = false;
            iceCandidateQueue.current = [];
            activePeerIdRef.current = null;
        };
    }, [expireOutgoingFilesForPeer, handleBinaryData, handleSignalingMessage]);

    const beginConnection = useCallback(async (targetId) => {
        activePeerIdRef.current = targetId;
        setConnectionStatus('CONNECTING');

        const pc = setupPC(targetId);
        const channel = pc.createDataChannel('lan-share');
        dataChannelRef.current = channel;
        setupChannelListeners(channel);

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('offer', { target: targetId, offer, sender: myId });
    }, [setupPC, setupChannelListeners, socket, myId]);

    const sendFilesOffer = useCallback(async (targetId, files) => {
        console.log(`Sending offer for ${files.length} files to ${targetId}`);
        setError(null);

        if (pcRef.current && activePeerIdRef.current && activePeerIdRef.current !== targetId) {
            expireOutgoingFilesForPeer(
                activePeerIdRef.current,
                'Transfer session was replaced by a different device.'
            );
            resetConnection();
        }

        const newItems = [];
        const MAX_SIZE = 150 * 1024 * 1024; // 150MB

        Array.from(files).forEach(file => {
            if (file.size > MAX_SIZE) {
                newItems.push({
                    id: Math.random().toString(36).substr(2, 9),
                    fileName: file.name,
                    fileSize: file.size,
                    fileType: file.type,
                    direction: 'out',
                    status: 'error',
                    error: 'File too large (>150MB)',
                    progress: 0,
                    peerId: targetId
                });
                return;
            }

            const id = Math.random().toString(36).substr(2, 9);
            availableFilesRef.current.set(id, { file, peerId: targetId });
            pendingOfferIdsRef.current.add(id);

            newItems.push({
                id,
                fileName: file.name,
                fileSize: file.size,
                fileType: file.type,
                direction: 'out',
                status: 'idle',
                progress: 0,
                peerId: targetId
            });
        });

        setHistory(prev => [...prev, ...newItems]);

        if (!pcRef.current) {
            await beginConnection(targetId);
            return;
        }

        activePeerIdRef.current = targetId;
        const channel = dataChannelRef.current;

        if (!channel || channel.readyState === 'closed' || channel.readyState === 'closing') {
            resetConnection();
            await beginConnection(targetId);
            return;
        }

        if (channelReady && channel.readyState === 'open') {
            flushPendingOffers();
        } else {
            console.log('Channel state is', channel.readyState, '- waiting for open event.');
        }
    }, [beginConnection, channelReady, expireOutgoingFilesForPeer, flushPendingOffers, resetConnection]);

    const requestFile = useCallback((fileId) => {
        updateHistoryItem(fileId, { status: 'waiting', error: null });
        sendData({ type: MSG_FILE_REQUEST, fileId });
    }, [sendData, updateHistoryItem]);

    const cancelTransfer = useCallback((fileId) => {
        cancelledTransfersRef.current.add(fileId);
        updateHistoryItem(fileId, { status: 'cancelled' });
        removeOutgoingFile(fileId);
        revokeDownloadUrl(fileId);
        sendData({ type: MSG_FILE_CANCEL, fileId });

        if (incomingFileRef.current && incomingFileRef.current.id === fileId) {
            incomingFileRef.current = null;
        }
    }, [removeOutgoingFile, revokeDownloadUrl, sendData, updateHistoryItem]);

    useEffect(() => {
        const activeDownloadUrls = downloadUrlsRef.current;

        return () => {
            activeDownloadUrls.forEach((url) => {
                URL.revokeObjectURL(url);
            });
            activeDownloadUrls.clear();
        };
    }, []);

    useEffect(() => {
        if (channelReady && dataChannelRef.current?.readyState === 'open') {
            console.log('Channel detected READY. Sending pending file offers.');
            flushPendingOffers();
        }
    }, [channelReady, flushPendingOffers]);

    useEffect(() => {
        if (!socket) return;

        const handleOffer = async ({ offer, sender }) => {
            if (pcRef.current) {
                expireOutgoingFilesForPeer(
                    activePeerIdRef.current,
                    'Previous transfer session was interrupted by a new connection.'
                );
                resetConnection();
            }

            activePeerIdRef.current = sender;
            console.log('Handling offer from', sender);

            const pc = new RTCPeerConnection(RTC_CONFIG);
            pcRef.current = pc;
            remoteDescriptionSet.current = false;
            iceCandidateQueue.current = [];

            pc.onicecandidate = (event) => {
                if (event.candidate && socket) {
                    socket.emit('ice-candidate', { target: sender, candidate: event.candidate, sender: myId });
                }
            };

            pc.onconnectionstatechange = () => {
                console.log('Connection State:', pc.connectionState);

                if (pc.connectionState === 'connected') {
                    setConnectionStatus('CONNECTED');
                    return;
                }

                if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
                    expireOutgoingFilesForPeer(
                        activePeerIdRef.current,
                        'Connection lost before the transfer could finish.'
                    );
                    resetConnection();
                    setError('Connection lost');
                }
            };

            pc.ondatachannel = (event) => {
                dataChannelRef.current = event.channel;
                setupChannelListeners(event.channel);
            };

            await pc.setRemoteDescription(new RTCSessionDescription(offer));
            remoteDescriptionSet.current = true;

            for (const candidate of iceCandidateQueue.current) {
                pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => console.error(e));
            }
            iceCandidateQueue.current = [];

            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            socket.emit('answer', { target: sender, answer, sender: myId });
        };

        const handleAnswer = async ({ answer }) => {
            if (!pcRef.current) return;

            await pcRef.current.setRemoteDescription(new RTCSessionDescription(answer));
            remoteDescriptionSet.current = true;

            for (const candidate of iceCandidateQueue.current) {
                pcRef.current.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => console.error(e));
            }
            iceCandidateQueue.current = [];
        };

        const handleIce = async ({ candidate }) => {
            if (!pcRef.current) return;

            if (remoteDescriptionSet.current) {
                await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
            } else {
                console.log('Buffering ICE candidate as remote desc not set');
                iceCandidateQueue.current.push(candidate);
            }
        };

        socket.on('offer', handleOffer);
        socket.on('answer', handleAnswer);
        socket.on('ice-candidate', handleIce);

        return () => {
            socket.off('offer', handleOffer);
            socket.off('answer', handleAnswer);
            socket.off('ice-candidate', handleIce);
        };
    }, [socket, myId, expireOutgoingFilesForPeer, resetConnection, setupPC, setupChannelListeners]);

    return {
        history,
        connectionStatus,
        sendFilesOffer,
        requestFile,
        saveReceivedFile,
        cancelTransfer,
        error
    };
}
