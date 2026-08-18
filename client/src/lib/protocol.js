// Wire protocol constants and pure helpers shared by the transfer engine.

export const CONTROL_CHANNEL_LABEL = 'control';

export const MSG = {
    FILES_OFFER: 'FILES_OFFER',
    FILE_REQUEST: 'FILE_REQUEST',
    FILE_CANCEL: 'FILE_CANCEL',
    FILE_END: 'FILE_END',
    HANDSHAKE_SYN: 'HANDSHAKE_SYN',
    HANDSHAKE_ACK: 'HANDSHAKE_ACK',
    CHAT_MESSAGE: 'CHAT_MESSAGE',
};

export function fileChannelLabel(fileId) {
    return `file:${fileId}`;
}

export function parseFileChannelLabel(label) {
    if (typeof label !== 'string' || !label.startsWith('file:')) {
        return null;
    }

    const fileId = label.slice('file:'.length);
    return fileId || null;
}

const STUN_SERVERS = [
    {
        urls: [
            'stun:stun.l.google.com:19302',
            'stun:stun1.l.google.com:19302'
        ]
    }
];

// STUN by default; an optional TURN relay can be provided via env vars for
// networks where direct P2P fails (AP isolation, strict NAT).
export function buildIceServers() {
    const iceServers = [...STUN_SERVERS];
    const turnUrl = import.meta.env.VITE_TURN_URL;

    if (turnUrl) {
        iceServers.push({
            urls: turnUrl.split(',').map((url) => url.trim()).filter(Boolean),
            username: import.meta.env.VITE_TURN_USERNAME || undefined,
            credential: import.meta.env.VITE_TURN_CREDENTIAL || undefined
        });
    }

    return iceServers;
}

// SCTP message size is negotiated per connection. Stay within whichever limit
// the pair supports, capped at 256 KiB (large enough for LAN throughput,
// small enough to keep per-chunk memory and retransmission units sane).
export function negotiateChunkSize(maxMessageSize) {
    const limit = Number(maxMessageSize);
    const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : 65536;
    return Math.min(262144, safeLimit);
}

// Send-side backpressure hysteresis: pause filling above the high-water mark
// and resume once the buffer drains below the low-water mark.
export const SEND_HIGH_WATER_BYTES = 8 * 1024 * 1024;
export const SEND_LOW_WATER_BYTES = 4 * 1024 * 1024;

// Browsers without the File System Access API must buffer received files in
// memory; cap what we are willing to accumulate there.
export const MEMORY_MODE_LIMIT_BYTES = 2 * 1024 * 1024 * 1024;

// Above this size, receivers that support streaming saves get a save-as
// dialog up front and stream straight to disk.
export const STREAM_SAVE_THRESHOLD_BYTES = 512 * 1024 * 1024;

export const CONNECT_TIMEOUT_MS = 20000;
export const DISCONNECT_GRACE_MS = 8000;

export function canStreamSave() {
    return typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function';
}

export function createTransferId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }

    return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
