import { createSHA256 } from 'hash-wasm';
import {
    CONTROL_CHANNEL_LABEL,
    MSG,
    fileChannelLabel,
    parseFileChannelLabel,
    buildIceServers,
    negotiateChunkSize,
    canStreamSave,
    createTransferId,
    SEND_HIGH_WATER_BYTES,
    SEND_LOW_WATER_BYTES,
    MEMORY_MODE_LIMIT_BYTES,
    STREAM_SAVE_THRESHOLD_BYTES,
    CONNECT_TIMEOUT_MS,
    DISCONNECT_GRACE_MS
} from './protocol';

const PROGRESS_EMIT_INTERVAL_MS = 300;

class TransferAbortedError extends Error {
    constructor(message = 'Transfer aborted') {
        super(message);
        this.name = 'TransferAbortedError';
    }
}

function waitForBufferDrain(channel, targetBytes) {
    return new Promise((resolve) => {
        if (channel.bufferedAmount <= targetBytes || channel.readyState !== 'open') {
            resolve();
            return;
        }

        let settled = false;
        const finish = () => {
            if (settled) return;
            settled = true;
            channel.removeEventListener('bufferedamountlow', finish);
            clearInterval(pollTimer);
            resolve();
        };

        channel.addEventListener('bufferedamountlow', finish);
        // Fallback poll: 'bufferedamountlow' is not guaranteed to fire if the
        // threshold was passed while paused, and timers still tick (throttled)
        // in background tabs, unlike requestAnimationFrame.
        const pollTimer = setInterval(() => {
            if (channel.bufferedAmount <= targetBytes || channel.readyState !== 'open') {
                finish();
            }
        }, 250);
    });
}

function createProgressTracker(onProgress) {
    return {
        lastEmitAt: 0,
        windowBytes: 0,
        windowStartedAt: performance.now(),
        noteTransferred(byteCount, transferred, totalSize) {
            this.windowBytes += byteCount;
            const now = performance.now();
            if (now - this.lastEmitAt < PROGRESS_EMIT_INTERVAL_MS && transferred < totalSize) {
                return;
            }

            const elapsedSeconds = (now - this.windowStartedAt) / 1000;
            const speed = elapsedSeconds > 0 ? this.windowBytes / elapsedSeconds : 0;
            const remaining = totalSize - transferred;
            const eta = speed > 1 ? remaining / speed : null;

            onProgress({
                progress: totalSize > 0 ? Math.floor((transferred / totalSize) * 100) : 100,
                speed: Math.round(speed),
                eta
            });

            this.lastEmitAt = now;
            this.windowBytes = 0;
            this.windowStartedAt = now;
        },
        finish() {
            onProgress({ progress: 100, speed: null, eta: null });
        }
    };
}

// One RTCPeerConnection per remote device. Holds the negotiated connection,
// the always-on control channel, and perfect-negotiation bookkeeping.
class PeerSession {
    constructor(peerId, polite) {
        this.peerId = peerId;
        this.polite = polite;
        this.pc = null;
        this.controlChannel = null;
        this.channelReady = false;
        this.makingOffer = false;
        this.ignoreOffer = false;
        this.remoteDescriptionSet = false;
        this.queuedCandidates = [];
        this.pendingControlMessages = [];
        this.pendingOfferFiles = [];
        this.connectWatchdog = null;
        this.disconnectGraceTimer = null;
        this.iceRestartsAttempted = 0;
        this.tearingDown = false;
        this.createdControlChannel = false;
    }
}

export class TransferEngine {
    constructor({ socket, myId, getPeerName, onEvent }) {
        this.socket = socket;
        this.myId = myId;
        this.getPeerName = getPeerName || (() => 'Unknown');
        this.onEvent = onEvent || (() => {});

        this.sessions = new Map();   // peerId -> PeerSession
        this.outgoing = new Map();   // fileId -> { peerId, file, meta, cancelled, channel, settled }
        this.offered = new Map();    // fileId -> { peerId, name, size, type } (metadata from FILES_OFFER)
        this.receives = new Map();   // fileId -> receive state
        this.downloadUrls = new Map(); // fileId -> object URL
        this.destroyed = false;

        this.attachSocketHandlers();
    }

