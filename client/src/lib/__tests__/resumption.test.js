import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TransferEngine } from '../transferEngine';
import { createFileRequest, parseFileRequest, MSG, FILE_STATUS } from '../protocol';
import {
    installMockWebRTC,
    MockSocket,
    createSocketBus,
    createMockFile,
    waitFor
} from './harness';

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
        ...options
    });

    const engineB = new TransferEngine({
        socket: socketB,
        myId: 'bob',
        getPeerName: () => 'Alice',
        onEvent: (event) => eventsB.push(event),
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

describe('Resumable Chunk Offsets on Network Hiccups', () => {
    beforeEach(() => {
        installMockWebRTC();
        globalThis.URL.createObjectURL = globalThis.URL.createObjectURL || (() => `blob:mock-resumption-${Math.random()}`);
        globalThis.URL.revokeObjectURL = globalThis.URL.revokeObjectURL || (() => {});
    });

    afterEach(() => {
        delete globalThis.RTCPeerConnection;
    });

    it('createFileRequest and parseFileRequest format and validate fromOffset accurately', () => {
        const req0 = createFileRequest('f1');
        expect(req0).toEqual({ type: MSG.FILE_REQUEST, fileId: 'f1', fromOffset: 0 });

        const reqOffset = createFileRequest('f2', 1048576);
        expect(reqOffset).toEqual({ type: MSG.FILE_REQUEST, fileId: 'f2', fromOffset: 1048576 });

        const parsed = parseFileRequest(reqOffset);
        expect(parsed).toEqual({ fileId: 'f2', fromOffset: 1048576 });

        expect(parseFileRequest({ type: 'OTHER' })).toBeNull();
        expect(parseFileRequest(null)).toBeNull();
    });

    it('sender starts upload from offset and maintains accurate overall progress and SHA-256 integrity', async () => {
        const { engineA, engineB, eventsA, eventsB } = createEnginePair();
        const file = createMockFile('large-dataset.bin', 256 * 1024); // 256 KiB = 4 chunks of 64 KiB

        const id = await offerAndRequestId(engineA, eventsB, file);

        // Receiver requests file
        await engineB.requestFile(id);

        // Wait until receiver gets partial data (at least 1 chunk)
        const receiveState = await waitFor(() => {
            const state = engineB.receives.get(id);
            return (state && state.received >= 64 * 1024) ? state : null;
        }, { label: 'partial receive' });

        const receivedBeforeBlip = receiveState.received;
        expect(receivedBeforeBlip).toBeGreaterThanOrEqual(64 * 1024);
        expect(receivedBeforeBlip).toBeLessThan(256 * 1024);

        // Simulate Wi-Fi blip by closing the file data channel on sender
        const outgoingEntry = engineA.outgoing.get(id);
        expect(outgoingEntry.channel).toBeDefined();
        outgoingEntry.channel.close();

        // Check that receive state preserved partial bytes and hasher state
        expect(receiveState.received).toBe(receivedBeforeBlip);
        expect(receiveState.buffers.length).toBeGreaterThan(0);

        // Receiver resumes active receives during grace period
        const sessionB = engineB.sessions.get('alice');
        engineB.resumeActiveReceivesForSession(sessionB);

        // Sender should receive resumption request with fromOffset and continue streaming
        await waitFor(() => lastUpdateFor(eventsA, id)?.status === 'completed', { label: 'sender completed' });
        await waitFor(() => lastUpdateFor(eventsB, id)?.status === 'completed', { label: 'receiver completed' });

        const senderFinal = lastUpdateFor(eventsA, id);
        const receiverFinal = lastUpdateFor(eventsB, id);
        expect(senderFinal.progress).toBe(100);
        expect(receiverFinal.progress).toBe(100);
        expect(receiverFinal.verified).toBe(true);

        engineA.destroy();
        engineB.destroy();
    });


    it('receiver transitions to failed after 2 recovery attempts fail, allowing restart from scratch', async () => {
        const { engineA, engineB, eventsB } = createEnginePair();
        const file = createMockFile('doc-multi-retry.pdf', 128 * 1024);

        const id = await offerAndRequestId(engineA, eventsB, file);
        await engineB.requestFile(id);

        const sessionB = engineB.sessions.get('alice');
        const receiveState = engineB.receives.get(id);

        // Attempt 1: retryCount becomes 1
        engineB.resumeActiveReceivesForSession(sessionB);
        expect(receiveState.retryCount).toBe(1);

        // Attempt 2: retryCount becomes 2
        engineB.resumeActiveReceivesForSession(sessionB);
        expect(receiveState.retryCount).toBe(2);

        // Attempt 3: exceeds max attempts, transitions to failed
        engineB.resumeActiveReceivesForSession(sessionB);
        expect(lastUpdateFor(eventsB, id)?.status).toBe(FILE_STATUS.FAILED);
        expect(engineB.receives.has(id)).toBe(false);

        // Sender retains file in outgoing so user never has to re-pick the file
        expect(engineA.outgoing.has(id)).toBe(true);

        // Receiver clicks "Restart Transfer": requests file from beginning (offset 0)
        await engineB.requestFile(id);
        expect(engineB.receives.has(id)).toBe(true);

        await waitFor(() => lastUpdateFor(eventsB, id)?.status === 'completed', { label: 'restarted completed' });
        expect(lastUpdateFor(eventsB, id)?.verified).toBe(true);

        engineA.destroy();
        engineB.destroy();
    });

});
