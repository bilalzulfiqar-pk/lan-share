import { DurableObject } from 'cloudflare:workers';
import lib from '../../server/lib.js';
import turn from '../../server/turn.js';

const {
    normalizeJoinPayload,
    sanitizeRoomCode,
    getClientIp,
    detectDeviceType,
    getVisibleUsersFor,
    areUsersVisible,
    isValidSessionDescription,
    isValidIceCandidate,
    createRateLimiter,
    SimilarityIndex,
    SignalingSessionRegistry
} = lib?.default || lib;

const {
    TurnCredentialManager,
    DEFAULT_STUN_SERVERS
} = turn?.default || turn;

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

const USERS_UPDATE_DEBOUNCE_MS = 100;
const MAX_RELAY_STRIKES = 25;
const MAX_MESSAGE_SIZE = 64 * 1024;

let cachedTurnManager = null;
let cachedTurnLimiter = null;

function getTurnManager(env) {
    if (!cachedTurnManager) {
        cachedTurnManager = new TurnCredentialManager({
            apiKey: env?.METERED_API_KEY,
            appName: env?.METERED_APP_NAME
        });
    }
    return cachedTurnManager;
}

function getTurnLimiter() {
    if (!cachedTurnLimiter) {
        cachedTurnLimiter = createRateLimiter({ capacity: 30, refillPerSecond: 1 });
    }
    return cachedTurnLimiter;
}

export class SignalingHub extends DurableObject {
    constructor(ctx, env) {
        super(ctx, env);
        this.ctx = ctx;
        this.env = env;

        this.users = Object.create(null);
        this.similarityIndex = new SimilarityIndex();
        this.socketById = new Map();
        this.signalingRegistry = new SignalingSessionRegistry();

        this.relayLimiter = createRateLimiter({ capacity: 40, refillPerSecond: 20 });
        this.joinLimiter = createRateLimiter({ capacity: 10, refillPerSecond: 5 });
        this.relayStrikes = new Map();

        this.pendingUpdateSocketIds = new Set();
        this.usersUpdateTimer = null;

        // Auto-respond to pings at the Cloudflare edge without waking the Durable Object
        if (typeof WebSocketRequestResponsePair !== 'undefined' && typeof this.ctx.setWebSocketAutoResponse === 'function') {
            try {
                this.ctx.setWebSocketAutoResponse(
                    new WebSocketRequestResponsePair('{"type":"ping"}', '{"type":"pong"}')
                );
            } catch (err) {
                console.warn('[SignalingHub] Could not setWebSocketAutoResponse:', err);
            }
        }

        // Hibernation State Rehydration:
        // Iterate over active hibernated WebSockets and re-hydrate in-memory state.
        if (typeof this.ctx.getWebSockets === 'function') {
            const sockets = this.ctx.getWebSockets();
            for (const ws of sockets) {
                try {
                    const attachment = typeof ws.deserializeAttachment === 'function' ? ws.deserializeAttachment() : null;
                    if (attachment && attachment.id) {
                        this.socketById.set(attachment.id, ws);
                        if (attachment.strikes) {
                            this.relayStrikes.set(attachment.id, attachment.strikes);
                        }
                        if (attachment.user) {
                            this.users[attachment.id] = attachment.user;
                            this.similarityIndex.addUser(attachment.user);
                        }
                        if (Array.isArray(attachment.sessions)) {
                            const now = Date.now();
                            for (const s of attachment.sessions) {
                                if (s && s.target && s.expiresAt > now) {
                                    this.signalingRegistry.sessions.set(
                                        this.signalingRegistry._pairKey(attachment.id, s.target),
                                        s.expiresAt
                                    );
                                }
                            }
                        }
                    }
                } catch (err) {
                    console.error('[SignalingHub] Failed to rehydrate socket:', err);
                }
            }
        }
    }

