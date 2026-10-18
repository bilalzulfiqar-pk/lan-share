import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    createCloudflareSocket,
    shouldUseCloudflareSocket,
    toWebSocketUrl,
    toHttpUrl
} from '../cloudflareSocket';

class MockWebSocket {
    static instances = [];
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    constructor(url) {
        this.url = url;
        this.readyState = 0; // CONNECTING
        this.sent = [];
        MockWebSocket.instances.push(this);

        // Simulate async open
        setTimeout(() => {
            if (this.readyState === 0) {
                this.readyState = 1; // OPEN
                this.onopen?.();
            }
        }, 10);
    }

    send(data) {
        this.sent.push(data);
    }

    close(code = 1000, reason = '') {
        this.readyState = 3; // CLOSED
        this.onclose?.({ code, reason });
    }

    receiveMessage(data) {
        const str = typeof data === 'string' ? data : JSON.stringify(data);
        this.onmessage?.({ data: str });
    }

    triggerError(err) {
        this.onerror?.(err);
    }
}

describe('cloudflareSocket URL and transport resolution helpers', () => {
    it('correctly converts HTTP and HTTPS URLs to WebSocket URLs with /ws', () => {
        expect(toWebSocketUrl('http://localhost:3001')).toBe('ws://localhost:3001/ws');
        expect(toWebSocketUrl('https://lan-share-signaling.workers.dev')).toBe('wss://lan-share-signaling.workers.dev/ws');
        expect(toWebSocketUrl('https://lan-share-signaling.workers.dev/')).toBe('wss://lan-share-signaling.workers.dev/ws');
        expect(toWebSocketUrl('wss://lan-share-signaling.workers.dev/ws')).toBe('wss://lan-share-signaling.workers.dev/ws');
        expect(toWebSocketUrl('ws://127.0.0.1:3001')).toBe('ws://127.0.0.1:3001/ws');
    });

    it('correctly converts WebSocket URLs back to HTTP base URLs for TURN endpoint resolution', () => {
        expect(toHttpUrl('wss://lan-share-signaling.workers.dev/ws')).toBe('https://lan-share-signaling.workers.dev');
        expect(toHttpUrl('ws://localhost:3001/ws')).toBe('http://localhost:3001');
        expect(toHttpUrl('https://lan-share-signaling.workers.dev')).toBe('https://lan-share-signaling.workers.dev');
    });

    it('determines whether to use Cloudflare socket based on transport env and URL', () => {
        // Explicit ws or cloudflare transport setting
        expect(shouldUseCloudflareSocket('http://localhost:3001', 'ws')).toBe(true);
        expect(shouldUseCloudflareSocket('http://localhost:3001', 'cloudflare')).toBe(true);

        // Explicit socketio setting overrides workers.dev URL
        expect(shouldUseCloudflareSocket('https://my-app.workers.dev', 'socketio')).toBe(false);

        // Auto-detection on *.workers.dev URLs
        expect(shouldUseCloudflareSocket('https://lan-share-signaling.subdomain.workers.dev', undefined)).toBe(true);
        expect(shouldUseCloudflareSocket('https://lan-share-signaling.subdomain.workers.dev/', undefined)).toBe(true);
        expect(shouldUseCloudflareSocket('https://lan-share-signaling.subdomain.workers.dev/ws', undefined)).toBe(true);

        // Standard local or VPS URLs default to false (Socket.IO)
        expect(shouldUseCloudflareSocket('http://localhost:3001', undefined)).toBe(false);
        expect(shouldUseCloudflareSocket('http://192.168.1.50:3001', undefined)).toBe(false);
        expect(shouldUseCloudflareSocket('https://lan-share.onrender.com', undefined)).toBe(false);
    });
});

