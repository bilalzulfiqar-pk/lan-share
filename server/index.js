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

// Store connected users: socketId -> { id, name, deviceId, publicIp, networkFingerprint }
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
            deviceId: null
        };
    }

    if (payload && typeof payload === 'object') {
        return {
            name: sanitizeName(payload.name),
            networkFingerprint: sanitizeNetworkFingerprint(payload.networkFingerprint),
            deviceId: sanitizeDeviceId(payload.deviceId)
        };
    }

    return {
        name: 'Unknown Device',
        networkFingerprint: null,
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

function areUsersVisible(leftUser, rightUser) {
    if (!leftUser || !rightUser) {
        return false;
    }

    if (!leftUser.publicIp || !rightUser.publicIp) {
        return false;
    }

    if (leftUser.publicIp !== rightUser.publicIp) {
        return false;
    }

    // Browsers do not always expose LAN IP information consistently,
    // especially on mobile. If both devices expose a fingerprint,
    // require a match. Otherwise fall back to the shared public IP.
    if (leftUser.networkFingerprint && rightUser.networkFingerprint) {
        return leftUser.networkFingerprint === rightUser.networkFingerprint;
    }

    return true;
}

function getVisibleUsersFor(user) {
    return Object.values(users)
        .filter((candidate) => areUsersVisible(user, candidate))
        .map(({ id, name }) => ({ id, name }));
}

function emitUsersUpdateForPublicIp(publicIp) {
    if (!publicIp) {
        return;
    }

    Object.values(users)
        .filter((user) => user.publicIp === publicIp)
        .forEach((user) => {
            io.to(user.id).emit('users-update', getVisibleUsersFor(user));
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
        const previousUser = users[socket.id];
        const { name, networkFingerprint, deviceId } = normalizeJoinPayload(payload);
        const publicIp = getClientIp(socket);
        const affectedPublicIps = new Set([publicIp]);

        if (previousUser?.publicIp) {
            affectedPublicIps.add(previousUser.publicIp);
        }

        const duplicateUsers = removeDuplicateDeviceEntries(deviceId, socket.id);
        duplicateUsers.forEach((duplicateUser) => {
            if (duplicateUser.publicIp) {
                affectedPublicIps.add(duplicateUser.publicIp);
            }
        });

        users[socket.id] = {
            id: socket.id,
            name,
            deviceId,
            publicIp,
            networkFingerprint
        };

        affectedPublicIps.forEach((affectedPublicIp) => {
            emitUsersUpdateForPublicIp(affectedPublicIp);
        });
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
        const previousUser = removeUser(socket.id);

        if (previousUser?.publicIp) {
            emitUsersUpdateForPublicIp(previousUser.publicIp);
        }
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
