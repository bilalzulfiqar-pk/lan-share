const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // Allow all origins for local network access
        methods: ["GET", "POST"]
    }
});

// Store connected users: socketId -> { id, name, deviceId, publicIp, networkFingerprints }
const users = {};

function sanitizeName(name) {
    if (typeof name !== 'string') {
        return 'Unknown Device';
    }

    const normalized = name.trim().slice(0, 32);
    return normalized || 'Unknown Device';
}

function sanitizeNetworkFingerprint(networkFingerprint) {
    if (typeof networkFingerprint !== 'string') {
        return null;
    }

    const normalized = networkFingerprint.trim().toLowerCase().slice(0, 64);
    return /^[a-z0-9:.-]+$/.test(normalized) ? normalized : null;
}

function sanitizeNetworkFingerprints(value) {
    if (!Array.isArray(value)) {
        return [];
    }

    return Array.from(new Set(
        value
            .map(sanitizeNetworkFingerprint)
            .filter(Boolean)
    )).slice(0, 12);
}

function sanitizeDeviceId(deviceId) {
    if (typeof deviceId !== 'string') {
        return null;
    }

    const normalized = deviceId.trim().toLowerCase().slice(0, 128);
    return /^[a-z0-9-]+$/.test(normalized) ? normalized : null;
}

function normalizeJoinPayload(payload) {
    if (typeof payload === 'string') {
        return {
            name: sanitizeName(payload),
            networkFingerprint: null,
            networkFingerprints: [],
            deviceId: null
        };
    }

    if (payload && typeof payload === 'object') {
        const networkFingerprints = sanitizeNetworkFingerprints(payload.networkFingerprints);
        const legacyFingerprint = sanitizeNetworkFingerprint(payload.networkFingerprint);

        if (legacyFingerprint && !networkFingerprints.includes(legacyFingerprint)) {
            networkFingerprints.push(legacyFingerprint);
        }

        return {
            name: sanitizeName(payload.name),
            networkFingerprint: networkFingerprints[0] || null,
            networkFingerprints,
            deviceId: sanitizeDeviceId(payload.deviceId)
        };
    }

    return {
        name: 'Unknown Device',
        networkFingerprint: null,
        networkFingerprints: [],
        deviceId: null
    };
}

function getClientIp(socket) {
    const forwardedFor = socket.handshake.headers['x-forwarded-for'];
    if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
        return forwardedFor.split(',')[0].trim();
    }

    const address = socket.handshake.address || '';
    return address.replace(/^::ffff:/, '');
}

function splitFingerprints(networkFingerprints = []) {
    return {
        lan: networkFingerprints.filter((fingerprint) => fingerprint.startsWith('lan:')),
        wan: networkFingerprints.filter((fingerprint) => fingerprint.startsWith('wan:'))
    };
}

function hasOverlap(leftValues, rightValues) {
    return leftValues.some((value) => rightValues.includes(value));
}

function areUsersVisible(leftUser, rightUser) {
    if (!leftUser || !rightUser) {
        return false;
    }

    const leftFingerprints = leftUser.networkFingerprints || [];
    const rightFingerprints = rightUser.networkFingerprints || [];
    const leftFingerprintGroups = splitFingerprints(leftFingerprints);
    const rightFingerprintGroups = splitFingerprints(rightFingerprints);
    const sharesWanFingerprint = hasOverlap(leftFingerprintGroups.wan, rightFingerprintGroups.wan);
    const sharesLanFingerprint = hasOverlap(leftFingerprintGroups.lan, rightFingerprintGroups.lan);
    const sharesHttpPublicIp =
        Boolean(leftUser.publicIp) &&
        Boolean(rightUser.publicIp) &&
        leftUser.publicIp === rightUser.publicIp;

    // Strongest signal: both browsers independently discovered the same
    // public network identity through ICE/STUN.
    if (sharesWanFingerprint) {
        if (leftFingerprintGroups.lan.length > 0 && rightFingerprintGroups.lan.length > 0) {
            return sharesLanFingerprint;
        }

        return true;
    }

    // Second-best signal: browsers exposed matching LAN subnets and the
    // backend also saw the same public IP.
    if (sharesLanFingerprint && sharesHttpPublicIp) {
        return true;
    }

    // Final fallback for browsers that expose no usable ICE fingerprint data.
    if (leftFingerprints.length === 0 && rightFingerprints.length === 0) {
        return sharesHttpPublicIp;
    }

    if ((leftFingerprints.length === 0 || rightFingerprints.length === 0) && sharesHttpPublicIp) {
        return true;
    }

    return false;
}

function getVisibleUsersFor(user) {
    return Object.values(users)
        .filter((candidate) => areUsersVisible(user, candidate))
        .map(({ id, name }) => ({ id, name }));
}

function emitDebugState(user) {
    if (!user) {
        return;
    }

    io.to(user.id).emit('debug-state', {
        publicIp: user.publicIp,
        networkFingerprints: user.networkFingerprints || [],
        deviceId: user.deviceId,
        visiblePeers: getVisibleUsersFor(user).filter((candidate) => candidate.id !== user.id)
    });
}

function emitUsersUpdateForAllUsers() {
    Object.values(users).forEach((user) => {
        io.to(user.id).emit('users-update', getVisibleUsersFor(user));
        emitDebugState(user);
    });
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

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // User joins with a display name
    socket.on('join', (payload) => {
        const { name, networkFingerprints, deviceId } = normalizeJoinPayload(payload);
        const publicIp = getClientIp(socket);

        removeDuplicateDeviceEntries(deviceId, socket.id);
        users[socket.id] = {
            id: socket.id,
            name,
            deviceId,
            publicIp,
            networkFingerprints
        };

        emitUsersUpdateForAllUsers();
    });

    // Handle Signaling
    socket.on('offer', (data) => {
        const { target, offer, sender } = data;
        io.to(target).emit('offer', { offer, sender });
    });

    socket.on('answer', (data) => {
        const { target, answer, sender } = data;
        io.to(target).emit('answer', { answer, sender });
    });

    socket.on('ice-candidate', (data) => {
        const { target, candidate, sender } = data;
        io.to(target).emit('ice-candidate', { candidate, sender });
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        removeUser(socket.id);
        emitUsersUpdateForAllUsers();
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
