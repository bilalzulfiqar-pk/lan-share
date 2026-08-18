import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TransferEngine } from '../transferEngine';
import {
    installMockWebRTC,
    MockSocket,
    createSocketBus,
    createMockFile,
    waitFor
} from './harness';

// Two engines wired through mocked WebRTC + signaling, exercising the real
// protocol: connection, handshake, offers, streaming transfer, integrity,
// cancellation, glare and multi-peer sessions.

function createEnginePair() {
    const bus = createSocketBus();
    const socketA = new MockSocket('alice', bus);
    const socketB = new MockSocket('bob', bus);

    const eventsA = [];
    const eventsB = [];

    const engineA = new TransferEngine({
        socket: socketA,
        myId: 'alice',
        getPeerName: () => 'Bob',
        onEvent: (event) => eventsA.push(event)
    });

    const engineB = new TransferEngine({
        socket: socketB,
        myId: 'bob',
        getPeerName: () => 'Alice',
        onEvent: (event) => eventsB.push(event)
    });

    return { bus, engineA, engineB, eventsA, eventsB };
}

function lastUpdateFor(events, id) {
    const updates = events.filter((event) => event.type === 'history:update' && event.id === id);
    return updates[updates.length - 1]?.updates;
}

function firstAddedItem(events) {
    return events.find((event) => event.type === 'history:add')?.items[0];
}

async function offerAndRequestId(engineA, receiverEvents, file) {
    engineA.offerFiles('bob', [file]);
    const id = await waitFor(() => firstAddedItem(receiverEvents)?.id, { label: 'receiver history item' });
    await waitFor(() => engineA.outgoing.has(id), { label: 'outgoing registration' });
    return id;
}

