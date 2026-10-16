import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TransferEngine, sweepOrphanedOpfsFiles } from '../transferEngine';
import { canOpfsSave } from '../protocol';
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

describe('OPFS Direct-to-Disk Sink', () => {
    let mockOpfsFiles;
    let mockWrittenChunks;
    let mockRoot;

    beforeEach(() => {
        installMockWebRTC();
        mockOpfsFiles = new Map();
        mockWrittenChunks = [];

        mockRoot = {
            getFileHandle: vi.fn(async (name, { create = false } = {}) => {
                let fileEntry = mockOpfsFiles.get(name);
                if (!fileEntry && create) {
                    fileEntry = {
                        name,
                        data: [],
                        getFile: vi.fn(async () => {
                            const blob = new Blob(fileEntry.data, { type: 'application/octet-stream' });
                            return new File([blob], name, { type: 'application/octet-stream' });
                        }),
                        createWritable: vi.fn(async () => {
                            return {
                                write: vi.fn(async (chunk) => {
                                    fileEntry.data.push(chunk);
                                    mockWrittenChunks.push(chunk);
                                }),
                                close: vi.fn(async () => {}),
                                abort: vi.fn(async () => {})
                            };
                        })
                    };
                    mockOpfsFiles.set(name, fileEntry);
                }
                return fileEntry;
            }),
            removeEntry: vi.fn(async (name) => {
                mockOpfsFiles.delete(name);
            })
        };

        Object.defineProperty(globalThis.navigator, 'storage', {
            value: {
                getDirectory: vi.fn(async () => mockRoot)
            },
            configurable: true,
            writable: true
        });

        globalThis.URL.createObjectURL = globalThis.URL.createObjectURL || (() => `blob:mock-opfs-${Math.random()}`);
        globalThis.URL.revokeObjectURL = globalThis.URL.revokeObjectURL || (() => {});
        delete globalThis.window?.showSaveFilePicker;
    });

    afterEach(() => {
        delete globalThis.RTCPeerConnection;
        try {
            delete globalThis.navigator.storage;
            delete globalThis.navigator.share;
            delete globalThis.navigator.canShare;
            delete globalThis.window?.showSaveFilePicker;
        } catch {
            // ignore
        }
    });

    it('accurately detects OPFS support via canOpfsSave()', () => {
        expect(canOpfsSave()).toBe(true);

        const savedStorage = globalThis.navigator.storage;
        delete globalThis.navigator.storage;
        expect(canOpfsSave()).toBe(false);
        globalThis.navigator.storage = savedStorage;
    });

    it('streams incoming chunks directly to disk via OPFS, keeping buffers in RAM empty', async () => {
        const { engineA, engineB, eventsB } = createEnginePair();
        const file = createMockFile('mobile-download.bin', 128 * 1024);

        const id = await offerAndRequestId(engineA, eventsB, file);
        await engineB.requestFile(id);

        const receiveState = engineB.receives.get(id);
        expect(receiveState.mode).toBe('opfs');
        expect(receiveState.opfsFileHandle).toBeDefined();

        await waitFor(() => lastUpdateFor(eventsB, id)?.status === 'completed', { label: 'receiver completed' });

        // OPFS chunks should have been written to disk stream
        expect(mockWrittenChunks.length).toBeGreaterThan(0);
        // buffers array in memory should stay empty!
        expect(receiveState.buffers.length).toBe(0);

        const receiverUpdate = lastUpdateFor(eventsB, id);
        expect(receiverUpdate.verified).toBe(true);
        expect(receiverUpdate.saved).toBe(true);

        engineA.destroy();
        engineB.destroy();
    });

    it('triggers navigator.share on mobile when canShare is supported', async () => {
        const shareSpy = vi.fn(async () => {});
        const canShareSpy = vi.fn(() => true);

        Object.defineProperty(globalThis.navigator, 'share', {
            value: shareSpy,
            configurable: true,
            writable: true
        });
        Object.defineProperty(globalThis.navigator, 'canShare', {
            value: canShareSpy,
            configurable: true,
            writable: true
        });
        Object.defineProperty(globalThis.navigator, 'userAgent', {
            value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
            configurable: true,
            writable: true
        });

        const { engineA, engineB, eventsB } = createEnginePair();
        const file = createMockFile('photo-mobile.jpg', 64 * 1024, 'image/jpeg');

        const id = await offerAndRequestId(engineA, eventsB, file);
        await engineB.requestFile(id);

        await waitFor(() => lastUpdateFor(eventsB, id)?.status === 'completed', { label: 'receiver completed' });

        expect(canShareSpy).toHaveBeenCalled();
        expect(shareSpy).toHaveBeenCalled();
        const lastUpdate = lastUpdateFor(eventsB, id);
        expect(lastUpdate.saved).toBe(true);
        expect(mockRoot.removeEntry).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`^transfer-${id}(-\\d+)?\\.tmp$`)));

        engineA.destroy();
        engineB.destroy();
    });

    it('falls back gracefully to memory mode with warning when OPFS is unsupported and file > 500 MB', async () => {
        delete globalThis.navigator.storage;
        delete globalThis.window?.showSaveFilePicker;

        const { engineA, engineB, eventsB } = createEnginePair();
        const largeFile = createMockFile('massive.iso', 600 * 1024 * 1024);

        const id = await offerAndRequestId(engineA, eventsB, largeFile);
        await engineB.requestFile(id);

        const errorEvents = eventsB.filter((e) => e.type === 'error');
        expect(errorEvents.some((e) => e.message.includes('Storing files over 500 MB in RAM may crash this tab'))).toBe(true);

        const receiveState = engineB.receives.get(id);
        expect(receiveState.mode).toBe('memory');

        engineA.destroy();
        engineB.destroy();
    });

    it('prefers window.showSaveFilePicker when available for files > 512 MB and uses memory mode for smaller files on desktop', async () => {
        const mockWritable = {
            write: vi.fn(async () => {}),
            close: vi.fn(async () => {}),
            abort: vi.fn(async () => {})
        };
        const mockFileHandle = {
            createWritable: vi.fn(async () => mockWritable)
        };
        globalThis.window = globalThis.window || {};
        globalThis.window.showSaveFilePicker = vi.fn(async () => mockFileHandle);

        // 1. Small file (10 MB): desktop Chrome uses fast memory mode, not OPFS
        const pair1 = createEnginePair({ fetchTurnCredentials: false });
        const smallFile = createMockFile('small.bin', 10 * 1024 * 1024);
        const smallId = await offerAndRequestId(pair1.engineA, pair1.eventsB, smallFile);
        await pair1.engineB.requestFile(smallId);

        const smallState = pair1.engineB.receives.get(smallId);
        expect(smallState.mode).toBe('memory');
        expect(globalThis.window.showSaveFilePicker).not.toHaveBeenCalled();
        expect(mockRoot.getFileHandle).not.toHaveBeenCalled();
        pair1.engineA.destroy();
        pair1.engineB.destroy();

        // 2. Large file (600 MB): desktop Chrome triggers showSaveFilePicker (fs-access)
        const pair2 = createEnginePair({ fetchTurnCredentials: false });
        const largeFile = createMockFile('large.bin', 600 * 1024 * 1024);
        const largeId = await offerAndRequestId(pair2.engineA, pair2.eventsB, largeFile);
        await pair2.engineB.requestFile(largeId);

        const largeState = pair2.engineB.receives.get(largeId);
        expect(largeState.mode).toBe('fs-access');
        expect(globalThis.window.showSaveFilePicker).toHaveBeenCalledWith({ suggestedName: 'large.bin' });

        delete globalThis.window.showSaveFilePicker;
        pair2.engineA.destroy();
        pair2.engineB.destroy();
    });

    it('handles OPFS QuotaExceededError on init and falls back gracefully to memory mode (TEST-01)', async () => {
        const quotaError = new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        mockRoot.getFileHandle.mockRejectedValueOnce(quotaError);

        const { engineA, engineB, eventsB } = createEnginePair();
        const file = createMockFile('quota-test.dat', 100 * 1024);

        const id = await offerAndRequestId(engineA, eventsB, file);
        await engineB.requestFile(id);

        const state = engineB.receives.get(id);
        // Seamlessly falls back to memory mode
        expect(state.mode).toBe('memory');

        await waitFor(() => lastUpdateFor(eventsB, id)?.status === 'completed', { label: 'completed in memory fallback' });
        const final = lastUpdateFor(eventsB, id);
        expect(final.status).toBe('completed');
        expect(final.verified).toBe(true);

        engineA.destroy();
        engineB.destroy();
    });

    it('sweepOrphanedOpfsFiles correctly recognizes timestamped attempt files and preserves active transfers (CORE-BUG-03)', async () => {
        mockRoot.values = vi.fn(async function* () {
            yield { kind: 'file', name: 'transfer-active1-1729000000000.tmp' };
            yield { kind: 'file', name: 'transfer-orphan2-1729000000000.tmp' };
            yield { kind: 'file', name: 'transfer-legacy.tmp' };
        });

        // active1 is currently downloading
        const activeIds = new Set(['active1']);
        await sweepOrphanedOpfsFiles(activeIds);

        // active1 must NOT be removed
        expect(mockRoot.removeEntry).not.toHaveBeenCalledWith('transfer-active1-1729000000000.tmp');
        // orphan2 and legacy must be removed
        expect(mockRoot.removeEntry).toHaveBeenCalledWith('transfer-orphan2-1729000000000.tmp');
        expect(mockRoot.removeEntry).toHaveBeenCalledWith('transfer-legacy.tmp');
    });

    it('cancels sender and marks transfer failed if disk write fails mid-stream (CORE-BUG-04, R3-ENH-02)', async () => {
        const { engineA, engineB, eventsA, eventsB } = createEnginePair();
        const file = createMockFile('midwrite-fail.dat', 2 * 1024 * 1024);

        const id = await offerAndRequestId(engineA, eventsB, file);

        // Make the writable fail on write
        const originalGetFileHandle = mockRoot.getFileHandle;
        mockRoot.getFileHandle = vi.fn(async (name, opts) => {
            const handle = await originalGetFileHandle(name, opts);
            handle.createWritable = vi.fn(async () => ({
                write: vi.fn(async () => {
                    throw new Error('Disk quota exceeded mid-stream');
                }),
                close: vi.fn(async () => {}),
                abort: vi.fn(async () => {})
            }));
            return handle;
        });

        await engineB.requestFile(id);

        await waitFor(() => lastUpdateFor(eventsB, id)?.status === 'failed', { label: 'receiver marks failed' });
        const receiverFinal = lastUpdateFor(eventsB, id);
        expect(receiverFinal.status).toBe('failed');
        expect(receiverFinal.error).toContain('Could not write to disk');

        // Sender should receive cancel notification and mark cancelled
        await waitFor(() => lastUpdateFor(eventsA, id)?.status === 'cancelled', { label: 'sender cancelled' });
        const senderFinal = lastUpdateFor(eventsA, id);
        expect(senderFinal.status).toBe('cancelled');

        engineA.destroy();
        engineB.destroy();
    });
});

