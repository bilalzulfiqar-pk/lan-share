import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TransferEngine } from '../transferEngine';
import { MSG, FILE_STATUS } from '../protocol';
import {
    installMockWebRTC,
    MockSocket,
    createSocketBus,
    createMockFile,
    waitFor
} from './harness.mjs';

function createEnginePair(options = {}) {
    const bus = createSocketBus();
    const socketA = new MockSocket('alice', bus);
    const socketB = new MockSocket('bob', bus);

    const eventsA = [];
    const eventsB = [];

    const engineA = new TransferEngine({
        socket: socketA,
        myId: 'alice',
        getPeerName: () => 'Bob',
        onEvent: (event) => eventsA.push(event),
        fetchTurnCredentials: false,
        ...options
    });

    const engineB = new TransferEngine({
        socket: socketB,
        myId: 'bob',
        getPeerName: () => 'Alice',
        onEvent: (event) => eventsB.push(event),
        fetchTurnCredentials: false,
        ...options
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

describe('Resumption Integrity & Verification (TEST-06)', () => {
    beforeEach(() => {
        installMockWebRTC();
        globalThis.URL.createObjectURL = globalThis.URL.createObjectURL || (() => `blob:mock-resump-${Math.random()}`);
        globalThis.URL.revokeObjectURL = globalThis.URL.revokeObjectURL || (() => {});
    });

    afterEach(() => {
        delete globalThis.RTCPeerConnection;
    });

    it('reconstructs file bit-for-bit after 50% DataChannel drop and verifies SHA-256', async () => {
        const { engineA, engineB, eventsA, eventsB } = createEnginePair();
        // 512 KiB = 8 chunks of 64 KiB
        const fileSize = 512 * 1024;
        const file = createMockFile('video-512k.mp4', fileSize, 'video/mp4', 0x77, 8);

        const id = await offerAndRequestId(engineA, eventsB, file);
        await engineB.requestFile(id);

        // Wait until approximately 50% (at least 256 KiB = 4 chunks) has been received
        const receiveState = await waitFor(() => {
            const state = engineB.receives.get(id);
            return (state && state.received >= 256 * 1024 && state.received < fileSize) ? state : null;
        }, { interval: 2, label: '50% progress' });

        const receivedAtDrop = receiveState.received;
        expect(receivedAtDrop).toBeGreaterThanOrEqual(256 * 1024);
        expect(receivedAtDrop).toBeLessThan(fileSize);

        // Simulate abrupt DataChannel close (e.g. Wi-Fi blip or NAT timeout)
        const outgoingEntry = engineA.outgoing.get(id);
        expect(outgoingEntry.channel).toBeDefined();
        outgoingEntry.channel.close();

        // Verify state retains received bytes and intermediate hasher progress
        expect(receiveState.received).toBe(receivedAtDrop);
        expect(receiveState.buffers.length).toBeGreaterThan(0);

        // Receiver requests resumption from offset
        const sessionB = engineB.sessions.get('alice');
        engineB.resumeActiveReceivesForSession(sessionB);

        // Wait for both sender and receiver to complete transfer
        await waitFor(() => lastUpdateFor(eventsA, id)?.status === 'completed', { label: 'sender completion' });
        await waitFor(() => lastUpdateFor(eventsB, id)?.status === 'completed', { label: 'receiver completion' });

        const receiverFinal = lastUpdateFor(eventsB, id);
        expect(receiverFinal.progress).toBe(100);
        expect(receiverFinal.status).toBe('completed');
        // Critical: End-to-end hash-wasm SHA-256 matches bit-for-bit despite the 50% split!
        expect(receiverFinal.verified).toBe(true);

        engineA.destroy();
        engineB.destroy();
    });

    it('rejects transfer verification if a chunk is corrupted during resumption', async () => {
        const { engineA, engineB, eventsB } = createEnginePair();
        const fileSize = 256 * 1024;
        const file = createMockFile('integrity-test.bin', fileSize, 'application/octet-stream', 0x99, 1);

        const id = await offerAndRequestId(engineA, eventsB, file);
        await engineB.requestFile(id);

        // Wait until at least 1 chunk (64 KiB) is received
        const receiveState = await waitFor(() => {
            const state = engineB.receives.get(id);
            return (state && state.received >= 64 * 1024) ? state : null;
        }, { label: 'initial chunk' });
        expect(receiveState.received).toBeGreaterThanOrEqual(64 * 1024);

        // Drop channel
        const outgoingEntry = engineA.outgoing.get(id);
        outgoingEntry.channel.close();

        // Tamper with the sender's file so resumption transmits corrupted bytes
        const originalSlice = file.slice.bind(file);
        file.slice = (start, end) => {
            const sliced = originalSlice(start, end);
            return {
                arrayBuffer: async () => {
                    const buf = await sliced.arrayBuffer();
                    const view = new Uint8Array(buf.slice(0));
                    // Corrupt first byte of resumed slice
                    if (view.length > 0) view[0] ^= 0xFF;
                    return view.buffer;
                }
            };
        };

        // Resume active receives
        const sessionB = engineB.sessions.get('alice');
        engineB.resumeActiveReceivesForSession(sessionB);

        await waitFor(() => lastUpdateFor(eventsB, id)?.status === 'completed', { label: 'receiver completed' });

        const receiverFinal = lastUpdateFor(eventsB, id);
        expect(receiverFinal.status).toBe('completed');
        // Must fail verification because reconstructed bytes do not match sender's digest
        expect(receiverFinal.verified).toBe(false);

        engineA.destroy();
        engineB.destroy();
    });
});
