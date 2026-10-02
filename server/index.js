const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
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
} = require('./lib');
const { TurnCredentialManager, DEFAULT_STUN_SERVERS, createTurnCredentialsHandler } = require('./turn');

const USERS_UPDATE_DEBOUNCE_MS = 100;
const MAX_RELAY_STRIKES = 25;

const app = express();
app.set('trust proxy', 1);
app.use(cors());

const turnLimiter = createRateLimiter({ capacity: 30, refillPerSecond: 1 });
const turnManager = new TurnCredentialManager();
const handleTurnCredentials = createTurnCredentialsHandler({
    manager: turnManager,
    limiter: turnLimiter,
    getClientIp
});

app.get('/health', (req, res) => {
    res.json({ ok: true });
});

app.get('/api/turn-credentials', handleTurnCredentials);

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // Allow all origins for local network access
        methods: ["GET", "POST"]
    },
    maxHttpBufferSize: 64 * 1024
});

// Store connected users: socketId -> { id, name, deviceId, deviceType, publicIp, networkFingerprints, roomCode }
const users = {};
const similarityIndex = new SimilarityIndex();

const relayLimiter = createRateLimiter({ capacity: 40, refillPerSecond: 20 });
const joinLimiter = createRateLimiter({ capacity: 10, refillPerSecond: 5 });
const relayStrikes = new Map();
const signalingRegistry = new SignalingSessionRegistry();

function emitDebugState(user, visiblePeers = null) {
    if (!user) {
        return;
    }

    const peers = visiblePeers || getVisibleUsersFor(users, user, similarityIndex.getCandidateIdsFor(user));

    io.to(user.id).emit('debug-state', {
        publicIp: user.publicIp,
        networkFingerprints: user.networkFingerprints || [],
        deviceId: user.deviceId,
        roomCode: user.roomCode || null,
        visiblePeers: peers
    });
}

// Coalesce rapid membership changes (multiple joins, renames) and update only
// the affected candidate sockets in O(M^2) rather than all global users in O(N^2).
const pendingUpdateSocketIds = new Set();
let usersUpdateTimer = null;

function scheduleUsersUpdate(affectedSocketIds = null) {
    if (affectedSocketIds && affectedSocketIds.length > 0) {
        affectedSocketIds.forEach((id) => pendingUpdateSocketIds.add(id));
    } else {
        Object.keys(users).forEach((id) => pendingUpdateSocketIds.add(id));
    }

    if (usersUpdateTimer) {
        return;
    }

    usersUpdateTimer = setTimeout(() => {
        usersUpdateTimer = null;
        const targetSocketIds = Array.from(pendingUpdateSocketIds);
        pendingUpdateSocketIds.clear();

        targetSocketIds.forEach((socketId) => {
            const user = users[socketId];
            if (!user) {
                return;
            }

            const candidateIds = similarityIndex.getCandidateIdsFor(user);
            const visiblePeers = getVisibleUsersFor(users, user, candidateIds);
            io.to(user.id).emit('users-update', visiblePeers);
            emitDebugState(user, visiblePeers);
        });
    }, USERS_UPDATE_DEBOUNCE_MS);
}

function removeUser(socketId) {
    const existingUser = users[socketId];
    if (!existingUser) {
        return null;
    }

    const affected = similarityIndex.getAffectedSocketIds(existingUser);
    similarityIndex.removeUser(socketId);
    delete users[socketId];
    scheduleUsersUpdate(affected);
    return existingUser;
}

function disconnectSocketIfPresent(socketId) {
    const existingSocket = io.sockets.sockets.get(socketId);
    if (existingSocket) {
        existingSocket.disconnect(true);
    }
}

function removeDuplicateDeviceEntries(deviceId, currentSocketId) {
    if (!deviceId) {
        return [];
    }

    const duplicates = Object.values(users).filter((user) => (
        user.deviceId === deviceId && user.id !== currentSocketId
    ));

    duplicates.forEach((duplicateUser) => {
        removeUser(duplicateUser.id);
        disconnectSocketIfPresent(duplicateUser.id);
    });

    return duplicates;
}