    async fetch(request) {
        const webSocketPair = new WebSocketPair();
        const [clientWs, serverWs] = Object.values(webSocketPair);

        const socketId = crypto.randomUUID();
        const headersObj = Object.fromEntries(request.headers.entries());
        const publicIp = getClientIp(headersObj, request.headers.get('cf-connecting-ip') || '');
        const userAgent = request.headers.get('user-agent') || '';
        const deviceType = detectDeviceType(userAgent);

        const attachment = {
            id: socketId,
            publicIp,
            deviceType,
            user: null,
            strikes: 0,
            sessions: []
        };

        if (typeof serverWs.serializeAttachment === 'function') {
            serverWs.serializeAttachment(attachment);
        }

        if (typeof this.ctx.acceptWebSocket === 'function') {
            this.ctx.acceptWebSocket(serverWs);
        }
        this.socketById.set(socketId, serverWs);

        serverWs.send(JSON.stringify({ type: 'connected', id: socketId }));

        try {
            return new Response(null, { status: 101, webSocket: clientWs });
        } catch {
            const fallbackRes = new Response(null, { status: 200 });
            Object.defineProperty(fallbackRes, 'status', { value: 101 });
            fallbackRes.webSocket = clientWs;
            return fallbackRes;
        }
    }

    emitDebugState(user, visiblePeers = null) {
        if (!user) return;
        const targetWs = this.socketById.get(user.id);
        if (!targetWs) return;

        const peers = visiblePeers || getVisibleUsersFor(this.users, user, this.similarityIndex.getCandidateIdsFor(user));

        try {
            targetWs.send(JSON.stringify({
                type: 'debug-state',
                data: {
                    publicIp: user.publicIp,
                    networkFingerprints: user.networkFingerprints || [],
                    deviceId: user.deviceId,
                    roomCode: user.roomCode || null,
                    visiblePeers: peers
                }
            }));
        } catch {}
    }

    flushUsersUpdate() {
        if (this.usersUpdateTimer) {
            clearTimeout(this.usersUpdateTimer);
            this.usersUpdateTimer = null;
        }

        const targetSocketIds = Array.from(this.pendingUpdateSocketIds);
        this.pendingUpdateSocketIds.clear();

        targetSocketIds.forEach((socketId) => {
            const user = this.users[socketId];
            if (!user) return;

            const targetWs = this.socketById.get(socketId);
            if (!targetWs) return;

            const candidateIds = this.similarityIndex.getCandidateIdsFor(user);
            const visiblePeers = getVisibleUsersFor(this.users, user, candidateIds);

            try {
                targetWs.send(JSON.stringify({
                    type: 'users-update',
                    data: visiblePeers
                }));
                this.emitDebugState(user, visiblePeers);
            } catch (err) {
                console.error(`[SignalingHub] Failed to send users-update to ${socketId}:`, err);
            }
        });
    }

    scheduleUsersUpdate(affectedSocketIds = null) {
        if (affectedSocketIds && affectedSocketIds.length > 0) {
            affectedSocketIds.forEach((id) => this.pendingUpdateSocketIds.add(id));
        } else {
            Object.keys(this.users).forEach((id) => this.pendingUpdateSocketIds.add(id));
        }

        if (this.usersUpdateTimer) {
            return;
        }

        this.usersUpdateTimer = setTimeout(() => {
            this.flushUsersUpdate();
        }, USERS_UPDATE_DEBOUNCE_MS);
    }

    removeUser(socketId) {
        const existingUser = this.users[socketId];
        if (!existingUser) return null;

        const affected = this.similarityIndex.getAffectedSocketIds(existingUser);
        this.similarityIndex.removeUser(socketId);
        delete this.users[socketId];
        this.scheduleUsersUpdate(affected);
        return existingUser;
    }

    disconnectSocketIfPresent(socketId) {
        const existingSocket = this.socketById.get(socketId);
        if (existingSocket) {
            try {
                existingSocket.close(1000, 'Duplicate device replaced');
            } catch {}
            this.socketById.delete(socketId);
        }
    }

