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

// Store connected users: socketId -> { id, name }
const users = {};

io.on('connection', (socket) => {
    console.log('Use connected:', socket.id);

    // User joins with a display name
    socket.on('join', (name) => {
        users[socket.id] = { id: socket.id, name };
        // Broadcast updated user list to everyone
        io.emit('users-update', Object.values(users));
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
        delete users[socket.id];
        io.emit('users-update', Object.values(users));
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
