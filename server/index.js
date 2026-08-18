const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const {
    normalizeJoinPayload,
    getClientIp,
    detectDeviceType,
    getVisibleUsersFor,
    isValidSessionDescription,
    isValidIceCandidate,
    createRateLimiter
} = require('./lib');

const USERS_UPDATE_DEBOUNCE_MS = 100;
const MAX_RELAY_STRIKES = 25;

const app = express();
app.use(cors());
app.get('/health', (req, res) => {
    res.json({ ok: true });
});

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // Allow all origins for local network access
        methods: ["GET", "POST"]
    },
    maxHttpBufferSize: 64 * 1024
});

// Store connected users: socketId -> { id, name, deviceId, deviceType, publicIp, networkFingerprints }
const users = {};

const relayLimiter = createRateLimiter({ capacity: 40, refillPerSecond: 20 });
const joinLimiter = createRateLimiter({ capacity: 10, refillPerSecond: 5 });
const relayStrikes = new Map();

function emitDebugState(user) {
    if (!user) {
        return;
    }

    io.to(user.id).emit('debug-state', {
        publicIp: user.publicIp,
        networkFingerprints: user.networkFingerprints || [],
        deviceId: user.deviceId,
        visiblePeers: getVisibleUsersFor(users, user)
    });
}

function emitUsersUpdateForAllUsers() {
    Object.values(users).forEach((user) => {
        io.to(user.id).emit('users-update', getVisibleUsersFor(users, user));
        emitDebugState(user);
    });
}

// Coalesce rapid membership changes (multiple joins, renames) into one
// broadcast round so traffic stays linear rather than quadratic in bursts.
let usersUpdateTimer = null;
function scheduleUsersUpdate() {
    if (usersUpdateTimer) {
        return;
    }

    usersUpdateTimer = setTimeout(() => {
        usersUpdateTimer = null;
        emitUsersUpdateForAllUsers();
    }, USERS_UPDATE_DEBOUNCE_MS);
}

function removeUser(socketId) {
    const existingUser = users[socketId];
    if (!existingUser) {
        return null;
    }

    delete users[socketId];
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

        const { name, networkFingerprints, deviceId } = normalizeJoinPayload(payload);
        const publicIp = getClientIp(socket.handshake.headers, socket.handshake.address);
        const deviceType = detectDeviceType(socket.handshake.headers['user-agent']);

        removeDuplicateDeviceEntries(deviceId, socket.id);
        users[socket.id] = {
            id: socket.id,
            name,
            deviceId,
            deviceType,
            publicIp,
            networkFingerprints
        };

        scheduleUsersUpdate();
    });

    // Signaling relays. The sender is always taken from the authenticated
    // socket, never from the (spoofable) payload, and a message is only
    // relayed to sockets that actually joined.
    const relay = (eventName, isValidPayload, extractPayload) => {
        socket.on(eventName, (data) => {
            if (!users[socket.id]) {
                return;
            }

            if (!relayLimiter.tryConsume(socket.id)) {
                registerRelayStrike(socket);
                return;
            }

            const payload = extractPayload(data);
            const target = typeof data?.target === 'string' ? data.target : null;

            if (!target || !users[target] || !isValidPayload(payload)) {
                registerRelayStrike(socket);
                return;
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
        relayLimiter.reset(socket.id);
        joinLimiter.reset(socket.id);
        relayStrikes.delete(socket.id);
        scheduleUsersUpdate();
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

module.exports = { app, server };