function registerRelayStrike(socket) {
    const strikes = (relayStrikes.get(socket.id) || 0) + 1;
    relayStrikes.set(socket.id, strikes);

    if (strikes >= MAX_RELAY_STRIKES) {
        socket.disconnect(true);
    }
}

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('join', (payload) => {
        if (!joinLimiter.tryConsume(socket.id)) {
            return;
        }

        const { name, networkFingerprints, deviceId, roomCode: payloadRoomCode } = normalizeJoinPayload(payload);
        const publicIp = getClientIp(socket.handshake.headers, socket.handshake.address);
        const deviceType = detectDeviceType(socket.handshake.headers['user-agent']);

        removeDuplicateDeviceEntries(deviceId, socket.id);
        const existingUser = users[socket.id];
        const oldAffected = existingUser ? similarityIndex.getAffectedSocketIds(existingUser) : [];
        const roomCode = payloadRoomCode !== undefined
            ? payloadRoomCode
            : (existingUser ? existingUser.roomCode : null);

        const newUser = {
            id: socket.id,
            name,
            deviceId,
            deviceType,
            publicIp,
            networkFingerprints,
            roomCode
        };
        users[socket.id] = newUser;
        similarityIndex.addUser(newUser);

        const newAffected = similarityIndex.getAffectedSocketIds(newUser);
        const affected = Array.from(new Set([...oldAffected, ...newAffected]));
        scheduleUsersUpdate(affected);
    });

    socket.on('join-room', (payload, callback) => {
        if (!joinLimiter.tryConsume(socket.id)) {
            if (typeof callback === 'function') callback({ success: false, error: 'Rate limited' });
            return;
        }

        const user = users[socket.id];
        if (!user) {
            if (typeof callback === 'function') callback({ success: false, error: 'User not registered' });
            return;
        }

        const rawCode = typeof payload === 'object' && payload !== null
            ? (payload.roomCode || payload.room)
            : payload;
        const roomCode = sanitizeRoomCode(rawCode);

        if (!roomCode) {
            if (typeof callback === 'function') callback({ success: false, error: 'Invalid room code' });
            return;
        }

        if (user.roomCode === roomCode) {
            if (typeof callback === 'function') callback({ success: true, roomCode });
            return;
        }

        const oldAffected = similarityIndex.getAffectedSocketIds(user);
        user.roomCode = roomCode;
        similarityIndex.addUser(user);
        const newAffected = similarityIndex.getAffectedSocketIds(user);
        const affected = Array.from(new Set([...oldAffected, ...newAffected]));

        scheduleUsersUpdate(affected);
        if (typeof callback === 'function') callback({ success: true, roomCode });
    });

    socket.on('leave-room', (callback) => {
        const user = users[socket.id];
        if (!user) {
            if (typeof callback === 'function') callback({ success: false, error: 'User not registered' });
            return;
        }

        if (!user.roomCode) {
            if (typeof callback === 'function') callback({ success: true, roomCode: null });
            return;
        }

        const oldAffected = similarityIndex.getAffectedSocketIds(user);
        user.roomCode = null;
        similarityIndex.addUser(user);
        const newAffected = similarityIndex.getAffectedSocketIds(user);
        const affected = Array.from(new Set([...oldAffected, ...newAffected]));

        scheduleUsersUpdate(affected);
        if (typeof callback === 'function') callback({ success: true, roomCode: null });
    });

    // Signaling relays. The sender is always taken from the authenticated
    // socket, never from the (spoofable) payload, and a message is only
    // relayed to sockets that actually joined.
    const relay = (eventName, isValidPayload, extractPayload) => {
        socket.on(eventName, (data) => {
            const sender = users[socket.id];
            if (!sender) {
                return;
            }

            if (!relayLimiter.tryConsume(socket.id)) {
                registerRelayStrike(socket);
                return;
            }

            const payload = extractPayload(data);
            const target = typeof data?.target === 'string' ? data.target : null;
            const targetUser = target ? users[target] : null;

            if (!targetUser || !isValidPayload(payload)) {
                registerRelayStrike(socket);
                return;
            }

            const currentlyVisible = areUsersVisible(sender, targetUser);
            const hasActiveSession = signalingRegistry.isAuthorized(socket.id, target);

            if (!currentlyVisible && !hasActiveSession) {
                registerRelayStrike(socket);
                return;
            }

            if (eventName === 'offer' && currentlyVisible) {
                signalingRegistry.registerSession(socket.id, target);
            }

            io.to(target).emit(eventName, { ...payload, sender: socket.id });
        });
    };

    relay('offer', (payload) => isValidSessionDescription(payload.offer, 'offer'), (data) => ({ offer: data?.offer }));
    relay('answer', (payload) => isValidSessionDescription(payload.answer, 'answer'), (data) => ({ answer: data?.answer }));
    relay('ice-candidate', (payload) => isValidIceCandidate(payload.candidate), (data) => ({ candidate: data?.candidate }));

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        removeUser(socket.id);
        signalingRegistry.removeSocket(socket.id);
        relayLimiter.reset(socket.id);
        joinLimiter.reset(socket.id);
        relayStrikes.delete(socket.id);
    });
});

const PORT = process.env.PORT || 3001;
if (require.main === module) {
    server.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
}

module.exports = { app, server, users, similarityIndex, turnManager, turnLimiter, handleTurnCredentials, DEFAULT_STUN_SERVERS, signalingRegistry };
