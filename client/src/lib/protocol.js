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

export const FILE_STATUS = Object.freeze({
    CONNECTING: 'connecting',
    OFFERED: 'offered',
    IDLE: 'idle',
    WAITING: 'waiting',
    UPLOADING: 'uploading',
    DOWNLOADING: 'downloading',
    COMPLETED: 'completed',
    ERROR: 'error',
    FAILED: 'failed',
    CANCELLED: 'cancelled',
    BLOCKED: 'blocked'
});

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

export const RELAY_MAX_FILE_SIZE_BYTES = 150 * 1024 * 1024;
export const RELAY_SIZE_LIMIT_ERROR =
    'Files over 150 MB cannot be sent over cloud relay on the free tier. Please enable a personal mobile hotspot to transfer large files directly at full Wi-Fi speed.';
export const STRICT_LOCAL_RELAY_BLOCKED_ERROR =
    'Strict Local Mode is active. Relayed transfers are blocked to ensure files never leave your local network. Please connect both devices to the same Wi-Fi or mobile hotspot.';

export function isRelayCandidate(candidate) {
    if (!candidate) return false;
    if (candidate.type === 'relay') return true;
    const candStr = typeof candidate.candidate === 'string' ? candidate.candidate : '';
    return candStr.includes('typ relay');
}

export function stripRelayFromSdp(sdp) {
    if (typeof sdp !== 'string') return sdp;
    return sdp.replace(/^a=candidate:.*?\btyp\s+relay\b.*(?:\r\n|\r|\n)?/gim, '');
}

export function resolveTurnApiUrl(url = '/api/turn-credentials', socket = null) {
    if (!url || typeof url !== 'string') return '/api/turn-credentials';
    if (url.startsWith('http://') || url.startsWith('https://')) {
        return url;
    }

    // Try socket URI if available
    const socketUri = socket?.io?.uri;
    if (socketUri && (socketUri.startsWith('http://') || socketUri.startsWith('https://'))) {
        try {
            return new URL(url, socketUri).toString();
        } catch {
            // fallback
        }
    }

    // Try VITE_SERVER_URL if defined
    const envServerUrl = typeof import.meta !== 'undefined' ? import.meta.env?.VITE_SERVER_URL : null;
    if (envServerUrl && (envServerUrl.startsWith('http://') || envServerUrl.startsWith('https://'))) {
        try {
            return new URL(url, envServerUrl).toString();
        } catch {
            // fallback
        }
    }

    // If running in local Vite dev server (default port 5173), target port 3001
    if (typeof window !== 'undefined' && window.location?.hostname) {
        if (window.location.port === '5173') {
            const cleanPath = url.startsWith('/') ? url : `/${url}`;
            return `${window.location.protocol}//${window.location.hostname}:3001${cleanPath}`;
        }
    }

    return url;
}

// STUN by default; an optional TURN relay can be provided via credentials or env vars
// for networks where direct P2P fails (AP isolation, strict NAT).
// In Strict Local Mode, TURN relays are stripped so traffic never leaves LAN.
export function buildIceServers(turnCredentials = null, { strictLocalMode = false } = {}) {
    const iceServers = [...STUN_SERVERS];

    const isTurnServer = (server) => {
        if (!server) return false;
        const rawUrls = server.urls || server.url;
        if (!rawUrls) return false;
        const urls = Array.isArray(rawUrls) ? rawUrls : [rawUrls];
        return urls.some((u) => typeof u === 'string' && (u.startsWith('turn:') || u.startsWith('turns:')));
    };

    if (turnCredentials) {
        const candidateServers = Array.isArray(turnCredentials)
            ? turnCredentials
            : (Array.isArray(turnCredentials?.iceServers) ? turnCredentials.iceServers : []);

        for (const server of candidateServers) {
            if (strictLocalMode && isTurnServer(server)) {
                continue;
            }
            iceServers.push(server);
        }
    }

    const turnUrl = typeof import.meta !== 'undefined' ? import.meta.env?.VITE_TURN_URL : undefined;
    if (turnUrl && !strictLocalMode) {
        iceServers.push({
            urls: turnUrl.split(',').map((url) => url.trim()).filter(Boolean),
            username: import.meta.env?.VITE_TURN_USERNAME || undefined,
            credential: import.meta.env?.VITE_TURN_CREDENTIAL || undefined
        });
    }

    return iceServers;
}

// SCTP message size is negotiated per connection. Stay within whichever limit
// the pair supports, capped at 64 KiB (65,536 bytes) for universal cross-browser
// reliability across Chrome, Edge, Safari, and Firefox.
export const MAX_CHUNK_SIZE_BYTES = 65536;

export function negotiateChunkSize(maxMessageSize) {
    const limit = Number(maxMessageSize);
    const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : MAX_CHUNK_SIZE_BYTES;
    return Math.min(MAX_CHUNK_SIZE_BYTES, safeLimit);
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

export function canOpfsSave() {
    return typeof navigator !== 'undefined' &&
        Boolean(navigator.storage) &&
        typeof navigator.storage.getDirectory === 'function';
}

export function createFileRequest(fileId, fromOffset = 0) {
    const offset = Number(fromOffset);
    return {
        type: MSG.FILE_REQUEST,
        fileId,
        fromOffset: Number.isFinite(offset) && offset > 0 ? offset : 0
    };
}

export function parseFileRequest(msg) {
    if (!msg || msg.type !== MSG.FILE_REQUEST) return null;
    const offset = Number(msg.fromOffset);
    return {
        fileId: msg.fileId,
        fromOffset: Number.isFinite(offset) && offset > 0 ? offset : 0
    };
}

export function createTransferId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }

    return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

