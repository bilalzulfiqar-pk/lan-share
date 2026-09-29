import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WakeLockManager } from '../wakeLock';

describe('WakeLockManager', () => {
    let mockSentinel;
    let mockWakeLock;

    beforeEach(() => {
        mockSentinel = {
            released: false,
            release: vi.fn(async () => {
                mockSentinel.released = true;
            }),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn()
        };

        mockWakeLock = {
            request: vi.fn(async (type) => {
                if (type === 'screen') {
                    return mockSentinel;
                }
                throw new Error('Unsupported type');
            })
        };

        Object.defineProperty(globalThis.navigator, 'wakeLock', {
            value: mockWakeLock,
            configurable: true,
            writable: true
        });

        if (typeof globalThis.document === 'undefined') {
            globalThis.document = {
                visibilityState: 'visible',
                addEventListener: vi.fn(),
                removeEventListener: vi.fn()
            };
        } else {
            globalThis.document.visibilityState = 'visible';
        }
    });

    afterEach(() => {
        try {
            delete globalThis.navigator.wakeLock;
        } catch {
            // ignore
        }
    });

    it('requests screen wake lock when acquire() is called', async () => {
        const manager = new WakeLockManager();
        await manager.acquire();

        expect(mockWakeLock.request).toHaveBeenCalledWith('screen');
        expect(manager.sentinel).toBe(mockSentinel);
        expect(manager.activeCount).toBe(1);

        manager.destroy();
    });

    it('handles multiple active transfers with reference counting and releases on 0', async () => {
        const manager = new WakeLockManager();

        await manager.acquire();
        await manager.acquire();
        expect(manager.activeCount).toBe(2);
        expect(mockWakeLock.request).toHaveBeenCalledTimes(1);

        // First release: activeCount is 1, sentinel is still held
        await manager.release();
        expect(manager.activeCount).toBe(1);
        expect(mockSentinel.release).not.toHaveBeenCalled();

        // Second release: activeCount is 0, sentinel is released
        await manager.release();
        expect(manager.activeCount).toBe(0);
        expect(mockSentinel.release).toHaveBeenCalledTimes(1);
        expect(manager.sentinel).toBeNull();

        manager.destroy();
    });

    it('re-acquires wake lock on visibilitychange when tab becomes visible and transfers are active', async () => {
        let visibilityCallback = null;
        const originalAddEventListener = globalThis.document.addEventListener;
        globalThis.document.addEventListener = vi.fn((event, handler) => {
            if (event === 'visibilitychange') {
                visibilityCallback = handler;
            }
        });

        const manager = new WakeLockManager();
        await manager.acquire();
        expect(mockWakeLock.request).toHaveBeenCalledTimes(1);

        // Simulate sentinel released when tab went hidden
        manager.sentinel = null;
        globalThis.document.visibilityState = 'visible';

        // Trigger visibilitychange
        expect(visibilityCallback).toBeTypeOf('function');
        visibilityCallback();

        expect(mockWakeLock.request).toHaveBeenCalledTimes(2);
        manager.destroy();
        globalThis.document.addEventListener = originalAddEventListener;
    });

    it('gracefully handles unsupported wakeLock API without throwing', async () => {
        delete globalThis.navigator.wakeLock;

        const manager = new WakeLockManager();
        await expect(manager.acquire()).resolves.not.toThrow();
        expect(manager.sentinel).toBeNull();
        await expect(manager.release()).resolves.not.toThrow();

        manager.destroy();
    });
});
