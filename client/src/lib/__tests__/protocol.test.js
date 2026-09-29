import { describe, it, expect } from 'vitest';
import {
    fileChannelLabel,
    parseFileChannelLabel,
    negotiateChunkSize,
    createTransferId,
    canStreamSave,
    buildIceServers,
    FILE_STATUS,
    isRelayCandidate,
    RELAY_MAX_FILE_SIZE_BYTES,
    RELAY_SIZE_LIMIT_ERROR,
    STRICT_LOCAL_RELAY_BLOCKED_ERROR,
    stripRelayFromSdp,
    resolveTurnApiUrl
} from '../protocol';

describe('FILE_STATUS', () => {
    it('defines distinct statuses for the transfer lifecycle', () => {
        expect(FILE_STATUS.CONNECTING).toBe('connecting');
        expect(FILE_STATUS.OFFERED).toBe('offered');
        expect(FILE_STATUS.IDLE).toBe('idle');
        expect(FILE_STATUS.WAITING).toBe('waiting');
        expect(FILE_STATUS.UPLOADING).toBe('uploading');
        expect(FILE_STATUS.DOWNLOADING).toBe('downloading');
        expect(FILE_STATUS.COMPLETED).toBe('completed');
        expect(FILE_STATUS.ERROR).toBe('error');
        expect(FILE_STATUS.FAILED).toBe('failed');
        expect(FILE_STATUS.CANCELLED).toBe('cancelled');
        expect(FILE_STATUS.BLOCKED).toBe('blocked');
    });
});

describe('file channel labels', () => {
    it('round-trips file ids', () => {
        const id = '63367305-63dc-4905-a82a-d6ac828d351a';
        expect(parseFileChannelLabel(fileChannelLabel(id))).toBe(id);
    });

    it('rejects non-file labels', () => {
        expect(parseFileChannelLabel('control')).toBeNull();
        expect(parseFileChannelLabel('file:')).toBeNull();
        expect(parseFileChannelLabel(null)).toBeNull();
    });
});

describe('negotiateChunkSize', () => {
    it('caps at 64 KiB for cross-browser reliability', () => {
        expect(negotiateChunkSize(1024 * 1024)).toBe(65536);
    });

    it('respects a smaller negotiated maximum', () => {
        expect(negotiateChunkSize(32768)).toBe(32768);
        expect(negotiateChunkSize(16384)).toBe(16384);
    });

    it('falls back to 64 KiB for missing or invalid values', () => {
        expect(negotiateChunkSize(undefined)).toBe(65536);
        expect(negotiateChunkSize(0)).toBe(65536);
        expect(negotiateChunkSize(Number.NaN)).toBe(65536);
    });
});

describe('createTransferId', () => {
    it('produces unique ids', () => {
        const ids = new Set(Array.from({ length: 500 }, () => createTransferId()));
        expect(ids.size).toBe(500);
    });
});

describe('canStreamSave', () => {
    it('is false in environments without the File System Access API', () => {
        expect(canStreamSave()).toBe(false);
    });
});

