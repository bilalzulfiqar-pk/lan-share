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

// Store connected users: socketId -> { id, name, publicIp, networkFingerprint, groupKey }
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

function normalizeJoinPayload(payload) {
    if (typeof payload === 'string') {
        return {
            name: sanitizeName(payload),
            networkFingerprint: null
        };
    }

    if (payload && typeof payload === 'object') {
        return {
            name: sanitizeName(payload.name),
            networkFingerprint: sanitizeNetworkFingerprint(payload.networkFingerprint)
        };
    }

    return {
        name: 'Unknown Device',
        networkFingerprint: null
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

function getGroupKey(publicIp, networkFingerprint) {
    if (publicIp && networkFingerprint) {
        return `${publicIp}|${networkFingerprint}`;
    }

    if (publicIp) {
        return publicIp;
    }

    if (networkFingerprint) {
        return networkFingerprint;
    }

    return null;
}

function getUsersInGroup(groupKey) {
    return Object.values(users).filter((user) => user.groupKey === groupKey);
}

function emitUsersUpdateForGroup(groupKey) {
    if (!groupKey) {
        return;
    }

    const groupUsers = getUsersInGroup(groupKey);
    const visibleUsers = groupUsers.map(({ id, name }) => ({ id, name }));

    groupUsers.forEach((user) => {
        io.to(user.id).emit('users-update', visibleUsers);
    });
}

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // User joins with a display name
    socket.on('join', (payload) => {
        const previousGroupKey = users[socket.id]?.groupKey;
        const { name, networkFingerprint } = normalizeJoinPayload(payload);
        const publicIp = getClientIp(socket);
        const groupKey = getGroupKey(publicIp, networkFingerprint);

        users[socket.id] = {
            id: socket.id,
            name,
            publicIp,
            networkFingerprint,
            groupKey
        };

        if (previousGroupKey && previousGroupKey !== groupKey) {
            emitUsersUpdateForGroup(previousGroupKey);
        }

        emitUsersUpdateForGroup(groupKey);
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
        const previousGroupKey = users[socket.id]?.groupKey;
        delete users[socket.id];

        if (previousGroupKey) {
            emitUsersUpdateForGroup(previousGroupKey);
        }
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
