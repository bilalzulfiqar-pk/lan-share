/**
 * Transfer mode configurations, labels, and explanatory diagnostic text.
 * Option B compact labels are preserved below as comments for future mobile tuning:
 * - direct-lan: 'Local Wi-Fi'
 * - direct-stun: 'Direct Internet'
 * - relay-turn: 'Cloud Relay'
 */
export const MODE_CONFIG = {
    'direct-lan': {
        modeKey: 'direct-lan',
        // Option B compact: 'Local Wi-Fi'
        label: 'Local Wi-Fi Transfer',
        badgeClass: 'mode-direct-lan',
        dotColor: 'status-dot-green',
        title: 'Local Wi-Fi Transfer',
        description: 'Files flow directly through your local Wi-Fi router at maximum speed (up to 80+ MB/s). Zero internet bandwidth or cloud data used.',
        why: 'Both devices are on the same local Wi-Fi network, and your router permits direct device-to-device communication.',
        tip: null
    },
    'direct-stun': {
        modeKey: 'direct-stun',
        // Option B compact: 'Direct Internet'
        label: 'Direct Internet Transfer',
        badgeClass: 'mode-direct-stun',
        dotColor: 'status-dot-blue',
        title: 'Direct Internet Transfer',
        description: 'Devices are connected directly peer-to-peer over the internet using WebRTC. Files stream directly between devices without touching any cloud storage.',
        why: 'Devices are connected across different networks or firewalls that permit direct peer-to-peer WebRTC connections.',
        tip: '💡 Tip: Need faster local transfer speeds without using internet data? Connect both devices to a personal mobile hotspot.'
    },
    'relay-turn': {
        modeKey: 'relay-turn',
        // Option B compact: 'Cloud Relay'
        label: 'Cloud Relay Transfer',
        badgeClass: 'mode-relay-turn',
        dotColor: 'status-dot-amber',
        title: 'Cloud Relay Transfer',
        description: 'Files are routed through a secure, encrypted cloud relay (Metered.ca TURN). Speeds depend on your internet connection (Max 150 MB per file).',
        why: 'Your Wi-Fi network (e.g., university, hotel, or office network) has Access Point (AP) Isolation or high-security firewalls enabled, blocking direct local communication.',
        tip: '💡 Tip: Need to send files larger than 150 MB? Turn on a mobile hotspot on your phone and connect both devices to transfer unlimited files directly at full 50+ MB/s Wi-Fi speed!'
    }
};