    updateMyId(newMyId) {
        if (!newMyId || this.myId === newMyId) return;
        this.myId = newMyId;
    }

    // ------------------------------------------------------------------
    // Event helpers
    // ------------------------------------------------------------------

    emit(event) {
        if (!this.destroyed) {
            this.onEvent(event);
        }
    }

    historyAdd(items) {
        this.emit({ type: 'history:add', items });
    }

    historyUpdate(id, updates) {
        this.emit({ type: 'history:update', id, updates });
    }

    peerStatus(peerId, status) {
        this.emit({ type: 'peer-status', peerId, status });
    }

    notifyError(message) {
        this.emit({ type: 'error', message });
    }

    // ------------------------------------------------------------------
    // Signaling
    // ------------------------------------------------------------------

    attachSocketHandlers() {
        const logHandlerError = (label) => (error) => {
            console.error(`[engine] ${label} handler failed:`, error);
        };

        this.socket.on('offer', (data) => { this.handleOffer(data).catch(logHandlerError('offer')); });
        this.socket.on('answer', (data) => { this.handleAnswer(data).catch(logHandlerError('answer')); });
        this.socket.on('ice-candidate', (data) => { this.handleIceCandidate(data).catch(logHandlerError('ice-candidate')); });
    }

    handleOffer = async ({ offer, sender: peerId }) => {
        if (!peerId || !offer) return;

        const session = this.getOrCreateSession(peerId, { asAnswerer: true });

        if (session.tearingDown) return;

        const offerCollision = session.makingOffer || session.pc.signalingState !== 'stable';
        session.ignoreOffer = !session.polite && offerCollision;
        if (session.ignoreOffer) return;

        try {
            await session.pc.setRemoteDescription(offer); // implicit rollback when polite
            session.remoteDescriptionSet = true;
            this.flushQueuedCandidates(session);

            await session.pc.setLocalDescription();
            this.socket.emit('answer', { target: peerId, answer: session.pc.localDescription, sender: this.myId });
        } catch (error) {
            console.error('Failed to handle offer:', error);
        }
    };

    handleAnswer = async ({ answer, sender: peerId }) => {
        const session = this.sessions.get(peerId);
        if (!session || session.tearingDown || !answer) return;

        try {
            await session.pc.setRemoteDescription(answer);
            session.remoteDescriptionSet = true;
            this.flushQueuedCandidates(session);
            this.clearConnectWatchdog(session);
        } catch (error) {
            console.error('Failed to handle answer:', error);
        }
    };

    handleIceCandidate = async ({ candidate, sender: peerId }) => {
        const session = this.sessions.get(peerId);
        if (!session || session.tearingDown || !candidate) return;

        if (!session.remoteDescriptionSet) {
            session.queuedCandidates.push(candidate);
            return;
        }

        try {
            await session.pc.addIceCandidate(candidate);
        } catch (error) {
            if (!session.ignoreOffer) {
                console.error('Failed to add ICE candidate:', error);
            }
        }
    };

    flushQueuedCandidates(session) {
        for (const candidate of session.queuedCandidates) {
            session.pc.addIceCandidate(candidate).catch((error) => console.error(error));
        }
        session.queuedCandidates = [];
    }

    // ------------------------------------------------------------------
    // Session lifecycle
    // ------------------------------------------------------------------

