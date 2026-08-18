import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    sanitizeName,
    sanitizeNetworkFingerprints,
    sanitizeDeviceId,
    normalizeJoinPayload,
    getClientIp,
    detectDeviceType,
    areUsersVisible,
    getVisibleUsersFor,
    isValidSessionDescription,
    isValidIceCandidate,
    createRateLimiter
} from './lib.js';

describe('sanitizeName', () => {
    it('trims and truncates long names', () => {
        expect(sanitizeName('  Alice  ')).toBe('Alice');
        expect(sanitizeName('x'.repeat(100)).length).toBe(32);
    });

    it('falls back for invalid input', () => {
        expect(sanitizeName(null)).toBe('Unknown Device');
        expect(sanitizeName(42)).toBe('Unknown Device');
        expect(sanitizeName('   ')).toBe('Unknown Device');
    });
});

describe('sanitizeNetworkFingerprints', () => {
    it('keeps only valid fingerprint strings and dedupes', () => {
        expect(sanitizeNetworkFingerprints([
            'lan:ipv4:192.168.1',
            'lan:ipv4:192.168.1',
            'wan:ipv4:8.8.8.8',
            'not valid!',
            null,
            123
        ])).toEqual(['lan:ipv4:192.168.1', 'wan:ipv4:8.8.8.8']);
    });

    it('caps the number of entries', () => {
        const many = Array.from({ length: 30 }, (_, i) => `lan:ipv4:10.0.${i}`);
        expect(sanitizeNetworkFingerprints(many).length).toBe(12);
    });

    it('rejects non-arrays', () => {
        expect(sanitizeNetworkFingerprints('lan:ipv4:10.0.0')).toEqual([]);
    });
});

describe('sanitizeDeviceId', () => {
    it('normalizes and validates ids', () => {
        expect(sanitizeDeviceId('ABC-123-DEF')).toBe('abc-123-def');
        expect(sanitizeDeviceId('spaces in id')).toBeNull();
        expect(sanitizeDeviceId('')).toBeNull();
        expect(sanitizeDeviceId(undefined)).toBeNull();
    });
});

describe('normalizeJoinPayload', () => {
    it('accepts legacy string payloads', () => {
        expect(normalizeJoinPayload('Alice')).toMatchObject({ name: 'Alice', deviceId: null });
    });

    it('merges legacy single fingerprint with the array', () => {
        const result = normalizeJoinPayload({
            name: 'Alice',
            networkFingerprint: 'lan:ipv4:10.1.2',
            networkFingerprints: ['wan:ipv4:1.2.3.4']
        });
        expect(result.networkFingerprints).toEqual(['wan:ipv4:1.2.3.4', 'lan:ipv4:10.1.2']);
    });

    it('falls back for garbage payloads', () => {
        expect(normalizeJoinPayload(undefined)).toMatchObject({ name: 'Unknown Device' });
    });
});

