// Browser-notification helper gated on permissions and visibility.

export function areNotificationsSupported() {
    return typeof window !== 'undefined' && 'Notification' in window;
}

export function getNotificationPermission() {
    return areNotificationsSupported() ? Notification.permission : 'denied';
}

export async function requestNotificationPermission() {
    if (!areNotificationsSupported()) return 'denied';
    try {
        return await Notification.requestPermission();
    } catch {
        return 'denied';
    }
}

export function showNotification(title, options = {}) {
    if (!areNotificationsSupported() || Notification.permission !== 'granted') {
        return false;
    }

    try {
        new Notification(title, {
            icon: '/icon-192.png',
            badge: '/icon-192.png',
            ...options
        });
        return true;
    } catch {
        return false;
    }
}
