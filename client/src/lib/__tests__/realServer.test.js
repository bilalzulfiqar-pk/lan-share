import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import process from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { io } from 'socket.io-client';
import { TransferEngine } from '../transferEngine';
import {
    installMockWebRTC,
    createMockFile,
    waitFor
} from './harness';

// End-to-end verification against the REAL signaling server: the actual
// Express + socket.io process relays signaling between two real engine
// instances (WebRTC itself is mocked, everything else is live).

const PORT = 3311;
const SERVER_URL = `http://localhost:${PORT}`;
const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = path.resolve(here, '../../../../server/index.js');

let serverProcess = null;

async function fetchHealth() {
    try {
        const response = await fetch(`${SERVER_URL}/health`);
        return response.ok;
    } catch {
        return false;
    }
}

function connectClient() {
    return new Promise((resolve, reject) => {
        const socket = io(SERVER_URL, { transports: ['websocket'] });
        const timeout = setTimeout(() => reject(new Error('client connect timeout')), 5000);
        socket.on('connect', () => {
            clearTimeout(timeout);
            resolve(socket);
        });
        socket.on('connect_error', (error) => {
            clearTimeout(timeout);
            reject(error);
        });
    });
}

function joinAs(socket, name) {
    socket.emit('join', { name, networkFingerprints: [], deviceId: null });
}

// The server relays are gated on the peer having JOINED, and joining is
// async. Waiting for a users-update that lists the peer proves the server
// processed both joins (and that they are mutually visible), eliminating a
// race where an offer would be dropped as "unknown target".
async function waitUntilPeerVisible(observerSocket, peerId, label) {
    const userLists = [];
    observerSocket.on('users-update', (users) => userLists.push(users));

    await waitFor(
        () => userLists.some((users) => users.some((user) => user.id === peerId)),
        { label, timeout: 8000, interval: 25 }
    );
}

// Socket.io client wrapped in the minimal surface the engine expects; emits
// go to the real server, server events are dispatched to engine handlers.
function bridgeToServer(socket) {
    const handlers = new Map();

    const surface = {
        on(event, handler) {
            handlers.set(event, handler);
        },
        off(event) {
            handlers.delete(event);
        },
        emit(event, payload) {
            socket.emit(event, payload);
        },
        receive(event, payload) {
            handlers.get(event)?.(payload);
        }
    };

    ['offer', 'answer', 'ice-candidate', 'users-update', 'debug-state'].forEach((event) => {
        socket.on(event, (payload) => surface.receive(event, payload));
    });

    return surface;
}

async function createEnginePairOnServer() {
    const socketA = await connectClient();
    const socketB = await connectClient();

    joinAs(socketA, 'Alice');
    joinAs(socketB, 'Bob');
    await waitUntilPeerVisible(socketA, socketB.id, 'peer B registered on the server');

    const surfaceA = bridgeToServer(socketA);
    const surfaceB = bridgeToServer(socketB);

    const eventsA = [];
    const eventsB = [];

    const engineA = new TransferEngine({
        socket: surfaceA,
        myId: socketA.id,
        getPeerName: () => 'Bob',
        onEvent: (event) => eventsA.push(event)
    });

    const engineB = new TransferEngine({
        socket: surfaceB,
        myId: socketB.id,
        getPeerName: () => 'Alice',
        onEvent: (event) => eventsB.push(event)
    });

    return { socketA, socketB, engineA, engineB, eventsA, eventsB };
}

function lastUpdateFor(events, id) {
    const updates = events.filter((event) => event.type === 'history:update' && event.id === id);
    return updates[updates.length - 1]?.updates;
}

