import { createSHA256 } from 'hash-wasm';
import {
    CONTROL_CHANNEL_LABEL,
    MSG,
    FILE_STATUS,
    fileChannelLabel,
    parseFileChannelLabel,
    buildIceServers,
    negotiateChunkSize,
    canStreamSave,
    canOpfsSave,
    createTransferId,
    SEND_HIGH_WATER_BYTES,
    SEND_LOW_WATER_BYTES,
    MEMORY_MODE_LIMIT_BYTES,
    STREAM_SAVE_THRESHOLD_BYTES,
    CONNECT_TIMEOUT_MS,
    DISCONNECT_GRACE_MS,
    RELAY_MAX_FILE_SIZE_BYTES,
    RELAY_SIZE_LIMIT_ERROR,
    STRICT_LOCAL_RELAY_BLOCKED_ERROR,
    isRelayCandidate,
    stripRelayFromSdp,
    resolveTurnApiUrl
} from './protocol';
import { wakeLockManager } from './wakeLock';
import { playTransferCompleteChime, startAudioBeacon, stopAudioBeacon } from './sound';


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
        this.connectionType = 'direct-lan';
    }
}

export class TransferEngine {
    constructor({
        socket,
        myId,
        getPeerName,
        onEvent,
        turnApiUrl = '/api/turn-credentials',
        turnCredentials = null,
        strictLocalMode = false,
        fetchTurnCredentials = true
    } = {}) {
        this.socket = socket;
        this.myId = myId;
        this.getPeerName = getPeerName || (() => 'Unknown');
        this.onEvent = onEvent || (() => {});

        this.sessions = new Map();   // peerId -> PeerSession
        this.outgoing = new Map();   // fileId -> { peerId, file, meta, cancelled, channel, settled }
        this.offered = new Map();    // fileId -> { peerId, name, size, type } (metadata from FILES_OFFER)
        this.receives = new Map();   // fileId -> receive state
        this.downloadUrls = new Map(); // fileId -> object URL
        this.activeTransferIds = new Set(); // fileId -> active upload or download
        this.destroyed = false;

        this.turnApiUrl = resolveTurnApiUrl(turnApiUrl, socket);
        this.turnCredentials = turnCredentials;
        this.strictLocalMode = Boolean(strictLocalMode);

        if (fetchTurnCredentials && !turnCredentials && (typeof window !== 'undefined' || this.turnApiUrl.startsWith('http'))) {
            this.loadTurnCredentials().catch(() => {});
        }

        this.attachSocketHandlers();
    }

    markTransferActive(fileId) {
        if (!this.activeTransferIds.has(fileId)) {
            const wasEmpty = this.activeTransferIds.size === 0;
            this.activeTransferIds.add(fileId);
            wakeLockManager.acquire().catch(() => {});
            if (wasEmpty) {
                startAudioBeacon();
            }
        }
    }

    markTransferInactive(fileId) {
        if (this.activeTransferIds.has(fileId)) {
            this.activeTransferIds.delete(fileId);
            wakeLockManager.release().catch(() => {});
            if (this.activeTransferIds.size === 0) {
                stopAudioBeacon();
            }
        }
    }


    async loadTurnCredentials() {
        try {
            const url = resolveTurnApiUrl(this.turnApiUrl, this.socket);
            const res = await fetch(url);
            if (res.ok) {
                const data = await res.json();
                this.setTurnCredentials(data);
                return data;
            }
        } catch (err) {
            console.warn('[engine] Could not load TURN credentials from server:', err);
        }
        return null;
    }

    setTurnCredentials(credentials) {
        this.turnCredentials = credentials;
        const newIceServers = buildIceServers(this.turnCredentials, { strictLocalMode: this.strictLocalMode });
        for (const session of this.sessions.values()) {
            if (session.pc && typeof session.pc.setConfiguration === 'function') {
                try {
                    session.pc.setConfiguration({ iceServers: newIceServers });
                } catch {
                    // ignore if immutable in current state
                }
            }
        }
    }

