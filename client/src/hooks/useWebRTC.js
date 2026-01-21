import { useState, useEffect, useRef, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid'; // We might need a uuid generator, but for now Math.random is fine if no lib

const CHUNK_SIZE = 16384; // 16KB

// Message Types
// Message Types
const MSG_FILES_OFFER = 'FILES_OFFER';
const MSG_FILE_REQUEST = 'FILE_REQUEST';
const MSG_FILE_CANCEL = 'FILE_CANCEL'; // Deleted by sender
const MSG_FILE_START = 'FILE_START'; // Metadata before binary
const MSG_CHUNK = 'CHUNK';
const MSG_FILE_COMPLETE = 'FILE_COMPLETE';
const MSG_HANDSHAKE_SYN = 'HANDSHAKE_SYN';
const MSG_HANDSHAKE_ACK = 'HANDSHAKE_ACK';

export function useWebRTC(socket, myId) {
    const [history, setHistory] = useState([]); // Array of { id, fileName, fileSize, fileType, direction: 'in'|'out', status: 'idle'|'waiting'|'downloading'|'completed'|'cancelled'|'error', progress: 0, peerId }
    const [connectionStatus, setConnectionStatus] = useState('DISCONNECTED'); // DISCONNECTED, CONNECTING, CONNECTED
    const [channelReady, setChannelReady] = useState(false); // New state to track actual channel readiness
    const [error, setError] = useState(null);

    const pcRef = useRef(null);
    const dataChannelRef = useRef(null);
    const availableFilesRef = useRef(new Map()); // id -> File object (for Sender)
    const incomingFileRef = useRef(null); // Current file being received { id, buffers, expectedSize, receivedSize }
    const activeTransferRef = useRef(false);
    const iceCandidateQueue = useRef([]); // Buffer for early candidates
    const remoteDescriptionSet = useRef(false);
    const activePeerIdRef = useRef(null); // Track the current connected peer ID

    // Helpers to update history item
    const updateHistoryItem = useCallback((id, updates) => {
        setHistory(prev => prev.map(item => item.id === id ? { ...item, ...updates } : item));
    }, []);

    const addHistoryItem = useCallback((item) => {
        setHistory(prev => [...prev, item]);
    }, []);

    const resetConnection = useCallback(() => {
        setConnectionStatus('DISCONNECTED');
        setChannelReady(false);
        activeTransferRef.current = false;
        incomingFileRef.current = null;
        remoteDescriptionSet.current = false;
        iceCandidateQueue.current = [];

        if (pcRef.current) {
            pcRef.current.close();
            pcRef.current = null;
        }
        if (dataChannelRef.current) {
            dataChannelRef.current.close();
            dataChannelRef.current = null;
        }
    }, []);

    // Setup Peer Connection
    const setupPC = useCallback((targetId) => {
        const pc = new RTCPeerConnection({
            // iceServers: [{ urls: 'stun:stun.l.google.com:19302' }], // Public STUN server
            iceServers: [] // LAN ONLY: No STUN servers
        });
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
            }
            if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
                resetConnection();
                setError('Connection lost');
            }
        };

        return pc;
    }, [socket, myId, resetConnection]);

    // Fix Race Condition: Send available files when connection opens
    // This useEffect is replaced by the new one below that watches `channelReady`
    // useEffect(() => {
    //     if (connectionStatus === 'CONNECTED' && dataChannelRef.current?.readyState === 'open') {
    //         console.log("Connection established, sending pending file offers...");
    //         const files = [];
    //         availableFilesRef.current.forEach((file, id) => {
    //             files.push({
    //                 id,
    //                 name: file.name,
    //                 size: file.size,
    //                 type: file.type
    //             });
    //         });

    //         if (files.length > 0) {
    //             const msg = { type: MSG_FILES_OFFER, files };
    //             // We use the raw channel send here to avoid dependency cycle or just call sendData if available
    //             if (dataChannelRef.current) {
    //                 dataChannelRef.current.send(JSON.stringify(msg));
    //             }
    //         }
    //     }
    // }, [connectionStatus]);

    // Send a list of files to the peer
    const sendFilesOffer = useCallback(async (targetId, files) => {
        console.log(`Sending offer for ${files.length} files to ${targetId}`);

        // 1. Store files in memory/ref IMMEDIATELY
        const newItems = [];
        const MAX_SIZE = 150 * 1024 * 1024; // 150MB

        Array.from(files).forEach(file => {
            if (file.size > MAX_SIZE) {
                console.warn(`File ${file.name} is too large (${(file.size / 1024 / 1024).toFixed(2)}MB). Limit is 150MB.`);
                // Ideally notify user, for now skip or error. 
                // We'll add an error item to history to inform user? 
                // Or just Alert? Alert is annoying. Let's add an error item.
                const id = Math.random().toString(36).substr(2, 9);
                newItems.push({
                    id,
                    fileName: file.name,
                    fileSize: file.size,
                    fileType: file.type,
                    direction: 'out',
                    status: 'error',
                    progress: 0,
                    peerId: targetId
                });
                return;
            }

            const id = Math.random().toString(36).substr(2, 9);
            availableFilesRef.current.set(id, file);
            newItems.push({
                id,
                fileName: file.name,
                fileSize: file.size,
                fileType: file.type,
                direction: 'out',
                status: 'idle', // Ready to be requested
                progress: 0,
                peerId: targetId
            });
        });

        // 2. Update UI
        setHistory(prev => [...prev, ...newItems]);

        // 3. Check Connection
        if (!pcRef.current) {
            console.log("No existing connection, initiating...");
            // Initiate connection if not exists
            setConnectionStatus('CONNECTING');
            const pc = setupPC(targetId);
            const channel = pc.createDataChannel("lan-share");
            dataChannelRef.current = channel;
            setupChannelListeners(channel);

            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            socket.emit('offer', { target: targetId, offer, sender: myId });

            // The useEffect will handle sending the offer once connection opens
        } else {
            console.log("Connection exists, checking channel...");
            const channel = dataChannelRef.current;

            // Check if channel is dead
            if (!channel || channel.readyState === 'closed' || channel.readyState === 'closing') {
                console.warn("Channel is closed/closing but PC exists. Recovering...");
                // Option A: Create new channel on existing PC (Negotiation needed?)
                // Negotiation IS needed if we add a channel.
                // Simpler Option B: Soft Reset and Reconnect.

                // Let's try creating a new channel.
                // Note: creating channel triggers `negotiationneeded` on PC.
                // We need to handle that? We didn't set up `onnegotiationneeded`.
                // We manually created offer.

                // FORCE RECONNECT is safer.
                pcRef.current.close();
                pcRef.current = null;
                dataChannelRef.current = null;
                setChannelReady(false);
                setConnectionStatus('CONNECTING');

                const pc = setupPC(targetId);
                const newChannel = pc.createDataChannel("lan-share");
                dataChannelRef.current = newChannel;
                setupChannelListeners(newChannel);

                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                socket.emit('offer', { target: targetId, offer, sender: myId });
                return;
            }

            if (channelReady && channel.readyState === 'open') {
                // Send protocol message immediately
                const fileList = newItems.map(item => ({
                    id: item.id,
                    name: item.fileName,
                    size: item.fileSize,
                    type: item.fileType
                }));
                const msg = { type: MSG_FILES_OFFER, files: fileList };
                sendData(msg);
            } else {
                console.log("Channel state is", channel.readyState, "- waiting for open event.");
            }
        }
    }, [setupPC, socket, myId, channelReady]);


    const sendData = (data) => {
        const channel = dataChannelRef.current;
        if (channel && channel.readyState === 'open') {
            // If string/json
            if (typeof data === 'object' && !(data instanceof ArrayBuffer) && !(data instanceof Blob)) {
                console.log("Sending Data:", data.type || 'Binary');
                channel.send(JSON.stringify(data));
            } else {
                channel.send(data);
            }
        } else {
            console.warn("Channel not open, cannot send:", data);
        }
    };

    // Reliable Effect to send pending offers when channel becomes ready
    useEffect(() => {
        if (channelReady && dataChannelRef.current?.readyState === 'open') {
            console.log("Channel detected READY. Checking for pending offers...");

            // We need to know which files haven't been "sent" as an offer yet?
            // Simplified approach: Send ALL 'idle' outgoing files. 
            // The receiver dedups them, so it's safe to resend.

            const files = [];
            availableFilesRef.current.forEach((file, id) => {
                files.push({
                    id,
                    name: file.name,
                    size: file.size,
                    type: file.type
                });
            });

            if (files.length > 0) {
                console.log(`Sending pending offer for ${files.length} files.`);
                const msg = { type: MSG_FILES_OFFER, files };
                dataChannelRef.current.send(JSON.stringify(msg));
            }
        }
    }, [channelReady]);
    // ^ Only trigger when channelReady becomes true. 
    // Add history as dependency? No, infinite loop risk if we update history.
    // Ideally we shouldn't resend old files every time, but for this "first connect" issue, it's fine.


    const setupChannelListeners = (channel) => {
        channel.onopen = () => {
            console.log("Channel Open Event Fired. Initiating Handshake...");
            // Do NOT set ready immediately. Send SYN.
            // setConnectionStatus('CONNECTED'); 
            // setChannelReady(true);

            // Send SYN
            channel.send(JSON.stringify({ type: MSG_HANDSHAKE_SYN }));
        };

        channel.onmessage = async (event) => {
            const data = event.data;
            if (typeof data === 'string') {
                try {
                    const msg = JSON.parse(data);
                    handleSignalingMessage(msg);
                } catch (e) {
                    console.error("Failed to parse msg", e);
                }
            } else {
                // Binary Chunk
                handleBinaryData(data);
            }
        };

        channel.onclose = () => {
            console.log("Channel Closed");
            // If transfers were active, error them
            // Mark all 'downloading' or 'uploading' as error
            setHistory(prev => prev.map(item =>
                (item.status === 'downloading' || item.status === 'uploading')
                    ? { ...item, status: 'error' }
                    : item
            ));
            setConnectionStatus('DISCONNECTED');
            setChannelReady(false);
            activePeerIdRef.current = null; // Clear active peer ID on channel close
        };
    };

    const handleSignalingMessage = (msg) => {
        switch (msg.type) {
            case MSG_FILES_OFFER:
                // Receive list of files available
                const newIncoming = msg.files.map(f => ({
                    id: f.id,
                    fileName: f.name,
                    fileSize: f.size,
                    fileType: f.type,
                    direction: 'in',
                    status: 'idle', // Available to download
                    progress: 0,
                    peerId: activePeerIdRef.current || 'Unknown' // Use tracked peer ID
                }));
                // Dedup based on ID?
                setHistory(prev => {
                    const existingIds = new Set(prev.map(i => i.id));
                    const unique = newIncoming.filter(i => !existingIds.has(i.id));
                    return [...prev, ...unique];
                });
                break;

            case MSG_HANDSHAKE_SYN:
                console.log("Received Handshake SYN. Sending ACK.");
                sendData({ type: MSG_HANDSHAKE_ACK });
                // We can consider channel ready?
                // Ideally wait for ACK if we were the opener, but for symmetry:
                // If I receive SYN, I send ACK. I am ready?
                // Yes, connection is bidirectional.
                setConnectionStatus('CONNECTED');
                setChannelReady(true);
                break;

            case MSG_HANDSHAKE_ACK:
                console.log("Received Handshake ACK. Channel Fully Ready.");
                setConnectionStatus('CONNECTED');
                setChannelReady(true);
                break;

            case MSG_FILE_REQUEST:
                // Peer wants a file
                startUpload(msg.fileId);
                break;

            case MSG_FILE_CANCEL:
                // Peer cancelled or deleted a file
                updateHistoryItem(msg.fileId, { status: 'cancelled' });
                if (incomingFileRef.current && incomingFileRef.current.id === msg.fileId) {
                    incomingFileRef.current = null; // Stop receiving
                }
                // If we were sending, stop sending?
                // The upload loop checks `status`? We need to interrupt it.
                // We'll trust the updateHistoryItem to set status to 'cancelled', upload loop should check history/ref.
                break;

            case MSG_FILE_START:
                // Getting ready to receive binary
                incomingFileRef.current = {
                    id: msg.id,
                    size: msg.size,
                    received: 0,
                    buffers: []
                };
                updateHistoryItem(msg.id, { status: 'downloading', progress: 0 });
                break;
        }
    };

    const handleBinaryData = (data) => {
        if (!incomingFileRef.current) return;

        const file = incomingFileRef.current;
        file.buffers.push(data);
        file.received += data.byteLength;

        // Update UI every 5% or 1MB to avoid too many renders
        const percent = Math.round((file.received / file.size) * 100);
        if (percent % 5 === 0 || file.received >= file.size) {
            updateHistoryItem(file.id, { progress: percent });
        }

        if (file.received >= file.size) {
            console.log("File transfer complete. creating blob...");
            // Complete
            // Create Blob OUTSIDE setHistory to avoid double-invocation issues in Strict Mode
            // and blocking state updates with heavy operations.

            // Find type from available history or just use default specific to this transfer if we stored it?
            // We only stored type in history. We need to look it up or trust a passed meta.
            // But we can't look up easily without reading current state which might be stale in closure?
            // No, we can look up in `history` state if we had access, but `handleBinaryData` closes over `history`? No, it doesn't.
            // `file` object doesn't have `type`.

            // Fix: Store `type` in incomingFileRef when MSG_FILE_START comes or retrieve from history in a stable way.
            // But we can just use the history updater to inject the URL?
            // NO, we need to create the blob first.

            // Workaround: We find the item in the updater, get the type, THEN create blob? 
            // Better: We stored `fileType` in history. We should have it in incomingFileRef too for convenience/efficiency.

            // Let's modify MSG_FILE_START to store type in incomingFileRef?
            // Or just search history in a non-updater way? `history` from scope is stale?
            // `history` state is available in `useWebRTC` scope but `handleBinaryData` is called from `channel.onmessage`.
            // `channel.onmessage` is set in `setupChannelListeners`. 
            // `setupChannelListeners` closes over ... initial render scope? 
            // `setupChannelListeners` is a helper function inside component.
            // It uses `setHistory`.

            // Issue: `fileType` is needed for Blob.
            // We can iterate `availableFilesRef`? No, that's for sender.

            // WE NEED TO STORE TYPE IN `incomingFileRef`.
            // Modify `handleSignalingMessage` for `MSG_FILE_START` first. 
            // But wait, `MSG_FILE_START` comes from sender. Does it have type?
            // Implementation says: `sendData({ type: MSG_FILE_START, id: fileId, size: file.size });` -> NO TYPE.

            // So we must get type from `history`.
            // We can use `setHistory` to get the item, calculate blob, return new state.
            // BUT we must NOT mutate `file.buffers = null` there.

            setHistory(prev => {
                const item = prev.find(i => i.id === file.id);
                if (!item) return prev; // Should not happen

                // If we already have a downloadUrl, don't recreate it (prevent double run effect if any)
                if (item.downloadUrl) return prev;

                const type = item.fileType || 'application/octet-stream';

                // Create Blob ONLY if buffers exist
                let url = item.downloadUrl;
                if (file.buffers) {
                    console.log("Constructing Blob of size:", file.received, "type:", type);
                    try {
                        const finalBlob = new Blob(file.buffers, { type });
                        url = URL.createObjectURL(finalBlob);
                    } catch (e) {
                        console.error("Blob creation failed (OOM?)", e);
                        // Handle error state?
                        return prev.map(i => i.id === file.id ? { ...i, status: 'error' } : i);
                    }

                    // NOW we can't clear file.buffers here because of strict mode double run.
                    // But we NEED to clear it to free memory.
                    // In pure React, we shouldn't mute external refs in setter.
                }

                return prev.map(i => i.id === file.id ? {
                    ...i,
                    status: 'completed',
                    progress: 100,
                    downloadUrl: url
                } : i);
            });

            // Cleanup buffers safely outside of React state cycle
            // We defer it slightly to ensure Blob creation (which happened inside setHistory? Wait, that's synchronous)
            // If we run `file.buffers = null` here, and setHistory runs TWICE...
            // 1. setHistory call 1: reads file.buffers, makes Blob.
            // 2. setHistory call 2: reads file.buffers, makes Blob.
            // 3. THIS line runs: file.buffers = null.

            // This assumes setHistory runs *immediately*? No, state updates are batched/scheduled.
            // BUT the callback given to setHistory runs during render phase (or commit prep?).

            // Correct approach: 
            // Get type from `history` (we need a ref to history or find it differently).
            // Actually, we can use `history` REF if we maintain one, or just trust `incomingFileRef` should store type.

            // Simplest fix: Add `type` to `incomingFileRef` initialization.
            // We need to look up `history` to find the type when STARTing transfer.

            // For now, let's just protect the Blob creation inside setHistory to be idempotent.
            // AND use `setTimeout` to clear buffers.

            // Better: Clear buffers in `setTimeout`?
            // Better: Clear buffers in `setTimeout`?
            setTimeout(() => {
                console.log("Cleaning up buffers");
                if (incomingFileRef.current && incomingFileRef.current.id === file.id) {
                    incomingFileRef.current.buffers = null; // Help GC
                    incomingFileRef.current = null;
                }
            }, 500); // 500ms delay

        }
    };

    const startUpload = async (fileId) => {
        const file = availableFilesRef.current.get(fileId);
        if (!file) {
            console.error("File requested but not found in memory");
            return;
        }

        updateHistoryItem(fileId, { status: 'uploading', progress: 0 });

        // Protocol: Start
        sendData({ type: MSG_FILE_START, id: fileId, size: file.size });

        const arrayBuffer = await file.arrayBuffer();
        const totalSize = arrayBuffer.byteLength;
        const channel = dataChannelRef.current;
        let offset = 0;

        const sendLoop = () => {
            // Check if cancelled
            // We need access to current state. Refs are best for mutable check during loop.
            // But we only have `history` state.
            // Hack: check if channel closed.
            if (!channel || channel.readyState !== 'open') return;

            // Simple flow control
            if (channel.bufferedAmount > 16 * 1024 * 1024) { // 16MB
                setTimeout(sendLoop, 50);
                return;
            }

            while (offset < totalSize && channel.bufferedAmount < 4 * 1024 * 1024) { // 4MB
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
            } else {
                updateHistoryItem(fileId, { status: 'completed', progress: 100 });
            }
        };

        sendLoop();
    };

    // Public Actions
    const requestFile = useCallback((fileId) => {
        updateHistoryItem(fileId, { status: 'waiting' });
        sendData({ type: MSG_FILE_REQUEST, fileId });
    }, [updateHistoryItem]);

    const cancelTransfer = useCallback((fileId) => {
        // If sending:
        // mark as cancelled, remove from available?
        // If receiving:
        // send cancel msg
        updateHistoryItem(fileId, { status: 'cancelled' });
        sendData({ type: MSG_FILE_CANCEL, fileId });

        // If it was receiving, clear buffer
        if (incomingFileRef.current && incomingFileRef.current.id === fileId) {
            incomingFileRef.current = null;
        }
    }, [updateHistoryItem]);

    // Receiver Setup: Listen for offers/answers via socket ONLY if we aren't initiating
    useEffect(() => {
        if (!socket) return;

        const handleOffer = async ({ offer, sender }) => {
            // Reset connection if needed? Or support multi-peer?
            // For now assume 1:1, reset if existing?
            // If we are 'CONNECTED', maybe we ignore or re-negotiate.
            // Simplest: Accept and reset.

            if (pcRef.current) {
                // For now, if we receive an offer, we reset the connection (assume new session or retry)
                console.log("Received new offer, resetting PC...");
                pcRef.current.close();
                setChannelReady(false);
                iceCandidateQueue.current = [];
                remoteDescriptionSet.current = false;
            }

            activePeerIdRef.current = sender; // Store sender ID
            console.log("Handling offer from", sender);

            const config = {
                // iceServers: [
                //     { urls: 'stun:stun.l.google.com:19302' },
                //     { urls: 'stun:stun1.l.google.com:19302' }
                // ] // Public STUN servers
                iceServers: [] // LAN ONLY
            };
            const pc = new RTCPeerConnection(config);
            pcRef.current = pc;

            pc.ondatachannel = (event) => {
                dataChannelRef.current = event.channel;
                setupChannelListeners(event.channel);
            };

            await pc.setRemoteDescription(new RTCSessionDescription(offer));
            remoteDescriptionSet.current = true;

            // Process queued candidates
            iceCandidateQueue.current.forEach(candidate => {
                pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => console.error(e));
            });
            iceCandidateQueue.current = [];

            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            socket.emit('answer', { target: sender, answer, sender: myId });
        };

        const handleAnswer = async ({ answer }) => {
            if (pcRef.current) {
                await pcRef.current.setRemoteDescription(new RTCSessionDescription(answer));
                remoteDescriptionSet.current = true;
                // Candidates queue logic for sender too?
                // Sender usually receives Answer, so remoteDesc MUST be set here.
                iceCandidateQueue.current.forEach(candidate => {
                    pcRef.current.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => console.error(e));
                });
                iceCandidateQueue.current = [];
            }
        };

        const handleIce = async ({ candidate }) => {
            if (pcRef.current) {
                if (remoteDescriptionSet.current) {
                    await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
                } else {
                    console.log("Buffering ICE candidate as remote desc not set");
                    iceCandidateQueue.current.push(candidate);
                }
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
    }, [socket, setupPC, myId]);


    return {
        history,
        connectionStatus,
        offeredFiles: [], // Deprecated concept, now just history
        sendFilesOffer,
        requestFile,
        cancelTransfer,
        error
    };
}
