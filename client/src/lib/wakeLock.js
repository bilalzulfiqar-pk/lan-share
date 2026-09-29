// Screen Wake Lock Manager: keeps the display awake during active transfers
// to prevent mobile OS tab throttling and screen timeout sleep.

export class WakeLockManager {
    constructor() {
        this.sentinel = null;
        this.activeCount = 0;
        this.requesting = false;
        this.boundVisibilityHandler = this.handleVisibilityChange.bind(this);

        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', this.boundVisibilityHandler);
        }
    }

    async acquire() {
        this.activeCount += 1;
        if (!this.sentinel && !this.requesting) {
            await this.requestLock();
        }
    }

    async release() {
        this.activeCount = Math.max(0, this.activeCount - 1);
        if (this.activeCount === 0 && this.sentinel) {
            try {
                await this.sentinel.release();
            } catch {
                // ignore if already released
            }
            this.sentinel = null;
        }
    }

    async requestLock() {
        if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) {
            return false;
        }
        if (this.activeCount <= 0) {
            return false;
        }
        if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
            return false;
        }

        this.requesting = true;
        try {
            const sentinel = await navigator.wakeLock.request('screen');
            this.sentinel = sentinel;
            sentinel.addEventListener('release', () => {
                if (this.sentinel === sentinel) {
                    this.sentinel = null;
                }
            });
            return true;
        } catch (err) {
            console.warn('[wakeLock] Failed to acquire screen wake lock:', err);
            return false;
        } finally {
            this.requesting = false;
        }
    }

    handleVisibilityChange() {
        if (typeof document !== 'undefined' && document.visibilityState === 'visible' && this.activeCount > 0 && !this.sentinel) {
            this.requestLock().catch(() => {});
        }
    }

    destroy() {
        if (typeof document !== 'undefined') {
            document.removeEventListener('visibilitychange', this.boundVisibilityHandler);
        }
        if (this.sentinel) {
            this.sentinel.release().catch(() => {});
            this.sentinel = null;
        }
        this.activeCount = 0;
    }
}

export const wakeLockManager = new WakeLockManager();

export function acquireWakeLock() {
    return wakeLockManager.acquire();
}

export function releaseWakeLock() {
    return wakeLockManager.release();
}