describe('getClientIp', () => {
    it('uses the LAST forwarded entry (proxy-appended), not the client-controlled first', () => {
        expect(getClientIp({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' }, '')).toBe('5.6.7.8');
    });

    it('falls back to the socket address without the v6 prefix', () => {
        expect(getClientIp({}, '::ffff:192.168.0.5')).toBe('192.168.0.5');
    });
});

describe('detectDeviceType', () => {
    it('recognizes mobile user agents', () => {
        expect(detectDeviceType('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)')).toBe('mobile');
        expect(detectDeviceType('Mozilla/5.0 (Linux; Android 14)')).toBe('mobile');
    });

    it('defaults to desktop', () => {
        expect(detectDeviceType('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('desktop');
        expect(detectDeviceType(undefined)).toBe('desktop');
    });
});

describe('areUsersVisible', () => {
    const user = (overrides = {}) => ({
        id: 'a',
        publicIp: '1.1.1.1',
        networkFingerprints: [],
        ...overrides
    });

    it('shows peers sharing a LAN subnet fingerprint', () => {
        expect(areUsersVisible(
            user({ networkFingerprints: ['lan:ipv4:192.168.1'] }),
            user({ id: 'b', networkFingerprints: ['lan:ipv4:192.168.1', 'wan:ipv4:9.9.9.9'] })
        )).toBe(true);
    });

    it('shows peers sharing a WAN fingerprint', () => {
        expect(areUsersVisible(
            user({ networkFingerprints: ['wan:ipv4:8.8.8.8'] }),
            user({ id: 'b', networkFingerprints: ['wan:ipv4:8.8.8.8'] })
        )).toBe(true);
    });

    it('falls back to the HTTP public IP when fingerprints are incomparable', () => {
        expect(areUsersVisible(
            user({ networkFingerprints: ['lan:ipv4:192.168.1'] }),
            user({ id: 'b', networkFingerprints: [], publicIp: '1.1.1.1' })
        )).toBe(true);
    });

    it('hides peers with comparable but different fingerprints', () => {
        expect(areUsersVisible(
            user({ networkFingerprints: ['lan:ipv4:192.168.1', 'wan:ipv4:8.8.8.8'] }),
            user({ id: 'b', networkFingerprints: ['lan:ipv4:192.168.2', 'wan:ipv4:9.9.9.9'], publicIp: '1.1.1.1' })
        )).toBe(false);
    });

    it('hides peers with different public IPs', () => {
        expect(areUsersVisible(
            user(),
            user({ id: 'b', publicIp: '2.2.2.2' })
        )).toBe(false);
    });
});

describe('getVisibleUsersFor', () => {
    it('returns visible peers excluding self with stable public fields', () => {
        const users = {
            a: { id: 'a', name: 'A', deviceId: 'dev-a', deviceType: 'desktop', publicIp: '1.1.1.1', networkFingerprints: ['lan:ipv4:10.0.0'] },
            b: { id: 'b', name: 'B', deviceId: 'dev-b', deviceType: 'mobile', publicIp: '1.1.1.1', networkFingerprints: ['lan:ipv4:10.0.0'] },
            c: { id: 'c', name: 'C', deviceId: 'dev-c', deviceType: 'desktop', publicIp: '3.3.3.3', networkFingerprints: ['lan:ipv4:172.16.0'] }
        };

        expect(getVisibleUsersFor(users, users.a)).toEqual([
            { id: 'b', name: 'B', deviceId: 'dev-b', deviceType: 'mobile' }
        ]);
    });
});

describe('relay payload validation', () => {
    it('accepts well-formed session descriptions', () => {
        expect(isValidSessionDescription({ type: 'offer', sdp: 'v=0...' }, 'offer')).toBe(true);
        expect(isValidSessionDescription({ type: 'answer', sdp: 'v=0...' }, 'offer')).toBe(false);
        expect(isValidSessionDescription({ type: 'offer', sdp: '' }, 'offer')).toBe(false);
        expect(isValidSessionDescription({ type: 'offer', sdp: 'x'.repeat(40 * 1024) }, 'offer')).toBe(false);
        expect(isValidSessionDescription(null, 'offer')).toBe(false);
    });

    it('accepts well-formed ICE candidates', () => {
        expect(isValidIceCandidate({ candidate: 'candidate:1 1 UDP 2122187007 192.168.1.5 52324 typ host' })).toBe(true);
        expect(isValidIceCandidate({ candidate: '' })).toBe(false);
        expect(isValidIceCandidate({})).toBe(false);
        expect(isValidIceCandidate({ candidate: 'x'.repeat(2000) })).toBe(false);
    });
});

describe('createRateLimiter', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    it('allows bursts up to capacity then blocks', () => {
        const limiter = createRateLimiter({ capacity: 3, refillPerSecond: 1 });

        expect(limiter.tryConsume('key')).toBe(true);
        expect(limiter.tryConsume('key')).toBe(true);
        expect(limiter.tryConsume('key')).toBe(true);
        expect(limiter.tryConsume('key')).toBe(false);
    });

    it('refills over time', () => {
        const limiter = createRateLimiter({ capacity: 2, refillPerSecond: 10 });

        expect(limiter.tryConsume('key')).toBe(true);
        expect(limiter.tryConsume('key')).toBe(true);
        expect(limiter.tryConsume('key')).toBe(false);

        vi.advanceTimersByTime(250); // 0.25s * 10/s = 2.5 tokens
        expect(limiter.tryConsume('key')).toBe(true);
    });

    it('tracks keys independently and supports reset', () => {
        const limiter = createRateLimiter({ capacity: 1, refillPerSecond: 1 });

        expect(limiter.tryConsume('a')).toBe(true);
        expect(limiter.tryConsume('a')).toBe(false);
        expect(limiter.tryConsume('b')).toBe(true);

        limiter.reset('a');
        expect(limiter.tryConsume('a')).toBe(true);
    });
});
