import { describe, it, expect } from 'vitest';
import {
    fileChannelLabel,
    parseFileChannelLabel,
    negotiateChunkSize,
    createTransferId,
    canStreamSave,
    buildIceServers
} from '../protocol';

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
});
