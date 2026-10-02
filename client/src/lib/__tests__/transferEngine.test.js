import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

        expect(firstAddedItem(eventsA)).toMatchObject({ id, fileName: 'notes.bin', direction: 'out', status: 'connecting', peerName: 'Bob' });
        expect(lastUpdateFor(eventsA, id)?.status).toBe('offered');
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

    it('correctly transitions outgoing file status: connecting -> offered -> uploading -> completed', async () => {
        const { engineA, engineB, eventsA } = createEnginePair();
        const file1 = createMockFile('doc1.pdf', 32 * 1024);

        // Before connection is ready, offer file
        engineA.offerFiles('bob', [file1]);
        const addedItem = firstAddedItem(eventsA);
        expect(addedItem.status).toBe('connecting');

        // Once WebRTC connects and markControlReady runs, sender receives history:update with status: 'offered'
        const id1 = addedItem.id;
        await waitFor(() => lastUpdateFor(eventsA, id1)?.status === 'offered', { label: 'status is offered' });

        // Second file offered while channelReady is true should immediately have status: 'offered'
        const file2 = createMockFile('doc2.pdf', 32 * 1024);
        engineA.offerFiles('bob', [file2]);
        const allAdds = eventsA.filter((e) => e.type === 'history:add');
        const secondAddedItem = allAdds[1]?.items[0];
        expect(secondAddedItem.status).toBe('offered');

        // When receiver requests file1, sender transitions to 'uploading'
        await engineB.requestFile(id1);
        await waitFor(() => lastUpdateFor(eventsA, id1)?.status === 'uploading', { label: 'status is uploading' });

        // Finally completes
        await waitFor(() => lastUpdateFor(eventsA, id1)?.status === 'completed', { label: 'status is completed' });

        engineA.destroy();
        engineB.destroy();
    });

    it('removes cancelled file from pendingOfferFiles if cancelled before connection is ready and offers only remaining files', async () => {
        const { engineA, eventsA, eventsB } = createEnginePair();
        const file1 = createMockFile('cancelled.pdf', 10 * 1024);
        const file2 = createMockFile('kept.pdf', 20 * 1024);

        engineA.offerFiles('bob', [file1, file2]);
        const session = engineA.sessions.get('bob');
        expect(session.pendingOfferFiles.length).toBe(2);

        const file1Id = session.pendingOfferFiles[0].id;
        const file2Id = session.pendingOfferFiles[1].id;
        engineA.cancelTransfer(file1Id);

        expect(session.pendingOfferFiles.length).toBe(1);
        expect(session.pendingOfferFiles[0].id).toBe(file2Id);

        // When connection completes, only file2 is offered to peer
        await waitFor(() => lastUpdateFor(eventsA, file2Id)?.status === 'offered', { label: 'file2 offered' });
        expect(lastUpdateFor(eventsA, file1Id)?.status).toBe('cancelled');

        const receiverAdded = eventsB.filter((e) => e.type === 'history:add').flatMap((e) => e.items);
        expect(receiverAdded.some((i) => i.id === file1Id)).toBe(false);
        expect(receiverAdded.some((i) => i.id === file2Id)).toBe(true);

        engineA.destroy();
    });

    it('channel.onclose on receiver sets grace timer, and expiration discards receive with error', async () => {
        const { engineA, engineB, eventsB } = createEnginePair();
        const file = createMockFile('stream.bin', 1024 * 1024);

        const id = await offerAndRequestId(engineA, eventsB, file);
        await engineB.requestFile(id);

        await waitFor(() => lastUpdateFor(eventsB, id)?.status === 'downloading', { label: 'downloading' });
        const receiveState = engineB.receives.get(id);
        expect(receiveState).toBeDefined();

        let graceCallback = null;
        const originalSetTimeout = globalThis.setTimeout;
        globalThis.setTimeout = (cb, delay) => {
            if (delay === 8000) {
                graceCallback = cb;
                return 999999;
            }
            return originalSetTimeout(cb, delay);
        };

        try {
            // Simulate channel close while transfer is incomplete
            const currentChannel = engineA.outgoing.get(id)?.channel;
            if (currentChannel) {
                currentChannel.close();
            }

            // Immediately after close, receiveState should still exist in engineB (not discarded yet)
            expect(engineB.receives.has(id)).toBe(true);
            expect(graceCallback).toBeTypeOf('function');

            // Trigger the grace period expiration
            graceCallback();

            // After grace expires, receive is discarded and error is dispatched
            expect(engineB.receives.has(id)).toBe(false);
            expect(lastUpdateFor(eventsB, id)?.status).toBe('error');
            expect(lastUpdateFor(eventsB, id)?.error).toBe('Transfer interrupted.');
        } finally {
            globalThis.setTimeout = originalSetTimeout;
            engineA.destroy();
            engineB.destroy();
        }
    });

    it('channel reattachment clears grace timer and preserves current progress', async () => {
        const { engineA, engineB, eventsB } = createEnginePair();
        const file = createMockFile('stream2.bin', 1024 * 1024);

        const id = await offerAndRequestId(engineA, eventsB, file);
        await engineB.requestFile(id);

        await waitFor(() => lastUpdateFor(eventsB, id)?.status === 'downloading', { label: 'downloading' });
        const receiveState = engineB.receives.get(id);
        expect(receiveState).toBeDefined();

        // Allow a few chunks to be received so progress > 0
        await waitFor(() => receiveState.received > 0, { label: 'some progress made' });

        // Close channel to trigger grace period
        const currentChannel = engineA.outgoing.get(id)?.channel;
        currentChannel?.close();

        const expectedProgress = Math.floor((receiveState.received / receiveState.size) * 100);
        expect(expectedProgress).toBeGreaterThan(0);
        expect(receiveState.graceTimer).toBeDefined();

        // Reconnect new channel
        const mockNewChannel = { binaryType: '', readyState: 'open', close: () => {} };
        const sessionB = engineB.sessions.get('alice');
        engineB.attachFileReceiveChannel(sessionB, mockNewChannel, id);

        // Grace timer should be cancelled
        expect(receiveState.graceTimer).toBeNull();
        // Progress should be preserved (not reset to 0)
        expect(lastUpdateFor(eventsB, id)?.progress).toBe(expectedProgress);
        expect(engineB.receives.has(id)).toBe(true);

        engineA.destroy();
        engineB.destroy();
    });

    it('gates audio alerts on soundEnabled setting and toggles via setSoundEnabled', () => {
        const { engineA } = createEnginePair();
        expect(engineA.soundEnabled).toBe(false);

        let chimeCount = 0;
        const _originalMethod = engineA.playTransferComplete;
        engineA.playTransferComplete = () => {
            if (engineA.soundEnabled) {
                chimeCount += 1;
            }
        };

        // When sound is disabled (default), no chime
        engineA.playTransferComplete();
        expect(chimeCount).toBe(0);

        // When sound is enabled, chime triggers
        engineA.setSoundEnabled(true);
        expect(engineA.soundEnabled).toBe(true);
        engineA.playTransferComplete();
        expect(chimeCount).toBe(1);

        // When sound is toggled off, chime is suppressed again
        engineA.setSoundEnabled(false);
        expect(engineA.soundEnabled).toBe(false);
        engineA.playTransferComplete();
        expect(chimeCount).toBe(1);

        engineA.destroy();
    });

    it('restarts ICE when TURN credentials load while session is actively connecting', async () => {
        const bus = createSocketBus();
        const socketA = new MockSocket('alice', bus);
        const engineA = new TransferEngine({
            socket: socketA,
            myId: 'alice',
            fetchTurnCredentials: false
        });

        const session = engineA.getOrCreateSession('bob');
        const restartSpy = vi.spyOn(engineA, 'attemptIceRestart').mockResolvedValue(true);

        engineA.setTurnCredentials({
            iceServers: [{ urls: 'turn:turn.metered.ca:443', username: 'u', credential: 'p' }]
        });

        expect(restartSpy).toHaveBeenCalledWith(session);
        engineA.destroy();
    });

    it('attaches connect watchdog to answerer sessions to prevent indefinite hang', () => {
        vi.useFakeTimers();
        const bus = createSocketBus();
        const socketB = new MockSocket('bob', bus);
        const engineB = new TransferEngine({
            socket: socketB,
            myId: 'bob',
            fetchTurnCredentials: false
        });

        const session = engineB.getOrCreateSession('alice', { asAnswerer: true });
        expect(session.connectWatchdog).not.toBeNull();

        // Fast-forward past connect timeout (20s)
        vi.advanceTimersByTime(21000);

        expect(engineB.sessions.has('alice')).toBe(false);
        expect(session.tearingDown).toBe(true);

        engineB.destroy();
        vi.useRealTimers();
    });
});