    removeDuplicateDeviceEntries(deviceId, currentSocketId) {
        if (!deviceId) return [];
        const duplicates = Object.values(this.users).filter((user) => (
            user.deviceId === deviceId && user.id !== currentSocketId
        ));

        duplicates.forEach((duplicateUser) => {
            this.removeUser(duplicateUser.id);
            this.disconnectSocketIfPresent(duplicateUser.id);
        });

        return duplicates;
    }

    registerRelayStrike(ws, socketId, attachment) {
        const strikes = (this.relayStrikes.get(socketId) || 0) + 1;
        this.relayStrikes.set(socketId, strikes);
        if (attachment) {
            attachment.strikes = strikes;
            if (typeof ws.serializeAttachment === 'function') {
                ws.serializeAttachment(attachment);
            }
        }

        if (strikes >= MAX_RELAY_STRIKES) {
            try {
                ws.close(1008, 'Policy Violation');
            } catch {}
            this.cleanupSocket(ws, socketId);
        }
    }

    sendAck(ws, ackId, payload) {
        if (!ackId) return;
        try {
            ws.send(JSON.stringify({
                type: 'ack',
                ackId,
                payload
            }));
        } catch {}
    }

    async webSocketMessage(ws, rawMessage) {
        if (typeof rawMessage === 'string' && rawMessage.length > MAX_MESSAGE_SIZE) {
            try {
                ws.close(1009, 'Message Too Big');
            } catch {}
            this.cleanupSocket(ws);
            return;
        }

        let parsed;
        try {
            parsed = JSON.parse(typeof rawMessage === 'string' ? rawMessage : new TextDecoder().decode(rawMessage));
        } catch {
            return;
        }

        if (!parsed || typeof parsed !== 'object') return;
        const { type, data, ackId } = parsed;

        let attachment = typeof ws.deserializeAttachment === 'function' ? ws.deserializeAttachment() : null;
        let socketId = attachment?.id;

        if (!socketId) {
            for (const [id, s] of this.socketById.entries()) {
                if (s === ws) {
                    socketId = id;
                    break;
                }
            }
        }
        if (!socketId) return;

        this.socketById.set(socketId, ws);
        if (attachment && attachment.user && !this.users[socketId]) {
            this.users[socketId] = attachment.user;
            this.similarityIndex.addUser(attachment.user);
        }

        // Keepalive ping
        if (type === 'ping') {
            try {
                ws.send(JSON.stringify({ type: 'pong' }));
            } catch {}
            return;
        }

        // Join
        if (type === 'join') {
            if (!this.joinLimiter.tryConsume(socketId)) {
                return;
            }

            const { name, networkFingerprints, deviceId, roomCode: payloadRoomCode } = normalizeJoinPayload(data);
            const publicIp = attachment?.publicIp || '';
            const deviceType = attachment?.deviceType || 'desktop';

            this.removeDuplicateDeviceEntries(deviceId, socketId);
            const existingUser = this.users[socketId];
            const oldAffected = existingUser ? this.similarityIndex.getAffectedSocketIds(existingUser) : [];
            const roomCode = payloadRoomCode !== undefined
                ? payloadRoomCode
                : (existingUser ? existingUser.roomCode : null);

            const newUser = {
                id: socketId,
                name,
                deviceId,
                deviceType,
                publicIp,
                networkFingerprints,
                roomCode
            };
            this.users[socketId] = newUser;
            this.similarityIndex.addUser(newUser);

            if (attachment) {
                attachment.user = newUser;
                if (typeof ws.serializeAttachment === 'function') {
                    ws.serializeAttachment(attachment);
                }
            }

            const newAffected = this.similarityIndex.getAffectedSocketIds(newUser);
            const affected = Array.from(new Set([...oldAffected, ...newAffected]));
            this.scheduleUsersUpdate(affected);
            return;
        }

        // Join room
        if (type === 'join-room') {
            if (!this.joinLimiter.tryConsume(socketId)) {
                this.sendAck(ws, ackId, { success: false, error: 'Rate limited' });
                return;
            }

            const user = this.users[socketId];
            if (!user) {
                this.sendAck(ws, ackId, { success: false, error: 'User not registered' });
                return;
            }

            const rawCode = typeof data === 'object' && data !== null
                ? (data.roomCode || data.room)
                : data;
            const roomCode = sanitizeRoomCode(rawCode);

            if (!roomCode) {
                this.sendAck(ws, ackId, { success: false, error: 'Invalid room code' });
                return;
            }

            if (user.roomCode === roomCode) {
                this.sendAck(ws, ackId, { success: true, roomCode });
                return;
            }

            const oldAffected = this.similarityIndex.getAffectedSocketIds(user);
            user.roomCode = roomCode;
            this.similarityIndex.addUser(user);

            if (attachment) {
                attachment.user = user;
                if (typeof ws.serializeAttachment === 'function') {
                    ws.serializeAttachment(attachment);
                }
            }

            const newAffected = this.similarityIndex.getAffectedSocketIds(user);
            const affected = Array.from(new Set([...oldAffected, ...newAffected]));
            this.scheduleUsersUpdate(affected);

            this.sendAck(ws, ackId, { success: true, roomCode });
            return;
        }

        // Leave room
        if (type === 'leave-room') {
            if (!this.joinLimiter.tryConsume(socketId)) {
                this.sendAck(ws, ackId, { success: false, error: 'Rate limited' });
                return;
            }

            const user = this.users[socketId];
            if (!user) {
                this.sendAck(ws, ackId, { success: false, error: 'User not registered' });
                return;
            }

            if (!user.roomCode) {
                this.sendAck(ws, ackId, { success: true, roomCode: null });
                return;
            }

            const oldAffected = this.similarityIndex.getAffectedSocketIds(user);
            user.roomCode = null;
            this.similarityIndex.addUser(user);

            if (attachment) {
                attachment.user = user;
                if (typeof ws.serializeAttachment === 'function') {
                    ws.serializeAttachment(attachment);
                }
            }

            const newAffected = this.similarityIndex.getAffectedSocketIds(user);
            const affected = Array.from(new Set([...oldAffected, ...newAffected]));
            this.scheduleUsersUpdate(affected);

            this.sendAck(ws, ackId, { success: true, roomCode: null });
            return;
        }

        // WebRTC Signaling Relays: offer, answer, ice-candidate, request-offer
        if (type === 'offer' || type === 'answer' || type === 'ice-candidate' || type === 'request-offer') {
            const sender = this.users[socketId];
            if (!sender) return;

            if (!this.relayLimiter.tryConsume(socketId)) {
                this.registerRelayStrike(ws, socketId, attachment);
                return;
            }

            let payload;
            let isValid = false;
            if (type === 'offer') {
                payload = { offer: data?.offer };
                isValid = isValidSessionDescription(payload.offer, 'offer');
            } else if (type === 'answer') {
                payload = { answer: data?.answer };
                isValid = isValidSessionDescription(payload.answer, 'answer');
            } else if (type === 'ice-candidate') {
                payload = { candidate: data?.candidate };
                isValid = isValidIceCandidate(payload.candidate);
            } else if (type === 'request-offer') {
                payload = {};
                isValid = Boolean(data && typeof data === 'object');
            }

            const target = typeof data?.target === 'string' ? data.target : null;

            if (!isValid) {
                this.registerRelayStrike(ws, socketId, attachment);
                return;
            }

            const targetUser = (target && Object.hasOwn(this.users, target)) ? this.users[target] : null;
            if (!targetUser) {
                // Target departed mid-handshake; drop silently without penalizing sender
                return;
            }

            const currentlyVisible = areUsersVisible(sender, targetUser);
            const hasActiveSession = this.signalingRegistry.isAuthorized(socketId, target);

            if (!currentlyVisible && !hasActiveSession) {
                this.registerRelayStrike(ws, socketId, attachment);
                return;
            }

            if ((type === 'offer' || type === 'request-offer') && currentlyVisible) {
                this.signalingRegistry.registerSession(socketId, target);
                const pairKey = this.signalingRegistry._pairKey(socketId, target);
                const expiresAt = this.signalingRegistry.sessions.get(pairKey);
                if (expiresAt && attachment) {
                    attachment.sessions = (attachment.sessions || []).filter(s => s.expiresAt > Date.now());
                    attachment.sessions.push({ target, expiresAt });
                    if (typeof ws.serializeAttachment === 'function') {
                        ws.serializeAttachment(attachment);
                    }
                }
            }

            const targetWs = this.socketById.get(target);
            if (targetWs) {
                try {
                    targetWs.send(JSON.stringify({
                        type,
                        data: { ...payload, sender: socketId }
                    }));
                } catch (err) {
                    console.error(`[SignalingHub] Failed to send ${type} to ${target}:`, err);
                }
            }
        }
    }