describe('TransferEngine', () => {
    beforeEach(() => {
        installMockWebRTC();
        globalThis.URL.createObjectURL = globalThis.URL.createObjectURL || (() => `blob:mock-${Math.random()}`);
        globalThis.URL.revokeObjectURL = globalThis.URL.revokeObjectURL || (() => {});
    });

    afterEach(() => {
        delete globalThis.RTCPeerConnection;
    });

    it('connects, transfers a file with integrity verification, and completes on both sides', async () => {
        const { engineA, engineB, eventsA, eventsB } = createEnginePair();
        const file = createMockFile('notes.bin', 150 * 1024);

        const id = await offerAndRequestId(engineA, eventsB, file);

        expect(firstAddedItem(eventsA)).toMatchObject({ id, fileName: 'notes.bin', direction: 'out', status: 'idle', peerName: 'Bob' });
        expect(firstAddedItem(eventsB)).toMatchObject({ id, fileName: 'notes.bin', direction: 'in', status: 'idle', peerName: 'Alice' });

        await engineB.requestFile(id);

        await waitFor(() => lastUpdateFor(eventsA, id)?.status === 'completed', { label: 'sender completed' });
        await waitFor(() => lastUpdateFor(eventsB, id)?.status === 'completed', { label: 'receiver completed' });

        const receiverUpdate = lastUpdateFor(eventsB, id);
        expect(receiverUpdate.verified).toBe(true);
        expect(receiverUpdate.progress).toBe(100);
        expect(engineB.downloadUrls.has(id)).toBe(true);

        expect(engineA.sessions.get('bob')?.channelReady).toBe(true);
        expect(engineB.sessions.get('alice')?.channelReady).toBe(true);

        engineA.destroy();
        engineB.destroy();
    });

    it('transfers two files concurrently without corrupting either', async () => {
        const { engineA, engineB, eventsA, eventsB } = createEnginePair();
        const file1 = createMockFile('alpha.bin', 64 * 1024, 'application/octet-stream', 1);
        const file2 = createMockFile('beta.bin', 96 * 1024, 'application/octet-stream', 2);

        engineA.offerFiles('bob', [file1, file2]);

        const items = await waitFor(
            () => eventsB.find((event) => event.type === 'history:add')?.items?.length >= 2
                ? eventsB.find((event) => event.type === 'history:add').items
                : null,
            { label: 'two offered items' }
        );
        const [id1, id2] = items.map((item) => item.id);

        // Request both immediately — the old engine corrupted data here.
        await engineB.requestFile(id1);
        await engineB.requestFile(id2);

        await waitFor(() => lastUpdateFor(eventsA, id1)?.status === 'completed', { label: 'file1 sent' });
        await waitFor(() => lastUpdateFor(eventsA, id2)?.status === 'completed', { label: 'file2 sent' });
        await waitFor(() => lastUpdateFor(eventsB, id1)?.status === 'completed', { label: 'file1 received' });
        await waitFor(() => lastUpdateFor(eventsB, id2)?.status === 'completed', { label: 'file2 received' });

        expect(lastUpdateFor(eventsB, id1)?.verified).toBe(true);
        expect(lastUpdateFor(eventsB, id2)?.verified).toBe(true);

        engineA.destroy();
        engineB.destroy();
    });

    it('delivers chat messages over the control channel in both directions', async () => {
        const { engineA, engineB, eventsA, eventsB } = createEnginePair();

        // Chatting auto-connects the peer session.
        engineA.sendChat('bob', 'hello from alice');

        await waitFor(() => engineB.sessions.get('alice')?.channelReady, { label: 'B session ready' });

        const received = await waitFor(
            () => eventsB.find((event) => event.type === 'chat') || null,
            { label: 'chat event at B' }
        );
        expect(received.message.text).toBe('hello from alice');
        expect(received.peerId).toBe('alice');

        engineB.sendChat('alice', 'hi alice!');
        const receivedAtA = await waitFor(
            () => eventsA.find((event) => event.type === 'chat') || null,
            { label: 'chat event at A' }
        );
        expect(receivedAtA.message.text).toBe('hi alice!');

        engineA.destroy();
        engineB.destroy();
    });

    it('cancels a transfer from the receiver side and stops the sender', async () => {
        const { engineA, engineB, eventsA, eventsB } = createEnginePair();
        const file = createMockFile('cancel-me.bin', 4 * 1024 * 1024);

        const id = await offerAndRequestId(engineA, eventsB, file);
        await engineB.requestFile(id);
        engineB.cancelTransfer(id);

        await waitFor(() => lastUpdateFor(eventsA, id)?.status === 'cancelled', { label: 'sender cancelled' });
        await waitFor(() => lastUpdateFor(eventsB, id)?.status === 'cancelled', { label: 'receiver cancelled' });

        expect(engineA.outgoing.has(id)).toBe(false);
        expect(engineB.receives.has(id)).toBe(false);

        engineA.destroy();
        engineB.destroy();
    });

    it('marks in-flight transfers as errors when the peer session tears down', async () => {
        const { engineA, engineB, eventsA, eventsB } = createEnginePair();
        const file = createMockFile('big.bin', 8 * 1024 * 1024);

        const id = await offerAndRequestId(engineA, eventsB, file);
        await engineB.requestFile(id);

        await waitFor(() => lastUpdateFor(eventsA, id)?.status === 'uploading', { label: 'uploading' });

        // Hard teardown on the sender (simulates the tab closing).
        const session = engineA.sessions.get('bob');
        engineA.teardownSession(session, 'Connection lost during transfer.');

        await waitFor(() => lastUpdateFor(eventsA, id)?.status === 'error', { label: 'sender error' });
        expect(lastUpdateFor(eventsA, id)?.error).toBe('Connection lost during transfer.');
        expect(engineA.sessions.has('bob')).toBe(false);

        engineA.destroy();
        engineB.destroy();
    });

    it('handles glare: both peers connect at once and still exchange a file', async () => {
        const { engineA, engineB, eventsA, eventsB } = createEnginePair();

        engineA.sendChat('bob', 'ping');
        engineB.sendChat('alice', 'pong');

        await waitFor(() => engineA.sessions.get('bob')?.channelReady, { label: 'A ready' });
        await waitFor(() => engineB.sessions.get('alice')?.channelReady, { label: 'B ready' });

        const file = createMockFile('after-glare.bin', 32 * 1024);
        const id = await offerAndRequestId(engineA, eventsB, file);

        await engineB.requestFile(id);
        await waitFor(() => lastUpdateFor(eventsA, id)?.status === 'completed', { label: 'sent' });
        await waitFor(() => lastUpdateFor(eventsB, id)?.status === 'completed', { label: 'received' });
        expect(lastUpdateFor(eventsB, id)?.verified).toBe(true);

        engineA.destroy();
        engineB.destroy();
    });

    it('keeps existing sessions alive while connecting to a second peer', async () => {
        const { bus, engineA, engineB, eventsA, eventsB } = createEnginePair();

        const file1 = createMockFile('to-bob.bin', 16 * 1024);
        const id1 = await offerAndRequestId(engineA, eventsB, file1);
        await engineB.requestFile(id1);
        await waitFor(() => lastUpdateFor(eventsA, id1)?.status === 'completed', { label: 'sent to bob' });
        expect(engineA.sessions.get('bob')?.channelReady).toBe(true);

        const eventsC = [];
        const socketC = new MockSocket('carol', bus);
        const engineC = new TransferEngine({
            socket: socketC,
            myId: 'carol',
            getPeerName: () => 'Alice',
            onEvent: (event) => eventsC.push(event)
        });

        const file2 = createMockFile('to-carol.bin', 16 * 1024);
        engineA.offerFiles('carol', [file2]);

        const id2 = await waitFor(() => firstAddedItem(eventsC)?.id, { label: 'carol item' });
        await engineC.requestFile(id2);
        await waitFor(() => lastUpdateFor(eventsA, id2)?.status === 'completed', { label: 'sent to carol' });
        await waitFor(() => lastUpdateFor(eventsC, id2)?.status === 'completed', { label: 'carol received' });

        expect(engineA.sessions.get('bob')?.channelReady).toBe(true);
        expect(engineA.sessions.get('carol')?.channelReady).toBe(true);

        engineA.destroy();
        engineB.destroy();
        engineC.destroy();
    });
});
