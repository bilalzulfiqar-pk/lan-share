import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock cloudflare:workers module before importing index.js
vi.mock('cloudflare:workers', () => ({
    DurableObject: class {
        constructor(ctx, env) {
            this.ctx = ctx;
            this.env = env;
        }
    }
}));

class MockServerWebSocket {
    constructor() {
        this.attachment = null;
        this.sent = [];
        this.readyState = 1;
        this.closed = false;
        this.closeCode = null;
        this.closeReason = null;
    }

    send(data) {
        this.sent.push(data);
    }

    close(code = 1000, reason = '') {
        this.closed = true;
        this.closeCode = code;
        this.closeReason = reason;
        this.readyState = 3;
    }

    serializeAttachment(attachment) {
        this.attachment = JSON.parse(JSON.stringify(attachment));
    }

    deserializeAttachment() {
        return this.attachment ? JSON.parse(JSON.stringify(this.attachment)) : null;
    }
}

class MockExecutionContext {
    constructor() {
        this.acceptedSockets = [];
    }

    acceptWebSocket(ws) {
        this.acceptedSockets.push(ws);
    }

    getWebSockets() {
        return this.acceptedSockets;
    }

    setWebSocketAutoResponse() {}
}

// Set up global WebSocketPair for tests
globalThis.WebSocketPair = class {
    constructor() {
        this[0] = new MockServerWebSocket();
        this[1] = new MockServerWebSocket();
    }
};

const { default: worker, SignalingHub } = await import('../index.js');

describe('Worker HTTP endpoints', () => {
    it('handles OPTIONS preflight requests with 204 and CORS headers', async () => {
        const req = new Request('https://lan-share-signaling.workers.dev/api/turn-credentials', {
            method: 'OPTIONS'
        });
        const res = await worker.fetch(req, {});
        expect(res.status).toBe(204);
        expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
        expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET');
    });

    it('handles GET /health with 200 OK and CORS headers', async () => {
        const req = new Request('https://lan-share-signaling.workers.dev/health');
        const res = await worker.fetch(req, {});
        expect(res.status).toBe(200);
        expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
        const body = await res.json();
        expect(body).toEqual({ ok: true });
    });

    it('handles GET / with status running info', async () => {
        const req = new Request('https://lan-share-signaling.workers.dev/');
        const res = await worker.fetch(req, {});
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.status).toBe('running');
        expect(body.ws).toBe('/ws');
    });

    it('returns default STUN servers and enforces rate limits on GET /api/turn-credentials', async () => {
        const req = new Request('https://lan-share-signaling.workers.dev/api/turn-credentials', {
            headers: { 'cf-connecting-ip': '198.51.100.1' }
        });
        const res = await worker.fetch(req, {});
        expect(res.status).toBe(200);
        expect(res.headers.get('Cache-Control')).toBe('private, no-cache');
        const body = await res.json();
        expect(body.iceServers).toBeDefined();
        expect(body.iceServers.length).toBeGreaterThan(0);

        // Exhaust the token bucket rate limiter (capacity 30)
        let lastRes;
        for (let i = 0; i < 35; i++) {
            lastRes = await worker.fetch(req, {});
        }
        expect(lastRes.status).toBe(429);
        const errorBody = await lastRes.json();
        expect(errorBody.error).toContain('Too many requests');
    });

    it('forwards /ws and Upgrade: websocket requests to the Durable Object stub', async () => {
        let routedId = null;
        let routedReq = null;

        const mockEnv = {
            SIGNALING_HUB: {
                idFromName: (name) => `id-${name}`,
                get: (id) => ({
                    fetch: async (req) => {
                        routedId = id;
                        routedReq = req;
                        const stubRes = new Response(null, { status: 200 });
                        Object.defineProperty(stubRes, 'status', { value: 101 });
                        return stubRes;
                    }
                })
            }
        };

        const req = new Request('https://lan-share-signaling.workers.dev/ws', {
            headers: {
                'Upgrade': 'websocket',
                'cf-connecting-ip': '203.0.113.19',
                'user-agent': 'Mozilla/5.0 (Android; Mobile)'
            }
        });

        const res = await worker.fetch(req, mockEnv);
        expect(res.status).toBe(101);
        expect(routedId).toBe('id-global-hub');
        expect(routedReq.headers.get('cf-connecting-ip')).toBe('203.0.113.19');
    });
});