    async webSocketClose(ws) {
        this.cleanupSocket(ws);
    }

    async webSocketError(ws) {
        this.cleanupSocket(ws);
    }

    cleanupSocket(ws, explicitId = null) {
        let socketId = explicitId;
        if (!socketId && typeof ws.deserializeAttachment === 'function') {
            try {
                const att = ws.deserializeAttachment();
                socketId = att?.id;
            } catch {}
        }
        if (!socketId) {
            for (const [id, s] of this.socketById.entries()) {
                if (s === ws) {
                    socketId = id;
                    break;
                }
            }
        }
        if (!socketId) return;

        this.socketById.delete(socketId);
        this.removeUser(socketId);
        this.signalingRegistry.removeSocket(socketId);
        this.relayLimiter.reset(socketId);
        this.joinLimiter.reset(socketId);
        this.relayStrikes.delete(socketId);
    }
}

export default {
    async fetch(request, env) {
        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: CORS_HEADERS });
        }

        const url = new URL(request.url);

        if (url.pathname === '/health') {
            return new Response(JSON.stringify({ ok: true }), {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                    ...CORS_HEADERS
                }
            });
        }

        if (url.pathname === '/api/turn-credentials') {
            const clientIp = request.headers.get('cf-connecting-ip')
                || request.headers.get('x-forwarded-for')?.split(',')[0].trim()
                || '127.0.0.1';

            const limiter = getTurnLimiter();
            if (!limiter.tryConsume(clientIp)) {
                return new Response(JSON.stringify({
                    error: 'Too many requests for TURN credentials. Please wait.',
                    iceServers: DEFAULT_STUN_SERVERS
                }), {
                    status: 429,
                    headers: {
                        'Content-Type': 'application/json',
                        'Cache-Control': 'private, no-cache',
                        ...CORS_HEADERS
                    }
                });
            }

            try {
                const credentials = await getTurnManager(env).getCredentials();
                return new Response(JSON.stringify(credentials), {
                    status: 200,
                    headers: {
                        'Content-Type': 'application/json',
                        'Cache-Control': 'private, no-cache',
                        ...CORS_HEADERS
                    }
                });
            } catch (err) {
                console.error('[TURN] Unexpected error fetching credentials:', err);
                return new Response(JSON.stringify({
                    error: 'Internal server error',
                    iceServers: DEFAULT_STUN_SERVERS
                }), {
                    status: 500,
                    headers: {
                        'Content-Type': 'application/json',
                        ...CORS_HEADERS
                    }
                });
            }
        }

        const upgradeHeader = request.headers.get('Upgrade');
        const isWs = url.pathname === '/ws' || upgradeHeader?.toLowerCase() === 'websocket';

        if (isWs) {
            if (!env?.SIGNALING_HUB) {
                return new Response('SignalingHub binding missing', { status: 500, headers: CORS_HEADERS });
            }
            const id = env.SIGNALING_HUB.idFromName('global-hub');
            const stub = env.SIGNALING_HUB.get(id);
            return stub.fetch(request);
        }

        if (url.pathname === '/' || url.pathname === '') {
            return new Response(JSON.stringify({
                name: 'lan-share-signaling',
                status: 'running',
                ws: '/ws'
            }), {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                    ...CORS_HEADERS
                }
            });
        }

        return new Response('Not Found', { status: 404, headers: CORS_HEADERS });
    }
};
