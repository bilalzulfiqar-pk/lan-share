// Browser-notification helper gated on permissions and visibility.

export function areNotificationsSupported() {
    return typeof window !== 'undefined' && 'Notification' in window;
}

export function getNotificationPermission() {
    if (!areNotificationsSupported()) return 'denied';
    const NotificationClass = typeof window !== 'undefined' && window.Notification
        ? window.Notification
        : (typeof Notification !== 'undefined' ? Notification : null);
    return NotificationClass?.permission || 'denied';
}

export async function requestNotificationPermission() {
    if (!areNotificationsSupported()) return 'denied';
    const NotificationClass = typeof window !== 'undefined' && window.Notification
        ? window.Notification
        : (typeof Notification !== 'undefined' ? Notification : null);
    if (!NotificationClass || typeof NotificationClass.requestPermission !== 'function') {
        return 'denied';
    }
    try {
        return await NotificationClass.requestPermission();
    } catch {
        return 'denied';
    }
}

export function isIosDevice() {
    if (typeof navigator === 'undefined') return false;
    return /iPad|iPhone|iPod/.test(navigator.userAgent || '') ||
        (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1);
}

export async function showNotification(title, options = {}) {
    if (!areNotificationsSupported()) {
        return false;
    }

    const NotificationClass = typeof window !== 'undefined' && window.Notification
        ? window.Notification
        : (typeof Notification !== 'undefined' ? Notification : null);

    if (!NotificationClass || NotificationClass.permission !== 'granted') {
        return false;
    }

    const payload = {
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        ...options
    };

    // 1. Primary path: Service Worker Registration (Required on Android Chrome & iOS PWAs)
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
        try {
            const registration = await navigator.serviceWorker.ready;
            if (registration && typeof registration.showNotification === 'function') {
                await registration.showNotification(title, payload);
                return true;
            }
        } catch {
            // Fall through to standard constructor
        }
    }

    // 2. Desktop fallback: new Notification() constructor
    try {
        new NotificationClass(title, payload);
        return true;
    } catch {
        return false;
    }
}