describe('SignalingHub Durable Object with WebSocket Hibernation', () => {
    let ctx;
    let env;
    let hub;

    beforeEach(() => {
        ctx = new MockExecutionContext();
        env = {};
        hub = new SignalingHub(ctx, env);
    });

    it('initializes connection, serializes initial attachment, and sends connected event', async () => {
        const req = new Request('https://lan-share-signaling.workers.dev/ws', {
            headers: {
                'cf-connecting-ip': '192.0.2.1',
                'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'
            }
        });

        const res = await hub.fetch(req);
        expect(res.status).toBe(101);
        expect(ctx.acceptedSockets.length).toBe(1);

        const serverWs = ctx.acceptedSockets[0];
        const attachment = serverWs.deserializeAttachment();

        expect(attachment).toBeDefined();
        expect(attachment.id).toBeDefined();
        expect(attachment.publicIp).toBe('192.0.2.1');
        expect(attachment.deviceType).toBe('mobile');
        expect(attachment.strikes).toBe(0);

        expect(serverWs.sent.length).toBe(1);
        const msg = JSON.parse(serverWs.sent[0]);
        expect(msg.type).toBe('connected');
        expect(msg.id).toBe(attachment.id);
    });

    it('responds to keepalive ping with pong', async () => {
        const req = new Request('https://lan-share-signaling.workers.dev/ws');
        await hub.fetch(req);
        const ws = ctx.acceptedSockets[0];
        ws.sent.length = 0; // Clear connected message

        await hub.webSocketMessage(ws, JSON.stringify({ type: 'ping' }));
        expect(ws.sent.length).toBe(1);
        expect(JSON.parse(ws.sent[0])).toEqual({ type: 'pong' });
    });

    it('registers users on join, manages visibility by IP/fingerprint, and broadcasts users-update', async () => {
        const req1 = new Request('https://lan-share-signaling.workers.dev/ws', {
            headers: { 'cf-connecting-ip': '198.51.100.22' }
        });
        const req2 = new Request('https://lan-share-signaling.workers.dev/ws', {
            headers: { 'cf-connecting-ip': '198.51.100.22' }
        });

        await hub.fetch(req1);
        await hub.fetch(req2);

        const ws1 = ctx.acceptedSockets[0];
        const ws2 = ctx.acceptedSockets[1];
        const id1 = ws1.deserializeAttachment().id;
        const id2 = ws2.deserializeAttachment().id;

        // Alice joins
        await hub.webSocketMessage(ws1, JSON.stringify({
            type: 'join',
            data: { name: 'Alice', deviceId: 'dev-alice' }
        }));

        // Bob joins
        await hub.webSocketMessage(ws2, JSON.stringify({
            type: 'join',
            data: { name: 'Bob', deviceId: 'dev-bob' }
        }));

        hub.flushUsersUpdate();

        // Check messages sent to Alice
        const aliceMsgs = ws1.sent.map((s) => JSON.parse(s));
        const aliceUpdate = aliceMsgs.find((m) => m.type === 'users-update');
        expect(aliceUpdate).toBeDefined();
        expect(aliceUpdate.data.length).toBe(1);
        expect(aliceUpdate.data[0].id).toBe(id2);
        expect(aliceUpdate.data[0].name).toBe('Bob');

        // Check messages sent to Bob
        const bobMsgs = ws2.sent.map((s) => JSON.parse(s));
        const bobUpdate = bobMsgs.find((m) => m.type === 'users-update');
        expect(bobUpdate).toBeDefined();
        expect(bobUpdate.data.length).toBe(1);
        expect(bobUpdate.data[0].id).toBe(id1);
        expect(bobUpdate.data[0].name).toBe('Alice');
    });

    it('isolates users on different public IPs until they join the same room', async () => {
        const req1 = new Request('https://lan-share-signaling.workers.dev/ws', {
            headers: { 'cf-connecting-ip': '198.51.100.1' }
        });
        const req2 = new Request('https://lan-share-signaling.workers.dev/ws', {
            headers: { 'cf-connecting-ip': '203.0.113.2' }
        });

        await hub.fetch(req1);
        await hub.fetch(req2);
        const ws1 = ctx.acceptedSockets[0];
        const ws2 = ctx.acceptedSockets[1];
        const id1 = ws1.deserializeAttachment().id;
        const id2 = ws2.deserializeAttachment().id;

        await hub.webSocketMessage(ws1, JSON.stringify({ type: 'join', data: { name: 'Alice' } }));
        await hub.webSocketMessage(ws2, JSON.stringify({ type: 'join', data: { name: 'Bob' } }));
        hub.flushUsersUpdate();

        // Alice sees Bob? No, different IP
        let aliceMsgs = ws1.sent.map((s) => JSON.parse(s));
        let lastUpdate = aliceMsgs.filter((m) => m.type === 'users-update').pop();
        expect(lastUpdate.data.length).toBe(0);

        // Both join room 123456
        await hub.webSocketMessage(ws1, JSON.stringify({
            type: 'join-room',
            data: { roomCode: '123456' },
            ackId: 'ack-1'
        }));
        await hub.webSocketMessage(ws2, JSON.stringify({
            type: 'join-room',
            data: { roomCode: '123456' },
            ackId: 'ack-2'
        }));

        hub.flushUsersUpdate();

        // Check acks
        aliceMsgs = ws1.sent.map((s) => JSON.parse(s));
        const ack1 = aliceMsgs.find((m) => m.type === 'ack' && m.ackId === 'ack-1');
        expect(ack1.payload).toEqual({ success: true, roomCode: '123456' });

        // Now Alice sees Bob
        lastUpdate = aliceMsgs.filter((m) => m.type === 'users-update').pop();
        expect(lastUpdate.data.length).toBe(1);
        expect(lastUpdate.data[0].id).toBe(id2);

        // Alice leaves room
        await hub.webSocketMessage(ws1, JSON.stringify({
            type: 'leave-room',
            ackId: 'ack-leave-1'
        }));
        hub.flushUsersUpdate();

        aliceMsgs = ws1.sent.map((s) => JSON.parse(s));
        const ackLeave = aliceMsgs.find((m) => m.type === 'ack' && m.ackId === 'ack-leave-1');
        expect(ackLeave.payload).toEqual({ success: true, roomCode: null });

        lastUpdate = aliceMsgs.filter((m) => m.type === 'users-update').pop();
        expect(lastUpdate.data.length).toBe(0);
    });

    it('relays valid WebRTC offer, answer, and ice-candidate between visible peers and updates session registry', async () => {
        const req1 = new Request('https://lan-share-signaling.workers.dev/ws', {
            headers: { 'cf-connecting-ip': '198.51.100.5' }
        });
        const req2 = new Request('https://lan-share-signaling.workers.dev/ws', {
            headers: { 'cf-connecting-ip': '198.51.100.5' }
        });

        await hub.fetch(req1);
        await hub.fetch(req2);
        const ws1 = ctx.acceptedSockets[0];
        const ws2 = ctx.acceptedSockets[1];
        const id1 = ws1.deserializeAttachment().id;
        const id2 = ws2.deserializeAttachment().id;

        await hub.webSocketMessage(ws1, JSON.stringify({ type: 'join', data: { name: 'Alice' } }));
        await hub.webSocketMessage(ws2, JSON.stringify({ type: 'join', data: { name: 'Bob' } }));
        hub.flushUsersUpdate();

        ws2.sent.length = 0; // Clear previous messages

        // Send offer from Alice to Bob
        const validOffer = { type: 'offer', sdp: 'v=0\r\no=- 1234 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n' };
        await hub.webSocketMessage(ws1, JSON.stringify({
            type: 'offer',
            data: { target: id2, offer: validOffer }
        }));

        expect(ws2.sent.length).toBe(1);
        const receivedOffer = JSON.parse(ws2.sent[0]);
        expect(receivedOffer.type).toBe('offer');
        expect(receivedOffer.data.sender).toBe(id1);
        expect(receivedOffer.data.offer).toEqual(validOffer);

        // Verify session was registered in signalingRegistry
        expect(hub.signalingRegistry.isAuthorized(id1, id2)).toBe(true);

        // Send answer from Bob to Alice
        ws1.sent.length = 0;
        const validAnswer = { type: 'answer', sdp: 'v=0\r\no=- 5678 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n' };
        await hub.webSocketMessage(ws2, JSON.stringify({
            type: 'answer',
            data: { target: id1, answer: validAnswer }
        }));

        expect(ws1.sent.length).toBe(1);
        const receivedAnswer = JSON.parse(ws1.sent[0]);
        expect(receivedAnswer.type).toBe('answer');
        expect(receivedAnswer.data.sender).toBe(id2);
        expect(receivedAnswer.data.answer).toEqual(validAnswer);

        // Send ICE candidate from Alice to Bob
        ws2.sent.length = 0;
        const validCandidate = { candidate: 'candidate:1 1 UDP 2130706431 192.168.1.100 50000 typ host' };
        await hub.webSocketMessage(ws1, JSON.stringify({
            type: 'ice-candidate',
            data: { target: id2, candidate: validCandidate }
        }));

        expect(ws2.sent.length).toBe(1);
        const receivedCandidate = JSON.parse(ws2.sent[0]);
        expect(receivedCandidate.type).toBe('ice-candidate');
        expect(receivedCandidate.data.sender).toBe(id1);
        expect(receivedCandidate.data.candidate).toEqual(validCandidate);

        // Send request-offer from Bob to Alice (e.g. transfer renegotiation)
        ws1.sent.length = 0;
        await hub.webSocketMessage(ws2, JSON.stringify({
            type: 'request-offer',
            data: { target: id1 }
        }));

        expect(ws1.sent.length).toBe(1);
        const receivedRequestOffer = JSON.parse(ws1.sent[0]);
        expect(receivedRequestOffer.type).toBe('request-offer');
        expect(receivedRequestOffer.data.sender).toBe(id2);
        expect(hub.signalingRegistry.isAuthorized(id2, id1)).toBe(true);
    });

    it('enforces relay strikes and disconnects abusive clients on 25 strikes', async () => {
        const req = new Request('https://lan-share-signaling.workers.dev/ws', {
            headers: { 'cf-connecting-ip': '198.51.100.9' }
        });
        await hub.fetch(req);
        const ws = ctx.acceptedSockets[0];
        const id = ws.deserializeAttachment().id;

        await hub.webSocketMessage(ws, JSON.stringify({ type: 'join', data: { name: 'Attacker' } }));

        // Send 25 invalid offers (e.g. malformed SDP)
        for (let i = 0; i < 25; i++) {
            await hub.webSocketMessage(ws, JSON.stringify({
                type: 'offer',
                data: { target: 'non-existent', offer: 'not-an-object' }
            }));
        }

        expect(ws.closed).toBe(true);
        expect(ws.closeCode).toBe(1008); // Policy Violation
        expect(hub.users[id]).toBeUndefined();
    });

    it('rehydrates state seamlessly across Durable Object hibernation', async () => {
        // Setup initial hub and join a user
        const req1 = new Request('https://lan-share-signaling.workers.dev/ws', {
            headers: { 'cf-connecting-ip': '198.51.100.77' }
        });
        await hub.fetch(req1);
        const ws1 = ctx.acceptedSockets[0];
        const id1 = ws1.deserializeAttachment().id;

        await hub.webSocketMessage(ws1, JSON.stringify({
            type: 'join',
            data: { name: 'PersistentAlice', deviceId: 'dev-persistent', roomCode: 'ROOM99' }
        }));

        // Register a session
        hub.signalingRegistry.registerSession(id1, 'target-peer-99');
        const pairKey = hub.signalingRegistry._pairKey(id1, 'target-peer-99');
        const expiresAt = hub.signalingRegistry.sessions.get(pairKey);
        const attachment = ws1.deserializeAttachment();
        attachment.sessions = [{ target: 'target-peer-99', expiresAt }];
        ws1.serializeAttachment(attachment);

        // SIMULATE HIBERNATION WAKE-UP:
        // A new instance of SignalingHub is constructed with the existing ctx
        // containing the hibernated WebSocket!
        const hibernatedHub = new SignalingHub(ctx, env);

        // Verify rehydration:
        expect(hibernatedHub.socketById.get(id1)).toBe(ws1);
        expect(hibernatedHub.users[id1]).toBeDefined();
        expect(hibernatedHub.users[id1].name).toBe('PersistentAlice');
        expect(hibernatedHub.users[id1].roomCode).toBe('ROOM99');
        expect(hibernatedHub.similarityIndex.getCandidateIdsFor(hibernatedHub.users[id1])).toBeDefined();
        expect(hibernatedHub.signalingRegistry.isAuthorized(id1, 'target-peer-99')).toBe(true);
    });

    it('cleans up user and broadcasts updates when WebSocket closes', async () => {
        const req1 = new Request('https://lan-share-signaling.workers.dev/ws', {
            headers: { 'cf-connecting-ip': '198.51.100.88' }
        });
        const req2 = new Request('https://lan-share-signaling.workers.dev/ws', {
            headers: { 'cf-connecting-ip': '198.51.100.88' }
        });

        await hub.fetch(req1);
        await hub.fetch(req2);
        const ws1 = ctx.acceptedSockets[0];
        const ws2 = ctx.acceptedSockets[1];
        const id1 = ws1.deserializeAttachment().id;
        const id2 = ws2.deserializeAttachment().id;

        await hub.webSocketMessage(ws1, JSON.stringify({ type: 'join', data: { name: 'Alice' } }));
        await hub.webSocketMessage(ws2, JSON.stringify({ type: 'join', data: { name: 'Bob' } }));
        hub.flushUsersUpdate();

        // Alice disconnects
        await hub.webSocketClose(ws1);
        hub.flushUsersUpdate();

        expect(hub.users[id1]).toBeUndefined();
        expect(hub.socketById.get(id1)).toBeUndefined();

        // Bob receives updated users list without Alice
        const bobMsgs = ws2.sent.map((s) => JSON.parse(s));
        const lastBobUpdate = bobMsgs.filter((m) => m.type === 'users-update').pop();
        expect(lastBobUpdate.data.length).toBe(0);
    });
});