describe('buildIceServers', () => {
    it('includes STUN servers', () => {
        const servers = buildIceServers();
        expect(servers.length).toBeGreaterThanOrEqual(1);
        expect(servers[0].urls.some((url) => url.startsWith('stun:'))).toBe(true);
    });

    it('adds TURN from environment when provided', () => {
        // VITE_TURN_URL is unset in the test environment.
        const servers = buildIceServers();
        const hasTurn = servers.some((server) =>
            server.urls.some?.((url) => typeof url === 'string' ? url.startsWith('turn:') : false)
        );
        expect(hasTurn).toBe(false);
    });

    it('dynamically merges TURN credentials when provided', () => {
        const mockTurn = [
            { urls: 'turn:turn.relay.metered.ca:443', username: 'user1', credential: 'pass' }
        ];

        const servers = buildIceServers({ iceServers: mockTurn });
        expect(servers.some((s) => s.urls === 'turn:turn.relay.metered.ca:443')).toBe(true);
        expect(servers[0].urls.some((u) => u.startsWith('stun:'))).toBe(true);
    });

    it('supports credentials passed as an array directly', () => {
        const mockTurn = [
            { urls: ['turn:direct.metered.ca:80'], username: 'u2', credential: 'c2' }
        ];

        const servers = buildIceServers(mockTurn);
        expect(servers.some((s) => Array.isArray(s.urls) && s.urls.includes('turn:direct.metered.ca:80'))).toBe(true);
    });

    it('strips TURN servers when strictLocalMode is enabled', () => {
        const mockTurn = [
            { urls: 'stun:stun.metered.ca:80' },
            { urls: 'turn:relay.metered.ca:443', username: 'u', credential: 'c' },
            { urls: ['turns:secure.metered.ca:443'], username: 'u', credential: 'c' }
        ];

        const servers = buildIceServers(mockTurn, { strictLocalMode: true });

        // Preserves Google STUN and STUN servers
        expect(servers.some((s) => s.urls.some?.((u) => u.startsWith('stun:')))).toBe(true);
        expect(servers.some((s) => s.urls === 'stun:stun.metered.ca:80')).toBe(true);

        // Strips all TURN/TURNS relays
        const hasTurn = servers.some((s) => {
            const urls = Array.isArray(s.urls) ? s.urls : [s.urls];
            return urls.some((u) => typeof u === 'string' && (u.startsWith('turn:') || u.startsWith('turns:')));
        });
        expect(hasTurn).toBe(false);
    });
});

describe('Relay and candidate helpers', () => {
    it('detects relay candidates accurately', () => {
        expect(isRelayCandidate({ type: 'relay' })).toBe(true);
        expect(isRelayCandidate({ candidate: 'candidate:1 1 UDP 12345 1.2.3.4 5678 typ relay raddr 0.0.0.0 rport 0' })).toBe(true);
        expect(isRelayCandidate({ type: 'host', candidate: 'typ host' })).toBe(false);
        expect(isRelayCandidate({ type: 'srflx', candidate: 'typ srflx' })).toBe(false);
        expect(isRelayCandidate(null)).toBe(false);
    });

    it('enforces exactly 150 MB relay file size cap constant and copy', () => {
        expect(RELAY_MAX_FILE_SIZE_BYTES).toBe(150 * 1024 * 1024);
        expect(RELAY_SIZE_LIMIT_ERROR).toContain('Files over 150 MB cannot be sent over cloud relay on the free tier');
        expect(RELAY_SIZE_LIMIT_ERROR).toContain('mobile hotspot');
    });

    it('defines STRICT_LOCAL_RELAY_BLOCKED_ERROR', () => {
        expect(STRICT_LOCAL_RELAY_BLOCKED_ERROR).toContain('Strict Local Mode is active');
        expect(STRICT_LOCAL_RELAY_BLOCKED_ERROR).toContain('never leave your local network');
    });

    it('strips relay candidates from SDP strings', () => {
        const sdpWithRelay = [
            'v=0',
            'o=- 12345 2 IN IP4 127.0.0.1',
            'a=candidate:1 1 UDP 2130706431 192.168.1.10 5000 typ host',
            'a=candidate:2 1 UDP 1694498815 198.51.100.1 5002 typ srflx raddr 192.168.1.10 rport 5000',
            'a=candidate:3 1 UDP 16777215 203.0.113.5 3478 typ relay raddr 198.51.100.1 rport 5002',
            'a=end-of-candidates'
        ].join('\r\n');

        const stripped = stripRelayFromSdp(sdpWithRelay);
        expect(stripped).toContain('typ host');
        expect(stripped).toContain('typ srflx');
        expect(stripped).not.toContain('typ relay');
    });

    it('resolves turnApiUrl against socket URI or environment', () => {
        // Absolute URL remains untouched
        expect(resolveTurnApiUrl('https://turn.example.com/api/turn')).toBe('https://turn.example.com/api/turn');

        // Socket URI resolution
        const mockSocket = { io: { uri: 'http://192.168.1.100:3001' } };
        expect(resolveTurnApiUrl('/api/turn-credentials', mockSocket)).toBe('http://192.168.1.100:3001/api/turn-credentials');

        // Fallback for null/empty
        expect(resolveTurnApiUrl(null)).toBe('/api/turn-credentials');
    });
});