describe('createCloudflareSocket adapter', () => {
    let originalWebSocket;

    beforeEach(() => {
        MockWebSocket.instances = [];
        originalWebSocket = globalThis.WebSocket;
        globalThis.WebSocket = MockWebSocket;
        vi.useFakeTimers();
    });

    afterEach(() => {
        globalThis.WebSocket = originalWebSocket;
        vi.useRealTimers();
    });

    it('performs connection handshake: assigns socket.id BEFORE firing connect listeners', async () => {
        const socket = createCloudflareSocket('https://lan-share-signaling.workers.dev');

        expect(socket.connected).toBe(false);
        expect(socket.id).toBeNull();
        expect(socket.io.uri).toBe('https://lan-share-signaling.workers.dev');
        expect(socket.io.engine.transport.name).toBe('websocket');

        const connectEvents = [];
        socket.on('connect', () => {
            connectEvents.push({
                connected: socket.connected,
                assignedId: socket.id
            });
        });

        // Advance timers to trigger open
        vi.advanceTimersByTime(15);
        expect(MockWebSocket.instances.length).toBe(1);
        const ws = MockWebSocket.instances[0];

        // Before server sends "connected", socket.connected should still be false
        expect(socket.connected).toBe(false);
        expect(connectEvents.length).toBe(0);

        // Server sends assigned socket id
        ws.receiveMessage({ type: 'connected', id: 'assigned-uuid-1234' });

        expect(socket.connected).toBe(true);
        expect(socket.id).toBe('assigned-uuid-1234');
        expect(connectEvents.length).toBe(1);
        expect(connectEvents[0]).toEqual({
            connected: true,
            assignedId: 'assigned-uuid-1234'
        });

        socket.disconnect();
    });

    it('supports event emission, listener registration, and .off() removal', async () => {
        const socket = createCloudflareSocket('https://lan-share-signaling.workers.dev');
        vi.advanceTimersByTime(15);
        const ws = MockWebSocket.instances[0];
        ws.receiveMessage({ type: 'connected', id: 'client-1' });

        // Test event listener
        const receivedUpdates = [];
        const updateListener = (users) => receivedUpdates.push(users);
        socket.on('users-update', updateListener);

        ws.receiveMessage({
            type: 'users-update',
            data: [{ id: 'peer-2', name: 'Bob' }]
        });
        expect(receivedUpdates).toEqual([[{ id: 'peer-2', name: 'Bob' }]]);

        // Test .off with specific callback
        socket.off('users-update', updateListener);
        ws.receiveMessage({
            type: 'users-update',
            data: [{ id: 'peer-3', name: 'Charlie' }]
        });
        expect(receivedUpdates.length).toBe(1);

        // Test .off without callback (removes all listeners)
        const debugListener1 = vi.fn();
        const debugListener2 = vi.fn();
        socket.on('debug-state', debugListener1);
        socket.on('debug-state', debugListener2);

        socket.off('debug-state');
        ws.receiveMessage({ type: 'debug-state', data: { publicIp: '1.2.3.4' } });
        expect(debugListener1).not.toHaveBeenCalled();
        expect(debugListener2).not.toHaveBeenCalled();

        socket.disconnect();
    });

    it('supports socket.emit() with ack callbacks (e.g. join-room and leave-room)', async () => {
        const socket = createCloudflareSocket('https://lan-share-signaling.workers.dev');
        vi.advanceTimersByTime(15);
        const ws = MockWebSocket.instances[0];
        ws.receiveMessage({ type: 'connected', id: 'client-1' });

        const ackReceived = [];
        socket.emit('join-room', { roomCode: 'ROOM42' }, (response) => {
            ackReceived.push(response);
        });

        expect(ws.sent.length).toBe(1);
        const parsed = JSON.parse(ws.sent[0]);
        expect(parsed.type).toBe('join-room');
        expect(parsed.data).toEqual({ roomCode: 'ROOM42' });
        expect(parsed.ackId).toBeDefined();

        // Server replies with ack matching ackId
        ws.receiveMessage({
            type: 'ack',
            ackId: parsed.ackId,
            payload: { success: true, roomCode: 'ROOM42' }
        });

        expect(ackReceived).toEqual([{ success: true, roomCode: 'ROOM42' }]);

        socket.disconnect();
    });

    it('flushes messages queued before socket is fully connected', async () => {
        const socket = createCloudflareSocket('https://lan-share-signaling.workers.dev');

        // Emit while still connecting
        socket.emit('join', { name: 'Alice', deviceId: 'dev-1' });

        const ws = MockWebSocket.instances[0];
        expect(ws.sent.length).toBe(0); // Not sent yet

        // Complete handshake
        vi.advanceTimersByTime(15);
        ws.receiveMessage({ type: 'connected', id: 'alice-id' });

        // Queued message should now be flushed
        expect(ws.sent.length).toBe(1);
        const parsed = JSON.parse(ws.sent[0]);
        expect(parsed.type).toBe('join');
        expect(parsed.data).toEqual({ name: 'Alice', deviceId: 'dev-1' });

        socket.disconnect();
    });

    it('cleanly forwards and receives WebRTC signaling events including request-offer', async () => {
        const socket = createCloudflareSocket('https://lan-share-signaling.workers.dev');
        vi.advanceTimersByTime(15);
        const ws = MockWebSocket.instances[0];
        ws.receiveMessage({ type: 'connected', id: 'peer-1' });

        const requestOfferListener = vi.fn();
        socket.on('request-offer', requestOfferListener);

        // 1. Verify emit sends { type: 'request-offer', data: { target: 'peer-2' } }
        socket.emit('request-offer', { target: 'peer-2' });
        expect(ws.sent.length).toBe(1);
        const sentMsg = JSON.parse(ws.sent[0]);
        expect(sentMsg.type).toBe('request-offer');
        expect(sentMsg.data).toEqual({ target: 'peer-2' });

        // 2. Verify server message invokes listener with payload
        ws.receiveMessage({ type: 'request-offer', data: { sender: 'peer-2' } });
        expect(requestOfferListener).toHaveBeenCalledTimes(1);
        expect(requestOfferListener).toHaveBeenCalledWith({ sender: 'peer-2' });

        socket.disconnect();
    });

    it('automatically reconnects with backoff on unexpected close and fires connect again', async () => {
        const socket = createCloudflareSocket('https://lan-share-signaling.workers.dev');
        vi.advanceTimersByTime(15);
        let ws = MockWebSocket.instances[0];
        ws.receiveMessage({ type: 'connected', id: 'conn-1' });

        const disconnectSpy = vi.fn();
        const connectSpy = vi.fn();
        socket.on('disconnect', disconnectSpy);
        socket.on('connect', connectSpy);

        // Simulate unexpected close
        ws.close(1006, 'Abnormal Closure');
        expect(socket.connected).toBe(false);
        expect(disconnectSpy).toHaveBeenCalledTimes(1);

        // First reconnect attempt after 1s (1000ms)
        vi.advanceTimersByTime(1000);
        expect(MockWebSocket.instances.length).toBe(2);
        ws = MockWebSocket.instances[1];

        // Advance to open the new socket
        vi.advanceTimersByTime(15);
        ws.receiveMessage({ type: 'connected', id: 'conn-2' });

        expect(socket.connected).toBe(true);
        expect(socket.id).toBe('conn-2');
        expect(connectSpy).toHaveBeenCalledTimes(1);

        socket.disconnect();
    });

    it('stops reconnecting when socket.disconnect() is explicitly called', async () => {
        const socket = createCloudflareSocket('https://lan-share-signaling.workers.dev');
        vi.advanceTimersByTime(15);
        const ws = MockWebSocket.instances[0];
        ws.receiveMessage({ type: 'connected', id: 'conn-1' });

        socket.disconnect();
        expect(socket.connected).toBe(false);

        // Even after backoff duration, no new WebSocket instance should be created
        vi.advanceTimersByTime(10000);
        expect(MockWebSocket.instances.length).toBe(1);
    });

    it('sends keepalive ping every 25 seconds while connected and stops on disconnect', async () => {
        const socket = createCloudflareSocket('https://lan-share-signaling.workers.dev');
        vi.advanceTimersByTime(15);
        const ws = MockWebSocket.instances[0];
        ws.receiveMessage({ type: 'connected', id: 'client-ping' });

        expect(ws.sent.length).toBe(0);

        // Advance 25 seconds
        vi.advanceTimersByTime(25000);
        expect(ws.sent.length).toBe(1);
        expect(JSON.parse(ws.sent[0])).toEqual({ type: 'ping' });

        // Server responds with pong
        ws.receiveMessage({ type: 'pong' });

        // Advance another 25 seconds
        vi.advanceTimersByTime(25000);
        expect(ws.sent.length).toBe(2);
        expect(JSON.parse(ws.sent[1])).toEqual({ type: 'ping' });

        // Disconnect stops pinging
        socket.disconnect();
        vi.advanceTimersByTime(50000);
        expect(ws.sent.length).toBe(2);
    });
});