    getOrCreateSession(peerId, { asAnswerer = false } = {}) {
        const existing = this.sessions.get(peerId);
        if (existing) {
            return existing;
        }

        // Deterministic, complementary roles for perfect negotiation.
        const polite = this.myId < peerId;
        const session = new PeerSession(peerId, polite);
        const pc = new RTCPeerConnection({ iceServers: buildIceServers() });

        session.pc = pc;
        this.sessions.set(peerId, session);

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                this.socket.emit('ice-candidate', { target: peerId, candidate: event.candidate, sender: this.myId });
            }
        };

        pc.onconnectionstatechange = () => {
            this.handleConnectionStateChange(session, pc.connectionState);
        };

        if (!asAnswerer) {
            // The initiator creates the control channel; the answerer receives
            // it through ondatachannel.
            const channel = pc.createDataChannel(CONTROL_CHANNEL_LABEL);
            session.controlChannel = channel;
            session.createdControlChannel = true;
            this.attachControlChannel(session, channel);
            this.startConnectWatchdog(session);
            this.peerStatus(peerId, 'CONNECTING');
            this.initiateOffer(session).catch((error) => console.error('Offer failed:', error));
        } else {
            this.peerStatus(peerId, 'CONNECTING');
        }

        pc.ondatachannel = (event) => {
            const { channel } = event;
            const fileId = parseFileChannelLabel(channel.label);

            if (fileId) {
                this.attachFileReceiveChannel(session, channel, fileId);
            } else if (channel.label === CONTROL_CHANNEL_LABEL) {
                // In a glare (both peers connect at once) the losing side's
                // own control channel is superseded by the winner's.
                session.controlChannel = channel;
                this.attachControlChannel(session, channel);
            }
        };

        return session;
    }

    async initiateOffer(session) {
        if (session.tearingDown) return;

        try {
            session.makingOffer = true;
            await session.pc.setLocalDescription(await session.pc.createOffer());
            this.socket.emit('offer', { target: session.peerId, offer: session.pc.localDescription, sender: this.myId });
        } catch (error) {
            console.error('Failed to create offer:', error);
        } finally {
            session.makingOffer = false;
        }
    }

    async attemptIceRestart(session) {
        if (session.tearingDown || session.iceRestartsAttempted >= 1) {
            return false;
        }

        session.iceRestartsAttempted += 1;
        console.log(`Attempting ICE restart with ${session.peerId}`);
        this.peerStatus(session.peerId, 'CONNECTING');
        await this.initiateOffer(session);
        this.startConnectWatchdog(session);
        return true;
    }

    handleConnectionStateChange(session, state) {
        if (session.tearingDown) return;

        if (state === 'connected') {
            this.clearDisconnectGrace(session);
            this.clearConnectWatchdog(session);
            if (session.channelReady) {
                this.peerStatus(session.peerId, 'CONNECTED');
            }
            return;
        }

        if (state === 'disconnected') {
            // Often transient (Wi-Fi hiccup, ICE consent refresh). Give the
            // connection a grace window before touching live transfers.
            if (!session.disconnectGraceTimer) {
                session.disconnectGraceTimer = setTimeout(() => {
                    session.disconnectGraceTimer = null;
                    if (session.pc?.connectionState === 'disconnected') {
                        this.attemptIceRestart(session).then((restarted) => {
                            if (!restarted) {
                                this.teardownSession(session, 'Connection lost during transfer.');
                            }
                        });
                    }
                }, DISCONNECT_GRACE_MS);
            }
            return;
        }

        if (state === 'failed') {
            this.clearDisconnectGrace(session);
            this.attemptIceRestart(session).then((restarted) => {
                if (!restarted) {
                    this.teardownSession(session, 'Connection failed.');
                }
            });
        }
    }

    startConnectWatchdog(session) {
        this.clearConnectWatchdog(session);
        session.connectWatchdog = setTimeout(() => {
            if (
                !session.tearingDown &&
                session.pc?.connectionState !== 'connected' &&
                !session.channelReady
            ) {
                this.teardownSession(
                    session,
                    'Device did not respond. If you are on hotel, university, or public Wi-Fi, the router may have Client Isolation enabled.'
                );
            }
        }, CONNECT_TIMEOUT_MS);
    }

    clearConnectWatchdog(session) {
        if (session.connectWatchdog) {
            clearTimeout(session.connectWatchdog);
            session.connectWatchdog = null;
        }
    }

    clearDisconnectGrace(session) {
        if (session.disconnectGraceTimer) {
            clearTimeout(session.disconnectGraceTimer);
            session.disconnectGraceTimer = null;
        }
    }

    teardownSession(session, reason) {
        if (session.tearingDown) return;
        session.tearingDown = true;

        this.clearConnectWatchdog(session);
        this.clearDisconnectGrace(session);

        const peerId = session.peerId;

        for (const [fileId, entry] of this.outgoing.entries()) {
            if (entry.peerId === peerId) {
                entry.cancelled = true;
                this.outgoing.delete(fileId);
                this.historyUpdate(fileId, { status: 'error', error: reason, speed: null, eta: null });
            }
        }

        for (const [fileId, receive] of this.receives.entries()) {
            if (receive.peerId === peerId) {
                this.discardReceive(fileId, receive);
                this.historyUpdate(fileId, { status: 'error', error: reason, speed: null, eta: null });
            }
        }

        // Files that were offered but never downloaded can no longer be
        // requested from this session.
        for (const [fileId, meta] of this.offered.entries()) {
            if (meta.peerId === peerId) {
                this.offered.delete(fileId);
                this.historyUpdate(fileId, { status: 'error', error: 'Peer disconnected.' });
            }
        }

        try {
            session.pc?.close();
        } catch {
            // already closed
        }

        this.sessions.delete(peerId);
        this.peerStatus(peerId, 'DISCONNECTED');

        if (reason && reason !== 'Session ended.' && reason !== 'Connection closed.') {
            this.notifyError(reason);
        }
    }

    // ------------------------------------------------------------------
    // Control channel
    // ------------------------------------------------------------------

    attachControlChannel(session, channel) {
        channel.onopen = () => {
            try {
                channel.send(JSON.stringify({ type: MSG.HANDSHAKE_SYN }));
            } catch {
                // channel closed immediately
            }
        };

        // A received channel can, in rare timings, already be open when
        // ondatachannel delivers it — its onopen would never fire.
        if (channel.readyState === 'open') {
            channel.onopen();
        }

        channel.onmessage = (event) => {
            if (typeof event.data !== 'string') return;

            let msg;
            try {
                msg = JSON.parse(event.data);
            } catch {
                return;
            }

            this.handleControlMessage(session, msg);
        };

        channel.onclose = () => {
            if (session.tearingDown) return;

            // Grace period: during glare resolution a superseded control
            // channel closes right as the winning one arrives. Only tear the
            // session down if this is still the active channel afterwards.
            setTimeout(() => {
                if (session.tearingDown || session.controlChannel !== channel) return;
                this.teardownSession(session, 'Connection closed.');
            }, 1200);
        };
    }

    handleControlMessage(session, msg) {
        switch (msg.type) {
            case MSG.HANDSHAKE_SYN:
                this.sendOnControl(session, { type: MSG.HANDSHAKE_ACK });
                this.markControlReady(session);
                break;

            case MSG.HANDSHAKE_ACK:
                this.markControlReady(session);
                break;

            case MSG.FILES_OFFER:
                this.handleFilesOffer(session, msg.files || []);
                break;

            case MSG.FILE_REQUEST:
                this.startUpload(session, msg.fileId).catch((error) => {
                    console.error('Upload failed:', error);
                });
                break;

            case MSG.FILE_CANCEL:
                this.handleRemoteCancel(msg.fileId);
                break;

            case MSG.CHAT_MESSAGE:
                this.emit({ type: 'chat', peerId: session.peerId, message: msg });
                break;
        }
    }

    markControlReady(session) {
        if (session.channelReady) return;

        session.channelReady = true;
        this.clearConnectWatchdog(session);

        if (session.pc?.connectionState === 'connected') {
            this.peerStatus(session.peerId, 'CONNECTED');
        }

        for (const pending of session.pendingControlMessages) {
            this.sendOnControl(session, pending);
        }
        session.pendingControlMessages = [];

        if (session.pendingOfferFiles.length > 0) {
            const files = session.pendingOfferFiles;
            session.pendingOfferFiles = [];
            this.sendOnControl(session, { type: MSG.FILES_OFFER, files });
        }
    }

    sendOnControl(session, msg) {
        const channel = session.controlChannel;
        if (channel && channel.readyState === 'open') {
            channel.send(JSON.stringify(msg));
        } else {
            session.pendingControlMessages.push(msg);
        }
    }

    // ------------------------------------------------------------------
    // Outgoing files
    // ------------------------------------------------------------------

    offerFiles(peerId, files) {
        const session = this.getOrCreateSession(peerId);
        const peerName = this.getPeerName(peerId);
        const newItems = [];
        const offeredFiles = [];

        Array.from(files).forEach((file) => {
            const id = createTransferId();

            this.outgoing.set(id, {
                peerId,
                file,
                cancelled: false,
                channel: null,
                settled: false
            });

            offeredFiles.push({ id, name: file.name, size: file.size, type: file.type });

            newItems.push({
                id,
                fileName: file.name,
                fileSize: file.size,
                fileType: file.type,
                direction: 'out',
                status: 'idle',
                progress: 0,
                peerId,
                peerName,
                speed: null,
                eta: null
            });
        });

        this.historyAdd(newItems);

        if (session.channelReady) {
            this.sendOnControl(session, { type: MSG.FILES_OFFER, files: offeredFiles });
        } else {
            session.pendingOfferFiles.push(...offeredFiles);
        }
    }

    async startUpload(session, fileId) {
        const entry = this.outgoing.get(fileId);
        if (!entry || entry.peerId !== session.peerId) {
            // Sender no longer has the file (e.g. refreshed the page).
            this.sendOnControl(session, { type: MSG.FILE_CANCEL, fileId, reason: 'File is no longer available' });
            return;
        }

        if (entry.channel) return; // already uploading

        entry.cancelled = false;
        this.historyUpdate(fileId, { status: 'uploading', progress: 0, error: null });

        const channel = session.pc.createDataChannel(fileChannelLabel(fileId));
        channel.binaryType = 'arraybuffer';
        channel.bufferedAmountLowThreshold = SEND_LOW_WATER_BYTES;
        entry.channel = channel;

        channel.onopen = () => {
            this.runUpload(session, fileId, entry, channel).catch((error) => {
                console.error('Upload loop failed:', error);
            });
        };

        channel.onclose = () => {
            if (!entry.settled && !entry.cancelled) {
                entry.settled = true;
                this.outgoing.delete(fileId);
                this.historyUpdate(fileId, { status: 'error', error: 'Connection closed during transfer.', speed: null, eta: null });
            }
        };
    }

    async runUpload(session, fileId, entry, channel) {
        const { file } = entry;
        const totalSize = file.size;
        const chunkSize = negotiateChunkSize(session.pc?.sctp?.maxMessageSize);
        const hasher = await createSHA256();
        const progress = createProgressTracker((update) => {
            if (!entry.cancelled) {
                this.historyUpdate(fileId, update);
            }
        });

        let offset = 0;

        try {
            while (offset < totalSize) {
                if (entry.cancelled) throw new TransferAbortedError();
                if (channel.readyState !== 'open') throw new TransferAbortedError('Connection closed during transfer.');

                if (channel.bufferedAmount > SEND_HIGH_WATER_BYTES) {
                    await waitForBufferDrain(channel, SEND_LOW_WATER_BYTES);
                    continue;
                }

                const buffer = await file.slice(offset, offset + chunkSize).arrayBuffer();

                if (entry.cancelled) throw new TransferAbortedError();
                if (channel.readyState !== 'open') throw new TransferAbortedError('Connection closed during transfer.');

                channel.send(buffer);
                hasher.update(new Uint8Array(buffer));
                offset += buffer.byteLength;
                progress.noteTransferred(buffer.byteLength, offset, totalSize);
            }

            await waitForBufferDrain(channel, 0);
            channel.send(JSON.stringify({
                type: MSG.FILE_END,
                id: fileId,
                digest: hasher.digest('hex'),
                size: totalSize
            }));
            await waitForBufferDrain(channel, 0);

            entry.settled = true;
            this.outgoing.delete(fileId);
            progress.finish();
            this.historyUpdate(fileId, { status: 'completed', progress: 100, speed: null, eta: null, verified: true });
            channel.close();
        } catch (error) {
            entry.settled = true;
            this.outgoing.delete(fileId);

            try {
                channel.close();
            } catch {
                // already closed
            }

            if (entry.cancelled || error instanceof TransferAbortedError) {
                this.historyUpdate(fileId, { status: 'cancelled', speed: null, eta: null });
            } else {
                this.historyUpdate(fileId, { status: 'error', error: error.message || 'Upload failed.', speed: null, eta: null });
            }
        }
    }

    // ------------------------------------------------------------------
    // Incoming files
    // ------------------------------------------------------------------

    handleFilesOffer(session, files) {
        const peerName = this.getPeerName(session.peerId);
        const streamCapable = canStreamSave();
        const newItems = [];

        files.forEach((meta) => {
            if (!meta || typeof meta.id !== 'string') return;
            if (this.offered.has(meta.id) || this.receives.has(meta.id)) return;

            this.offered.set(meta.id, {
                peerId: session.peerId,
                name: meta.name,
                size: meta.size,
                type: meta.type
            });

            const tooLargeForBrowser = !streamCapable && meta.size > MEMORY_MODE_LIMIT_BYTES;

            newItems.push({
                id: meta.id,
                fileName: meta.name,
                fileSize: meta.size,
                fileType: meta.type,
                direction: 'in',
                status: tooLargeForBrowser ? 'error' : 'idle',
                error: tooLargeForBrowser
                    ? 'File is too large for this browser (2 GB limit). Use Chrome or Edge on desktop for large files.'
                    : undefined,
                progress: 0,
                peerId: session.peerId,
                peerName,
                speed: null,
                eta: null
            });
        });

        if (newItems.length > 0) {
            this.historyAdd(newItems);
            this.emit({
                type: 'notify',
                title: `Incoming files from ${peerName}`,
                body: newItems.map((item) => item.fileName).join(', ')
            });
        }
    }

    async requestFile(fileId) {
        const meta = this.offered.get(fileId);
        if (!meta) return;

        const session = this.sessions.get(meta.peerId);
        if (!session || !session.channelReady) {
            this.historyUpdate(fileId, { status: 'error', error: 'Peer is no longer connected.' });
            this.offered.delete(fileId);
            return;
        }

        const state = {
            id: fileId,
            peerId: meta.peerId,
            name: meta.name,
            size: meta.size,
            type: meta.type || 'application/octet-stream',
            received: 0,
            mode: 'memory',
            stream: null,          // FileSystemWritableFileStream when streaming
            writeChain: Promise.resolve(),
            buffers: [],
            hasher: null,
            finalized: false
        };

        if (canStreamSave() && meta.size > STREAM_SAVE_THRESHOLD_BYTES) {
            try {
                const handle = await window.showSaveFilePicker({ suggestedName: meta.name });
                state.mode = 'fs-access';
                state.stream = await handle.createWritable();
            } catch (pickerError) {
                if (pickerError?.name === 'AbortError') {
                    // User dismissed the save dialog; keep the item idle.
                    return;
                }
                console.error('Save picker failed:', pickerError);
                // Fall back to memory mode.
            }
        }

        if (state.mode === 'memory' && meta.size > MEMORY_MODE_LIMIT_BYTES) {
            this.historyUpdate(fileId, { status: 'error', error: 'File exceeds the 2 GB in-memory limit of this browser.' });
            this.offered.delete(fileId);
            return;
        }

        state.hasher = await createSHA256();
        this.receives.set(fileId, state);
        this.historyUpdate(fileId, { status: 'waiting', error: null });
        this.sendOnControl(session, { type: MSG.FILE_REQUEST, fileId });
    }

    attachFileReceiveChannel(session, channel, fileId) {
        const state = this.receives.get(fileId);
        channel.binaryType = 'arraybuffer';

        if (!state) {
            // Transfer was cancelled or never requested; close the channel —
            // sender treats the close as interruption.
            try {
                channel.close();
            } catch {
                // ignore
            }
            return;
        }

        this.historyUpdate(fileId, { status: 'downloading', progress: 0, error: null });

        const progress = createProgressTracker((update) => {
            if (!state.finalized) {
                this.historyUpdate(fileId, update);
            }
        });

        channel.onmessage = async (event) => {
            if (state.finalized) return;

            if (typeof event.data === 'string') {
                let msg;
                try {
                    msg = JSON.parse(event.data);
                } catch {
                    return;
                }
                if (msg.type === MSG.FILE_END) {
                    this.finalizeReceive(fileId, state, msg).catch((error) => {
                        console.error('Finalize failed:', error);
                    });
                }
                return;
            }

            const chunk = event.data;
            state.received += chunk.byteLength;
            state.hasher?.update(new Uint8Array(chunk));

            if (state.mode === 'fs-access' && state.stream) {
                state.writeChain = state.writeChain.then(() => state.stream.write(chunk)).catch((error) => {
                    if (!state.finalized) {
                        state.finalized = true;
                        this.discardReceive(fileId, state);
                        this.historyUpdate(fileId, { status: 'error', error: `Could not write to disk: ${error.message}` });
                    }
                });
            } else {
                state.buffers.push(chunk);
            }

            progress.noteTransferred(chunk.byteLength, state.received, state.size);
        };

        channel.onclose = () => {
            if (!state.finalized && state.received < state.size) {
                state.finalized = true;
                this.discardReceive(fileId, state);
                this.historyUpdate(fileId, { status: 'error', error: 'Transfer interrupted.' });
            }
        };
    }

    async finalizeReceive(fileId, state, endMsg) {
        if (state.finalized) return;
        state.finalized = true;

        if (state.received < state.size) {
            this.discardReceive(fileId, state);
            this.historyUpdate(fileId, { status: 'error', error: 'Transfer incomplete.' });
            return;
        }

        const digest = state.hasher?.digest('hex');
        const verified = Boolean(digest && endMsg.digest && digest === endMsg.digest);

        if (state.mode === 'fs-access' && state.stream) {
            try {
                await state.writeChain;
                await state.stream.close();
            } catch (error) {
                this.discardReceive(fileId, state);
                this.historyUpdate(fileId, { status: 'error', error: `Could not write to disk: ${error.message}` });
                return;
            }

            this.receives.delete(fileId);
            this.offered.delete(fileId);
            this.historyUpdate(fileId, { status: 'completed', progress: 100, saved: true, verified, speed: null, eta: null });
            return;
        }

        try {
            const blob = new Blob(state.buffers, { type: state.type });
            const url = URL.createObjectURL(blob);
            this.downloadUrls.set(fileId, url);

            this.receives.delete(fileId);
            this.offered.delete(fileId);
            state.buffers = [];

            this.historyUpdate(fileId, {
                status: 'completed',
                progress: 100,
                downloadUrl: url,
                verified,
                speed: null,
                eta: null
            });
        } catch (error) {
            this.discardReceive(fileId, state);
            this.historyUpdate(fileId, { status: 'error', error: `Could not assemble file: ${error.message}` });
        }
    }

    discardReceive(fileId, state) {
        if (state.mode === 'fs-access' && state.stream) {
            state.stream.abort?.().catch(() => {});
        }
        state.buffers = [];
        this.receives.delete(fileId);
        this.offered.delete(fileId);
        const url = this.downloadUrls.get(fileId);
        if (url) {
            URL.revokeObjectURL(url);
            this.downloadUrls.delete(fileId);
        }
    }

    saveReceivedFile(fileId, fileName) {
        const url = this.downloadUrls.get(fileId);
        if (!url) return;

        const link = document.createElement('a');
        link.href = url;
        link.download = fileName || 'file';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        this.historyUpdate(fileId, { saved: true, downloadUrl: null });
        this.downloadUrls.delete(fileId);
        // Delay revoking to give browser download manager ample time to stream large files from RAM to disk
        window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    }

    // ------------------------------------------------------------------
    // Cancellation
    // ------------------------------------------------------------------

    cancelTransfer(fileId) {
        const url = this.downloadUrls.get(fileId);
        if (url) {
            URL.revokeObjectURL(url);
            this.downloadUrls.delete(fileId);
        }

        const outgoingEntry = this.outgoing.get(fileId);
        const receiveState = this.receives.get(fileId);
        const offeredMeta = this.offered.get(fileId);
        const session = this.sessions.get(
            outgoingEntry?.peerId || receiveState?.peerId || offeredMeta?.peerId
        );

        if (outgoingEntry) {
            outgoingEntry.cancelled = true;
            this.outgoing.delete(fileId);
            try {
                outgoingEntry.channel?.close();
            } catch {
                // ignore
            }
            this.historyUpdate(fileId, { status: 'cancelled', speed: null, eta: null });
        } else if (receiveState) {
            receiveState.finalized = true;
            this.discardReceive(fileId, receiveState);
            this.historyUpdate(fileId, { status: 'cancelled', speed: null, eta: null });
        } else if (offeredMeta) {
            this.offered.delete(fileId);
            this.historyUpdate(fileId, { status: 'cancelled' });
        } else {
            return;
        }

        if (session) {
            this.sendOnControl(session, { type: MSG.FILE_CANCEL, fileId });
        }
    }

    handleRemoteCancel(fileId) {
        const url = this.downloadUrls.get(fileId);
        if (url) {
            URL.revokeObjectURL(url);
            this.downloadUrls.delete(fileId);
        }

        const outgoingEntry = this.outgoing.get(fileId);

        if (outgoingEntry) {
            outgoingEntry.cancelled = true;
            this.outgoing.delete(fileId);
            try {
                outgoingEntry.channel?.close();
            } catch {
                // ignore
            }
            this.historyUpdate(fileId, { status: 'cancelled', speed: null, eta: null });
            return;
        }

        const receiveState = this.receives.get(fileId);
        if (receiveState) {
            receiveState.finalized = true;
            this.discardReceive(fileId, receiveState);
            this.historyUpdate(fileId, { status: 'cancelled', speed: null, eta: null });
            return;
        }

        const offeredMeta = this.offered.get(fileId);
        if (offeredMeta) {
            this.offered.delete(fileId);
            this.historyUpdate(fileId, { status: 'cancelled' });
        }
    }

    // ------------------------------------------------------------------
    // Chat
    // ------------------------------------------------------------------

    sendChat(peerId, text) {
        if (!peerId || typeof text !== 'string' || text.trim() === '') return;

        const session = this.getOrCreateSession(peerId);
        const message = {
            type: MSG.CHAT_MESSAGE,
            id: createTransferId(),
            text: text.slice(0, 4000),
            ts: Date.now()
        };

        this.sendOnControl(session, message);
    }

    // ------------------------------------------------------------------
    // Teardown
    // ------------------------------------------------------------------

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;

        for (const session of Array.from(this.sessions.values())) {
            this.teardownSession(session, 'Session ended.');
        }

        this.downloadUrls.forEach((url) => URL.revokeObjectURL(url));
        this.downloadUrls.clear();

        this.socket.off('offer');
        this.socket.off('answer');
        this.socket.off('ice-candidate');
    }
}