    setStrictLocalMode(enabled) {
        this.strictLocalMode = Boolean(enabled);
        const newIceServers = buildIceServers(this.turnCredentials, { strictLocalMode: this.strictLocalMode });
        for (const session of this.sessions.values()) {
            if (session.pc && typeof session.pc.setConfiguration === 'function') {
                try {
                    session.pc.setConfiguration({ iceServers: newIceServers });
                } catch {
                    // ignore if immutable in current state
                }
            }
            if (this.strictLocalMode && session.connectionType === 'relay-turn') {
                this.checkRelayCapForSession(session);
            }
        }
    }

    getConnectionType(peerId) {
        return this.sessions.get(peerId)?.connectionType || 'direct-lan';
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

        if (this.strictLocalMode && offer.sdp) {
            offer = { ...offer, sdp: stripRelayFromSdp(offer.sdp) };
        }

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

        if (this.strictLocalMode && answer.sdp) {
            answer = { ...answer, sdp: stripRelayFromSdp(answer.sdp) };
        }

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

        if (this.strictLocalMode && isRelayCandidate(candidate)) {
            return;
        }

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
        const pc = new RTCPeerConnection({
            iceServers: buildIceServers(this.turnCredentials, { strictLocalMode: this.strictLocalMode })
        });

        session.pc = pc;
        this.sessions.set(peerId, session);

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                if (this.strictLocalMode && isRelayCandidate(event.candidate)) {
                    return;
                }
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

    async initiateOffer(session, options = {}) {
        if (session.tearingDown) return;

        try {
            session.makingOffer = true;
            await session.pc.setLocalDescription(await session.pc.createOffer(options));
            this.socket.emit('offer', { target: session.peerId, offer: session.pc.localDescription, sender: this.myId });
        } catch (error) {
            console.error('Failed to create offer:', error);
        } finally {
            session.makingOffer = false;
        }
    }

    async attemptIceRestart(session) {
        if (session.tearingDown || session.iceRestartsAttempted >= 2) {
            return false;
        }

        session.iceRestartsAttempted += 1;
        console.log(`Attempting ICE restart with ${session.peerId}`);
        this.peerStatus(session.peerId, 'CONNECTING');
        if (typeof session.pc?.restartIce === 'function') {
            try {
                session.pc.restartIce();
            } catch {
                // ignore
            }
        }
        await this.initiateOffer(session, { iceRestart: true });
        this.startConnectWatchdog(session);
        return true;
    }

    handleConnectionStateChange(session, state) {
        if (session.tearingDown) return;

        if (state === 'connected') {
            this.clearDisconnectGrace(session);
            this.clearConnectWatchdog(session);
            session.iceRestartsAttempted = 0;
            this.detectConnectionType(session);
            if (session.channelReady) {
                this.peerStatus(session.peerId, 'CONNECTED');
                this.resumeActiveReceivesForSession(session);
            }
            return;
        }


        if (state === 'disconnected') {
            // Often transient (Wi-Fi hiccup, ICE consent refresh). Give the
            // connection a brief grace window before triggering ICE restart.
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
                }, 2000);
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

    async detectConnectionType(session) {
        if (!session || !session.pc) return 'direct-lan';
        try {
            if (typeof session.pc.getStats === 'function') {
                const stats = await session.pc.getStats();
                const type = this.parseConnectionType(stats);
                if (type) {
                    session.connectionType = type;
                    this.emit({ type: 'connection-type', peerId: session.peerId, connectionType: type });
                    this.checkRelayCapForSession(session);
                    return type;
                }
            }
        } catch (err) {
            console.warn('[engine] Failed to getStats for connection type:', err);
        }
        return session.connectionType || 'direct-lan';
    }

    parseConnectionType(stats) {
        if (!stats) return 'direct-lan';

        let selectedPair = null;
        const reports = typeof stats.values === 'function'
            ? Array.from(stats.values())
            : (Array.isArray(stats) ? stats : Object.values(stats));

        const findReport = (id) => {
            if (!id) return null;
            if (typeof stats.get === 'function') return stats.get(id);
            return reports.find((r) => r && r.id === id);
        };

        for (const report of reports) {
            if (report && report.type === 'candidate-pair') {
                if (report.selected || (report.nominated && (report.state === 'succeeded' || report.state === 'in-progress'))) {
                    selectedPair = report;
                    break;
                }
            }
        }

        if (!selectedPair) {
            for (const report of reports) {
                if (report && report.type === 'transport' && report.selectedCandidatePairId) {
                    const pair = findReport(report.selectedCandidatePairId);
                    if (pair) {
                        selectedPair = pair;
                        break;
                    }
                }
            }
        }

        if (selectedPair) {
            const local = findReport(selectedPair.localCandidateId);
            const remote = findReport(selectedPair.remoteCandidateId);

            const localType = local?.candidateType || selectedPair.localCandidateType;
            const remoteType = remote?.candidateType || selectedPair.remoteCandidateType;

            if (localType === 'relay' || remoteType === 'relay') {
                return 'relay-turn';
            }
            if (localType === 'srflx' || remoteType === 'srflx' || localType === 'prflx' || remoteType === 'prflx') {
                return 'direct-stun';
            }
            if (localType === 'host' && remoteType === 'host') {
                return 'direct-lan';
            }
        }

        for (const report of reports) {
            if (report && (report.type === 'local-candidate' || report.type === 'remote-candidate')) {
                if (report.candidateType === 'relay' && (report.selected || report.nominated)) {
                    return 'relay-turn';
                }
                if ((report.candidateType === 'srflx' || report.candidateType === 'prflx') && (report.selected || report.nominated)) {
                    return 'direct-stun';
                }
            }
        }

        return 'direct-lan';
    }

    getRelayBlockError(isStrict = this.strictLocalMode) {
        return isStrict ? STRICT_LOCAL_RELAY_BLOCKED_ERROR : RELAY_SIZE_LIMIT_ERROR;
    }

    checkRelayCapForSession(session) {
        if (!session || session.connectionType !== 'relay-turn') return;

        const isStrict = this.strictLocalMode;
        const errorMsg = this.getRelayBlockError(isStrict);
        const shouldBlock = (size) => isStrict || size > RELAY_MAX_FILE_SIZE_BYTES;

        // 1. Check pending offer files
        if (session.pendingOfferFiles && session.pendingOfferFiles.length > 0) {
            const blocked = [];
            session.pendingOfferFiles = session.pendingOfferFiles.filter((f) => {
                if (shouldBlock(f.size)) {
                    blocked.push(f);
                    return false;
                }
                return true;
            });

            for (const f of blocked) {
                this.outgoing.delete(f.id);
                this.historyUpdate(f.id, {
                    status: FILE_STATUS.BLOCKED,
                    error: errorMsg,
                    speed: null,
                    eta: null
                });
            }

            if (blocked.length > 0) {
                this.notifyError(errorMsg);
            }
        }

        // 2. Check active outgoing entries
        for (const [fileId, entry] of this.outgoing.entries()) {
            if (entry.peerId === session.peerId && shouldBlock(entry.file.size)) {
                entry.cancelled = true;
                entry.settled = true;
                this.outgoing.delete(fileId);
                this.historyUpdate(fileId, {
                    status: FILE_STATUS.BLOCKED,
                    error: errorMsg,
                    speed: null,
                    eta: null
                });
                this.sendOnControl(session, {
                    type: MSG.FILE_CANCEL,
                    fileId,
                    reason: errorMsg
                });
                this.notifyError(errorMsg);
            }
        }

        // 3. Check offered incoming entries
        for (const [fileId, meta] of this.offered.entries()) {
            if (meta.peerId === session.peerId && shouldBlock(meta.size)) {
                this.offered.delete(fileId);
                this.historyUpdate(fileId, {
                    status: FILE_STATUS.BLOCKED,
                    error: errorMsg
                });
            }
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
                if (entry.graceTimer) {
                    clearTimeout(entry.graceTimer);
                    entry.graceTimer = null;
                }
                entry.cancelled = true;
                this.outgoing.delete(fileId);
                this.markTransferInactive(fileId);
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
                this.startUpload(session, msg.fileId, msg.fromOffset || 0).catch((error) => {
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

    resumeActiveReceivesForSession(session) {
        for (const [fileId, state] of this.receives.entries()) {
            if (state.peerId === session.peerId && !state.finalized && state.received < state.size) {
                if (state.retryCount < 2) {
                    state.retryCount += 1;
                    this.sendOnControl(session, {
                        type: MSG.FILE_REQUEST,
                        fileId,
                        fromOffset: state.received
                    });
                } else {
                    state.finalized = true;
                    this.discardReceive(fileId, state);
                    this.historyUpdate(fileId, {
                        status: FILE_STATUS.FAILED,
                        error: 'Recovery failed after 2 attempts. Click Restart Transfer to try again.',
                        speed: null,
                        eta: null
                    });
                }
            }
        }
    }

    markControlReady(session) {
        if (session.channelReady) return;

        session.channelReady = true;
        this.clearConnectWatchdog(session);

        if (session.connectionType === 'relay-turn') {
            this.checkRelayCapForSession(session);
        }

        if (session.pc?.connectionState === 'connected') {
            this.peerStatus(session.peerId, 'CONNECTED');
        }

        for (const pending of session.pendingControlMessages) {
            this.sendOnControl(session, pending);
        }
        session.pendingControlMessages = [];

        if (session.pendingOfferFiles.length > 0) {
            const files = session.pendingOfferFiles.filter((file) => {
                const entry = this.outgoing.get(file.id);
                return entry && !entry.cancelled;
            });
            session.pendingOfferFiles = [];
            if (files.length > 0) {
                this.sendOnControl(session, { type: MSG.FILES_OFFER, files });
                for (const file of files) {
                    this.historyUpdate(file.id, { status: FILE_STATUS.OFFERED });
                }
            }
        }

        this.resumeActiveReceivesForSession(session);
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

            const isRelay = session.connectionType === 'relay-turn';
            const isStrictRelayBlocked = isRelay && this.strictLocalMode;
            const isRelayCapBlocked = isRelay && file.size > RELAY_MAX_FILE_SIZE_BYTES;

            if (isStrictRelayBlocked || isRelayCapBlocked) {
                const errorMsg = this.getRelayBlockError(isStrictRelayBlocked);
                newItems.push({
                    id,
                    fileName: file.name,
                    fileSize: file.size,
                    fileType: file.type,
                    direction: 'out',
                    status: FILE_STATUS.BLOCKED,
                    error: errorMsg,
                    progress: 0,
                    peerId,
                    peerName,
                    speed: null,
                    eta: null
                });
                this.notifyError(errorMsg);
                return;
            }

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
                status: session.channelReady ? FILE_STATUS.OFFERED : FILE_STATUS.CONNECTING,
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

    async startUpload(session, fileId, fromOffset = 0) {
        const entry = this.outgoing.get(fileId);
        if (!entry || entry.peerId !== session.peerId) {
            // Sender no longer has the file (e.g. refreshed the page).
            this.sendOnControl(session, { type: MSG.FILE_CANCEL, fileId, reason: 'File is no longer available' });
            return;
        }

        const isRelay = session.connectionType === 'relay-turn';
        const isStrictRelayBlocked = isRelay && this.strictLocalMode;
        const isRelayCapBlocked = isRelay && entry.file.size > RELAY_MAX_FILE_SIZE_BYTES;

        if (isStrictRelayBlocked || isRelayCapBlocked) {
            const errorMsg = this.getRelayBlockError(isStrictRelayBlocked);
            entry.settled = true;
            this.outgoing.delete(fileId);
            this.markTransferInactive(fileId);
            this.historyUpdate(fileId, {
                status: FILE_STATUS.BLOCKED,
                error: errorMsg,
                speed: null,
                eta: null
            });
            this.sendOnControl(session, {
                type: MSG.FILE_CANCEL,
                fileId,
                reason: errorMsg
            });
            this.notifyError(errorMsg);
            return;
        }

        if (entry.graceTimer) {
            clearTimeout(entry.graceTimer);
            entry.graceTimer = null;
        }

        if (entry.channel && entry.channel.readyState === 'open' && entry.uploading) {
            try {
                entry.channel.close();
            } catch {
                // ignore
            }
        }

        const safeOffset = Math.max(0, Math.min(entry.file.size, Number(fromOffset) || 0));
        entry.cancelled = false;
        entry.settled = false;
        entry.uploading = true;
        this.markTransferActive(fileId);

        const initialProgress = entry.file.size > 0 ? Math.floor((safeOffset / entry.file.size) * 100) : 0;
        this.historyUpdate(fileId, { status: 'uploading', progress: initialProgress, error: null });

        const channel = session.pc.createDataChannel(fileChannelLabel(fileId));
        channel.binaryType = 'arraybuffer';
        channel.bufferedAmountLowThreshold = SEND_LOW_WATER_BYTES;
        entry.channel = channel;

        channel.onopen = () => {
            this.runUpload(session, fileId, entry, channel, safeOffset).catch((error) => {
                console.error('Upload loop failed:', error);
            });
        };

        if (channel.readyState === 'open') {
            channel.onopen();
        }

        channel.onclose = () => {
            if (!entry.settled && !entry.cancelled) {
                entry.channel = null;
                entry.uploading = false;
                this.historyUpdate(fileId, { speed: null, eta: null });
                if (entry.graceTimer) {
                    clearTimeout(entry.graceTimer);
                }
                entry.graceTimer = setTimeout(() => {
                    entry.graceTimer = null;
                    if (!entry.settled && !entry.cancelled) {
                        this.markTransferInactive(fileId);
                        this.historyUpdate(fileId, { status: 'error', error: 'Transfer interrupted.', speed: null, eta: null });
                    }
                }, DISCONNECT_GRACE_MS);

            }
        };
    }

    async runUpload(session, fileId, entry, channel, fromOffset = 0) {
        const file = entry.file;
        const totalSize = file.size;
        const chunkSize = negotiateChunkSize(session.pc?.sctp?.maxMessageSize);
        const hasher = await createSHA256();

        // If resuming from offset > 0, hash 0..fromOffset to ensure end-to-end SHA-256 integrity
        if (fromOffset > 0) {
            if (entry.digest) {
                // Already have the full file digest cached
            } else {
                let hOffset = 0;
                const HASH_BLOCK = 1024 * 1024;
                while (hOffset < fromOffset) {
                    if (entry.cancelled) throw new TransferAbortedError();
                    const blk = await file.slice(hOffset, Math.min(fromOffset, hOffset + HASH_BLOCK)).arrayBuffer();
                    hasher.update(new Uint8Array(blk));
                    hOffset += blk.byteLength;
                }
            }
        }

        const progress = createProgressTracker((update) => {
            if (!entry.cancelled) {
                this.historyUpdate(fileId, update);
            }
        });

        let offset = fromOffset;

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
                if (!entry.digest) {
                    hasher.update(new Uint8Array(buffer));
                }
                offset += buffer.byteLength;
                progress.noteTransferred(buffer.byteLength, offset, totalSize);
            }

            await waitForBufferDrain(channel, 0);
            const fileDigest = entry.digest || hasher.digest('hex');
            entry.digest = fileDigest;

            channel.send(JSON.stringify({
                type: MSG.FILE_END,
                id: fileId,
                digest: fileDigest,
                size: totalSize
            }));
            await waitForBufferDrain(channel, 0);

            progress.finish();
            entry.settled = true;
            entry.uploading = false;
            this.outgoing.delete(fileId);
            this.markTransferInactive(fileId);
            playTransferCompleteChime();
            this.emit({ type: 'notify', title: 'Transfer Complete', body: `Sent ${file.name}` });

            this.historyUpdate(fileId, {
                status: 'completed',
                progress: 100,
                error: null,
                speed: null,
                eta: null,
                digest: fileDigest
            });

            // Brief delay before closing the channel so the receiver can drain
            // the FILE_END message reliably.
            setTimeout(() => {
                try {
                    channel.close();
                } catch {
                    // already closed
                }
            }, 500);
        } catch (error) {
            entry.uploading = false;
            try {
                channel.close();
            } catch {
                // ignore
            }

            if (error instanceof TransferAbortedError) {
                // Cancelled locally or cleanly aborted; status already updated.
                this.markTransferInactive(fileId);
                return;
            }

            // On unexpected error, if not cancelled, let grace timer manage recovery or teardown
        }
    }


    // ------------------------------------------------------------------
    // Incoming files
    // ------------------------------------------------------------------

    handleFilesOffer(session, files) {
        const peerName = this.getPeerName(session.peerId);
        const streamCapable = canStreamSave() || canOpfsSave();
        const newItems = [];

        files.forEach((meta) => {
            this.offered.set(meta.id, {
                peerId: session.peerId,
                name: meta.name,
                size: meta.size,
                type: meta.type
            });

            const isRelay = session.connectionType === 'relay-turn';
            const isStrictRelayBlocked = isRelay && this.strictLocalMode;
            const isRelayCapBlocked = isRelay && meta.size > RELAY_MAX_FILE_SIZE_BYTES;
            const tooLargeForBrowser = !streamCapable && meta.size > MEMORY_MODE_LIMIT_BYTES;

            let status = 'idle';
            let error;
            if (isStrictRelayBlocked || isRelayCapBlocked) {
                status = FILE_STATUS.BLOCKED;
                error = this.getRelayBlockError(isStrictRelayBlocked);
            } else if (tooLargeForBrowser) {
                status = 'error';
                error = 'File is too large for this browser (2 GB limit). Use Chrome or Edge on desktop for large files.';
            }

            newItems.push({
                id: meta.id,
                fileName: meta.name,
                fileSize: meta.size,
                fileType: meta.type,
                direction: 'in',
                status,
                error,
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
            return;
        }

        const isRelay = session.connectionType === 'relay-turn';
        const isStrictRelayBlocked = isRelay && this.strictLocalMode;
        const isRelayCapBlocked = isRelay && meta.size > RELAY_MAX_FILE_SIZE_BYTES;

        if (isStrictRelayBlocked || isRelayCapBlocked) {
            const errorMsg = this.getRelayBlockError(isStrictRelayBlocked);
            this.historyUpdate(fileId, { status: FILE_STATUS.BLOCKED, error: errorMsg });
            this.notifyError(errorMsg);
            return;
        }

        // Clean up any existing receive state if restarting
        const existingReceive = this.receives.get(fileId);
        if (existingReceive) {
            this.discardReceive(fileId, existingReceive);
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
            opfsFileHandle: null,
            writeChain: Promise.resolve(),
            buffers: [],
            hasher: null,
            finalized: false,
            retryCount: 0
        };

        let pickerFailed = false;
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
                pickerFailed = true;
                // Fall back to OPFS or memory mode.
            }


        }

        // When window.showSaveFilePicker is unavailable (e.g. Android Chrome, iOS Safari, desktop Firefox),
        // or if showSaveFilePicker threw an error, detect and use OPFS
        if (state.mode === 'memory' && (!canStreamSave() || pickerFailed) && canOpfsSave()) {
            try {
                const root = await navigator.storage.getDirectory();
                const tmpName = `transfer-${fileId}.tmp`;
                const handle = await root.getFileHandle(tmpName, { create: true });
                state.mode = 'opfs';
                state.opfsFileHandle = handle;
                state.stream = await handle.createWritable({ keepExistingData: false });
            } catch (opfsErr) {
                console.warn('[engine] OPFS init failed, falling back to memory mode:', opfsErr);
                state.mode = 'memory';
                state.opfsFileHandle = null;
                state.stream = null;
            }
        }

        if (state.mode === 'memory') {
            if (meta.size > MEMORY_MODE_LIMIT_BYTES) {
                this.historyUpdate(fileId, { status: 'error', error: 'File exceeds the 2 GB in-memory limit of this browser.' });
                return;
            }
            if (meta.size > STREAM_SAVE_THRESHOLD_BYTES) {
                this.notifyError('Browser memory limit warning: Storing files over 500 MB in RAM may crash this tab. Direct disk streaming is not supported on this browser.');
            }
        }

        state.hasher = await createSHA256();
        this.receives.set(fileId, state);
        this.historyUpdate(fileId, { status: 'waiting', progress: 0, speed: null, eta: null, error: null });
        this.sendOnControl(session, { type: MSG.FILE_REQUEST, fileId, fromOffset: 0 });
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

        if (state.graceTimer) {
            clearTimeout(state.graceTimer);
            state.graceTimer = null;
        }

        this.markTransferActive(fileId);
        const currentProgress = state.size > 0 ? Math.floor((state.received / state.size) * 100) : 0;
        this.historyUpdate(fileId, { status: 'downloading', progress: currentProgress, error: null });

        const progress = createProgressTracker((update) => {
            if (!state.finalized) {
                this.historyUpdate(fileId, update);
            }
        });

        channel.onmessage = async (event) => {
            if (state.finalized || channel.readyState === 'closed') return;

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

            if ((state.mode === 'fs-access' || state.mode === 'opfs') && state.stream) {
                state.writeChain = state.writeChain.then(() => state.stream.write(chunk)).catch((error) => {
                    if (!state.finalized) {
                        state.finalized = true;
                        this.discardReceive(fileId, state);
                        this.historyUpdate(fileId, { status: FILE_STATUS.FAILED, error: `Could not write to disk: ${error.message}` });
                    }
                });
            } else {
                state.buffers.push(chunk);
            }

            progress.noteTransferred(chunk.byteLength, state.received, state.size);
        };

        channel.onclose = () => {
            if (!state.finalized) {
                if (state.graceTimer) {
                    clearTimeout(state.graceTimer);
                }
                this.historyUpdate(fileId, { speed: null, eta: null });

                state.graceTimer = setTimeout(() => {
                    state.graceTimer = null;
                    if (!state.finalized) {
                        state.finalized = true;
                        this.discardReceive(fileId, state);
                        this.historyUpdate(fileId, { status: 'error', error: 'Transfer interrupted.', speed: null, eta: null });
                    }
                }, DISCONNECT_GRACE_MS);
            }
        };

    }

    async finalizeReceive(fileId, state, endMsg) {
        if (state.graceTimer) {
            clearTimeout(state.graceTimer);
            state.graceTimer = null;
        }
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
                state.stream = null;
            } catch (error) {
                this.discardReceive(fileId, state);
                this.historyUpdate(fileId, { status: 'error', error: `Could not write to disk: ${error.message}` });
                return;
            }

            this.receives.delete(fileId);
            this.markTransferInactive(fileId);
            playTransferCompleteChime();
            this.emit({ type: 'notify', title: 'Transfer Complete', body: `Received ${state.name}` });

            this.historyUpdate(fileId, {
                status: 'completed',
                progress: 100,
                verified,
                saved: true,
                speed: null,
                eta: null
            });
            return;
        }

        if (state.mode === 'opfs' && state.opfsFileHandle) {
            try {
                await state.writeChain;
                await state.stream.close();
                state.stream = null;
            } catch (error) {
                this.discardReceive(fileId, state);
                this.historyUpdate(fileId, { status: 'error', error: `Could not write to disk: ${error.message}` });
                return;
            }

            this.markTransferInactive(fileId);
            playTransferCompleteChime();
            this.emit({ type: 'notify', title: 'Transfer Complete', body: `Received ${state.name}` });

            try {
                const rawFile = await state.opfsFileHandle.getFile();
                const file = typeof File !== 'undefined'
                    ? new File([rawFile], state.name, { type: state.type || rawFile.type })
                    : rawFile;

                const isMobile = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
                const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function' && typeof navigator.canShare === 'function';

                if (isMobile && canShare && navigator.canShare({ files: [file] })) {
                    try {
                        await navigator.share({
                            files: [file],
                            title: state.name
                        });
                        await this.cleanupOpfsFile(fileId);
                        this.receives.delete(fileId);
                        this.historyUpdate(fileId, {
                            status: 'completed',
                            progress: 100,
                            verified,
                            saved: true,
                            speed: null,
                            eta: null
                        });
                        return;
                    } catch (shareErr) {
                        console.warn('[engine] navigator.share failed or dismissed:', shareErr);
                    }
                }

                // Fallback or desktop: Blob URL and trigger download
                const url = URL.createObjectURL(file);
                this.downloadUrls.set(fileId, url);
                this.saveReceivedFile(fileId, state.name);

                // Clean up temp OPFS file after a safe delay
                setTimeout(() => {
                    this.cleanupOpfsFile(fileId).catch(() => {});
                }, 60000);

                this.receives.delete(fileId);
                this.historyUpdate(fileId, {
                    status: 'completed',
                    progress: 100,
                    verified,
                    downloadUrl: url,
                    saved: true,
                    speed: null,
                    eta: null
                });
                return;
            } catch (err) {
                this.discardReceive(fileId, state);
                this.historyUpdate(fileId, { status: 'error', error: `Failed to finalize OPFS file: ${err.message}` });
                return;
            }
        }

        // Memory mode: assemble blob and create download URL
        const blob = new Blob(state.buffers, { type: state.type });
        const url = URL.createObjectURL(blob);
        this.downloadUrls.set(fileId, url);

        this.markTransferInactive(fileId);
        playTransferCompleteChime();
        this.emit({ type: 'notify', title: 'Transfer Complete', body: `Received ${state.name}` });

        this.historyUpdate(fileId, {
            status: 'completed',
            progress: 100,
            verified,
            downloadUrl: url,
            saved: false,
            speed: null,
            eta: null
        });

        // Free the chunk buffers; the browser blob holds the data now.
        state.buffers = [];
        state.hasher = null;
    }

    discardReceive(fileId, state) {
        if (state.graceTimer) {
            clearTimeout(state.graceTimer);
            state.graceTimer = null;
        }
        let abortPromise = Promise.resolve();
        if ((state.mode === 'fs-access' || state.mode === 'opfs') && state.stream) {
            try {
                abortPromise = Promise.resolve(state.stream.abort?.()).catch(() => {});
            } catch {
                // ignore sync error if any
            }
            state.stream = null;
        }
        if (state.mode === 'opfs') {
            abortPromise.finally(() => {
                this.cleanupOpfsFile(fileId).catch(() => {});
            });
        }
        state.buffers = [];
        state.hasher = null;
        this.markTransferInactive(fileId);
        this.receives.delete(fileId);
    }

    async cleanupOpfsFile(fileId) {
        try {
            if (typeof navigator !== 'undefined' && navigator.storage?.getDirectory) {
                const root = await navigator.storage.getDirectory();
                try {
                    await root.removeEntry(`transfer-${fileId}.tmp`);
                } catch {
                    await new Promise((resolve) => setTimeout(resolve, 80));
                    await root.removeEntry(`transfer-${fileId}.tmp`).catch(() => {});
                }
            }
        } catch {
            // ignore
        }
    }


    saveReceivedFile(fileId, fileName) {
        const url = this.downloadUrls.get(fileId);
        if (!url) return false;

        if (typeof document !== 'undefined' && document.body && typeof document.createElement === 'function') {
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName || 'download';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        }

        this.historyUpdate(fileId, { saved: true });
        return true;
    }


    cancelTransfer(fileId) {
        const outgoingEntry = this.outgoing.get(fileId);
        const receiveState = this.receives.get(fileId);
        const offeredMeta = this.offered.get(fileId);

        const session = this.sessions.get(
            outgoingEntry?.peerId || receiveState?.peerId || offeredMeta?.peerId
        );

        if (session?.pendingOfferFiles) {
            session.pendingOfferFiles = session.pendingOfferFiles.filter((f) => f.id !== fileId);
        }

        if (outgoingEntry) {
            if (outgoingEntry.graceTimer) {
                clearTimeout(outgoingEntry.graceTimer);
                outgoingEntry.graceTimer = null;
            }
            outgoingEntry.cancelled = true;
            this.outgoing.delete(fileId);
            this.markTransferInactive(fileId);
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
            if (outgoingEntry.graceTimer) {
                clearTimeout(outgoingEntry.graceTimer);
                outgoingEntry.graceTimer = null;
            }
            outgoingEntry.cancelled = true;
            this.outgoing.delete(fileId);
            this.markTransferInactive(fileId);
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
            text,
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

        stopAudioBeacon();
        this.activeTransferIds.forEach(() => {
            wakeLockManager.release().catch(() => {});
        });
        this.activeTransferIds.clear();

        for (const session of this.sessions.values()) {
            this.teardownSession(session, 'Session ended.');
        }

        for (const [fileId, receive] of Array.from(this.receives.entries())) {
            this.discardReceive(fileId, receive);
        }

        this.downloadUrls.forEach((url) => URL.revokeObjectURL(url));
        this.downloadUrls.clear();

        this.socket.off?.('offer');
        this.socket.off?.('answer');
        this.socket.off?.('ice-candidate');

        this.outgoing.clear();
        this.offered.clear();
        this.receives.clear();
        this.sessions.clear();
    }
}