describe('TransferEngine against the real signaling server', () => {
    beforeAll(async () => {
        serverProcess = spawn(process.execPath, [SERVER_ENTRY], {
            env: { ...process.env, PORT: String(PORT) },
            stdio: 'ignore'
        });

        await waitFor(() => fetchHealth(), { timeout: 15000, interval: 150, label: 'server /health' });
    }, 20000);

    afterAll(() => {
        serverProcess?.kill();
    });

    beforeEach(() => {
        installMockWebRTC();
        globalThis.URL.createObjectURL = globalThis.URL.createObjectURL || (() => `blob:mock-${Math.random()}`);
        globalThis.URL.revokeObjectURL = globalThis.URL.revokeObjectURL || (() => {});
    });

    afterEach(() => {
        delete globalThis.RTCPeerConnection;
    });

    it('transfers a file with the real server relaying all signaling', async () => {
        const { socketA, socketB, engineA, engineB, eventsA, eventsB } = await createEnginePairOnServer();

        try {
            const file = createMockFile('real-server.bin', 128 * 1024);
            engineA.offerFiles(socketB.id, [file]);

            const id = await waitFor(
                () => eventsB.find((event) => event.type === 'history:add')?.items[0]?.id,
                { label: 'receiver history item' }
            );

            await engineB.requestFile(id);

            await waitFor(() => lastUpdateFor(eventsA, id)?.status === 'completed', { label: 'sender completed' });
            await waitFor(() => lastUpdateFor(eventsB, id)?.status === 'completed', { label: 'receiver completed' });

            expect(lastUpdateFor(eventsB, id)?.verified).toBe(true);
            expect(engineB.downloadUrls.has(id)).toBe(true);
        } finally {
            engineA.destroy();
            engineB.destroy();
            socketA.disconnect();
            socketB.disconnect();
        }
    }, 20000);

    it('exchanges chat messages through the real server', async () => {
        const { socketA, socketB, engineA, engineB, eventsA, eventsB } = await createEnginePairOnServer();

        try {
            engineA.sendChat(socketB.id, 'hello over the real server');

            const received = await waitFor(
                () => eventsB.find((event) => event.type === 'chat') || null,
                { label: 'chat at B' }
            );
            expect(received.message.text).toBe('hello over the real server');

            engineB.sendChat(socketA.id, 'received, thanks');
            const echo = await waitFor(
                () => eventsA.find((event) => event.type === 'chat') || null,
                { label: 'chat at A' }
            );
            expect(echo.message.text).toBe('received, thanks');
        } finally {
            engineA.destroy();
            engineB.destroy();
            socketA.disconnect();
            socketB.disconnect();
        }
    }, 20000);

    it('overrides spoofed sender identities on relayed offers', async () => {
        const socketA = await connectClient();
        const socketB = await connectClient();
        joinAs(socketA, 'Alice');
        joinAs(socketB, 'Bob');
        await waitUntilPeerVisible(socketA, socketB.id, 'peer B registered on the server');

        try {
            const receivedOffer = new Promise((resolve) => {
                socketB.on('offer', (payload) => resolve(payload));
            });

            socketA.emit('offer', {
                target: socketB.id,
                sender: 'totally-fake-identity',
                offer: { type: 'offer', sdp: 'v=0 fake' }
            });

            const payload = await receivedOffer;
            expect(payload.sender).toBe(socketA.id);
            expect(payload.sender).not.toBe('totally-fake-identity');
        } finally {
            socketA.disconnect();
            socketB.disconnect();
        }
    }, 15000);

    it('drops relay attempts aimed at unknown targets without breaking the server', async () => {
        const socketA = await connectClient();
        joinAs(socketA, 'Alice');

        try {
            socketA.emit('offer', {
                target: 'no-such-socket',
                sender: socketA.id,
                offer: { type: 'offer', sdp: 'v=0 x' }
            });

            await new Promise((resolve) => setTimeout(resolve, 300));
            expect(socketA.connected).toBe(true);
            expect(await fetchHealth()).toBe(true);
        } finally {
            socketA.disconnect();
        }
    }, 10000);

    it('disconnects sockets that flood invalid relays (rate limiting)', async () => {
        const socketA = await connectClient();
        joinAs(socketA, 'Alice');

        try {
            const disconnected = new Promise((resolve) => {
                socketA.on('disconnect', resolve);
            });

            // Invalid targets count as strikes; 25 strikes boots the socket.
            // Well over the token bucket capacity, so most are dropped fast.
            for (let i = 0; i < 300; i += 1) {
                socketA.emit('offer', {
                    target: `bogus-${i}`,
                    sender: socketA.id,
                    offer: { type: 'offer', sdp: 'v=0 x' }
                });
            }

            await disconnected;
            expect(socketA.connected).toBe(false);
        } finally {
            socketA.disconnect();
        }
    }, 15000);

    it('shows same-network peers to each other via users-update', async () => {
        const socketA = await connectClient();
        const socketB = await connectClient();
        joinAs(socketA, 'Alice');
        joinAs(socketB, 'Bob');

        try {
            const userLists = [];
            socketA.on('users-update', (users) => userLists.push(users));

            // users-update broadcasts are debounced by ~100ms; trigger one.
            joinAs(socketA, 'Alice (renamed)');

            await waitFor(
                () => userLists.some((users) => users.some((user) => user.id === socketB.id && user.name === 'Bob')),
                { label: 'users-update containing Bob', timeout: 8000 }
            );
        } finally {
            socketA.disconnect();
            socketB.disconnect();
        }
    }, 15000);
});
