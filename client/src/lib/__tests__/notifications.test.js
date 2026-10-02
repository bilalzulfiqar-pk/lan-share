import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    areNotificationsSupported,
    getNotificationPermission,
    requestNotificationPermission,
    showNotification,
    isIosDevice
} from '../notifications';

describe('Notifications Utility', () => {
    const originalWindow = globalThis.window;
    const originalNavigator = globalThis.navigator;
    const originalNotification = globalThis.Notification;

    beforeEach(() => {
        vi.restoreAllMocks();
    });

    afterEach(() => {
        globalThis.window = originalWindow;
        globalThis.navigator = originalNavigator;
        globalThis.Notification = originalNotification;
    });

    it('detects iOS devices based on userAgent or MacIntel touch points', () => {
        // iPhone
        vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', platform: 'iPhone' });
        expect(isIosDevice()).toBe(true);

        // iPadOS with desktop Safari UA
        vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 5 });
        expect(isIosDevice()).toBe(true);

        // Desktop Mac (no touch points)
        vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 0 });
        expect(isIosDevice()).toBe(false);

        // Windows PC
        vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', platform: 'Win32' });
        expect(isIosDevice()).toBe(false);
    });

    it('reports support accurately based on Notification in window', () => {
        vi.stubGlobal('window', { Notification: {} });
        expect(areNotificationsSupported()).toBe(true);

        vi.stubGlobal('window', {});
        expect(areNotificationsSupported()).toBe(false);
    });

    it('returns permission accurately', () => {
        vi.stubGlobal('window', { Notification: { permission: 'granted' } });
        expect(getNotificationPermission()).toBe('granted');

        vi.stubGlobal('window', {});
        expect(getNotificationPermission()).toBe('denied');
    });

    it('requests permission and handles errors gracefully', async () => {
        const requestPermission = vi.fn().mockResolvedValue('granted');
        vi.stubGlobal('window', { Notification: { requestPermission } });
        vi.stubGlobal('Notification', { requestPermission });

        const result = await requestNotificationPermission();
        expect(result).toBe('granted');
        expect(requestPermission).toHaveBeenCalled();

        // Error rejection fallback
        requestPermission.mockRejectedValue(new Error('User dismissed'));
        const fallback = await requestNotificationPermission();
        expect(fallback).toBe('denied');
    });

    it('does not show notification if permission is not granted', async () => {
        vi.stubGlobal('window', { Notification: { permission: 'denied' } });
        vi.stubGlobal('Notification', { permission: 'denied' });

        const result = await showNotification('Test', { body: 'Hello' });
        expect(result).toBe(false);
    });

    it('routes through ServiceWorkerRegistration.showNotification when serviceWorker is available', async () => {
        const mockShowNotification = vi.fn().mockResolvedValue(undefined);
        const mockRegistration = { showNotification: mockShowNotification };

        vi.stubGlobal('window', { Notification: { permission: 'granted' } });
        vi.stubGlobal('Notification', { permission: 'granted' });
        vi.stubGlobal('navigator', {
            serviceWorker: {
                ready: Promise.resolve(mockRegistration)
            }
        });

        const result = await showNotification('Transfer Complete', { body: 'Received photo.jpg' });

        expect(result).toBe(true);
        expect(mockShowNotification).toHaveBeenCalledWith('Transfer Complete', expect.objectContaining({
            body: 'Received photo.jpg',
            icon: '/icon-192.png',
            badge: '/icon-192.png'
        }));
    });

    it('falls back to new Notification() constructor if ServiceWorker is missing or fails', async () => {
        const mockNotificationConstructor = vi.fn();
        vi.stubGlobal('window', { Notification: mockNotificationConstructor });
        mockNotificationConstructor.permission = 'granted';
        vi.stubGlobal('Notification', mockNotificationConstructor);
        vi.stubGlobal('navigator', {}); // no serviceWorker

        const result = await showNotification('Desktop Alert', { body: 'File sent' });

        expect(result).toBe(true);
        expect(mockNotificationConstructor).toHaveBeenCalledWith('Desktop Alert', expect.objectContaining({
            body: 'File sent',
            icon: '/icon-192.png'
        }));
    });

    it('returns false cleanly if both ServiceWorker and constructor fail', async () => {
        function MockFailingNotification() {
            throw new TypeError("Failed to construct 'Notification': Illegal constructor");
        }
        MockFailingNotification.permission = 'granted';
        vi.stubGlobal('window', { Notification: MockFailingNotification });
        vi.stubGlobal('Notification', MockFailingNotification);
        vi.stubGlobal('navigator', {
            serviceWorker: {
                ready: Promise.reject(new Error('No active SW'))
            }
        });

        const result = await showNotification('Crash test', {});
        expect(result).toBe(false);
    });
});
