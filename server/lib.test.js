import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    sanitizeName,
    sanitizeRoomCode,
    sanitizeNetworkFingerprints,
    sanitizeDeviceId,
    normalizeJoinPayload,
    getClientIp,
    detectDeviceType,
    areUsersVisible,
    getVisibleUsersFor,
    isValidSessionDescription,
    isValidIceCandidate,
    createRateLimiter,
    SimilarityIndex,
    SignalingSessionRegistry
} from './lib.js';

describe('sanitizeRoomCode', () => {
    it('normalizes alphanumeric codes to uppercase', () => {
        expect(sanitizeRoomCode('123456')).toBe('123456');
        expect(sanitizeRoomCode(' room42 ')).toBe('ROOM42');
        expect(sanitizeRoomCode(998877)).toBe('998877');
    });

    it('truncates codes longer than 16 characters', () => {
        expect(sanitizeRoomCode('a'.repeat(30)).length).toBe(16);
    });

    it('rejects invalid characters, whitespace inside, empty, and null', () => {
        expect(sanitizeRoomCode('12 34')).toBeNull();
        expect(sanitizeRoomCode('code@#$')).toBeNull();
        expect(sanitizeRoomCode('')).toBeNull();
        expect(sanitizeRoomCode(null)).toBeNull();
        expect(sanitizeRoomCode(undefined)).toBeNull();
    });
});

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
        expect(normalizeJoinPayload(undefined)).toMatchObject({ name: 'Unknown Device', roomCode: null });
    });

    it('extracts and sanitizes roomCode from join payload', () => {
        const result = normalizeJoinPayload({
            name: 'Alice',
            roomCode: ' room99 '
        });
        expect(result.roomCode).toBe('ROOM99');
    });

    it('returns roomCode: undefined when omitted from object payload and null when explicitly cleared', () => {
        expect(normalizeJoinPayload({ name: 'Alice' }).roomCode).toBeUndefined();
        expect(normalizeJoinPayload({ name: 'Alice', roomCode: null }).roomCode).toBeNull();
        expect(normalizeJoinPayload({ name: 'Alice', room: '' }).roomCode).toBeNull();
    });
});

describe('getClientIp', () => {
    it('extracts client IP from cf-connecting-ip with highest priority', () => {
        const headers = {
            'cf-connecting-ip': '203.0.113.195',
            'x-forwarded-for': '198.51.100.1, 172.71.99.10'
        };
        expect(getClientIp(headers, '10.0.0.1')).toBe('203.0.113.195');
    });

    it('extracts client IP from true-client-ip when cf-connecting-ip is absent', () => {
        const headers = {
            'true-client-ip': '203.0.113.200',
            'x-forwarded-for': '198.51.100.1, 172.71.99.10'
        };
        expect(getClientIp(headers, '10.0.0.1')).toBe('203.0.113.200');
    });

    it('extracts client IP from x-real-ip when Cloudflare headers are absent', () => {
        const headers = {
            'x-real-ip': '198.51.100.42',
            'x-forwarded-for': '198.51.100.42, 10.0.0.2'
        };
        expect(getClientIp(headers, '10.0.0.1')).toBe('198.51.100.42');
    });

    it('extracts the FIRST entry from x-forwarded-for (RFC 7239 original client)', () => {
        const headers = {
            'x-forwarded-for': '203.0.113.50, 172.71.99.10, 10.0.0.1'
        };
        expect(getClientIp(headers, '10.0.0.1')).toBe('203.0.113.50');
    });

    it('strips IPv4-mapped IPv6 prefix ::ffff:', () => {
        const headers = {
            'x-forwarded-for': '::ffff:203.0.113.50, 10.0.0.1'
        };
        expect(getClientIp(headers, '')).toBe('203.0.113.50');
    });

    it('falls back to the socket address without ::ffff: prefix when headers are empty', () => {
        expect(getClientIp({}, '::ffff:192.168.0.5')).toBe('192.168.0.5');
        expect(getClientIp(null, '192.168.0.5')).toBe('192.168.0.5');
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

    it('maintains visibility when both devices share public IP but private LAN IPs are hidden by mDNS (.local)', () => {
        const userA = user({ publicIp: '203.0.113.10', networkFingerprints: [] });
        const userB = user({ id: 'b', publicIp: '203.0.113.10', networkFingerprints: [] });
        expect(areUsersVisible(userA, userB)).toBe(true);
    });

    it('maintains visibility when both devices share public IP even if one or both exposed divergent WAN STUN candidates on multi-WAN office network', () => {
        const userA = user({ publicIp: '203.0.113.10', networkFingerprints: ['wan:ipv4:203.0.113.11'] });
        const userB = user({ id: 'b', publicIp: '203.0.113.10', networkFingerprints: ['wan:ipv4:203.0.113.12'] });
        expect(areUsersVisible(userA, userB)).toBe(true);
    });

    it('still isolates devices sharing public IP if both explicitly exposed DIFFERENT private LAN subnets', () => {
        const userA = user({ publicIp: '203.0.113.10', networkFingerprints: ['lan:ipv4:192.168.1'] });
        const userB = user({ id: 'b', publicIp: '203.0.113.10', networkFingerprints: ['lan:ipv4:192.168.200'] });
        expect(areUsersVisible(userA, userB)).toBe(false);
    });

    it('hides peers with different public IPs', () => {
        expect(areUsersVisible(
            user(),
            user({ id: 'b', publicIp: '2.2.2.2' })
        )).toBe(false);
    });

    it('shows peers sharing the same roomCode regardless of different public IPs and fingerprints', () => {
        expect(areUsersVisible(
            user({ roomCode: '123456', publicIp: '1.1.1.1', networkFingerprints: ['lan:ipv4:10.0.0'] }),
            user({ id: 'b', roomCode: '123456', publicIp: '9.9.9.9', networkFingerprints: ['lan:ipv4:192.168.1'] })
        )).toBe(true);
    });

    it('hides peers in different rooms', () => {
        expect(areUsersVisible(
            user({ roomCode: '123456', publicIp: '1.1.1.1' }),
            user({ id: 'b', roomCode: '654321', publicIp: '1.1.1.1' })
        )).toBe(false);
    });

    it('hides a peer in a room from a peer not in any room even on the same IP', () => {
        expect(areUsersVisible(
            user({ roomCode: '123456', publicIp: '1.1.1.1' }),
            user({ id: 'b', roomCode: null, publicIp: '1.1.1.1' })
        )).toBe(false);
        expect(areUsersVisible(
            user({ roomCode: null, publicIp: '1.1.1.1' }),
            user({ id: 'b', roomCode: '123456', publicIp: '1.1.1.1' })
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

describe('SimilarityIndex', () => {
    it('indexes users by public IP and returns matching candidates', () => {
        const index = new SimilarityIndex();
        const userA = { id: 'sock-1', publicIp: '1.2.3.4', networkFingerprints: [] };
        const userB = { id: 'sock-2', publicIp: '1.2.3.4', networkFingerprints: [] };
        const userC = { id: 'sock-3', publicIp: '5.6.7.8', networkFingerprints: [] };

        index.addUser(userA);
        index.addUser(userB);
        index.addUser(userC);

        expect(index.getCandidateIdsFor(userA)).toEqual(['sock-2']);
        expect(index.getCandidateIdsFor(userB)).toEqual(['sock-1']);
        expect(index.getCandidateIdsFor(userC)).toEqual([]);
    });

    it('indexes users across network fingerprints (LAN/WAN) even with divergent public IPs', () => {
        const index = new SimilarityIndex();
        const userA = { id: 'sock-1', publicIp: '1.2.3.4', networkFingerprints: ['lan:ipv4:192.168.1'] };
        const userB = { id: 'sock-2', publicIp: '9.9.9.9', networkFingerprints: ['lan:ipv4:192.168.1'] };

        index.addUser(userA);
        index.addUser(userB);

        expect(index.getCandidateIdsFor(userA)).toEqual(['sock-2']);
        expect(index.getCandidateIdsFor(userB)).toEqual(['sock-1']);
    });

    it('removes users completely on disconnect', () => {
        const index = new SimilarityIndex();
        const userA = { id: 'sock-1', publicIp: '1.2.3.4', networkFingerprints: ['lan:ipv4:10.0.0'] };
        const userB = { id: 'sock-2', publicIp: '1.2.3.4', networkFingerprints: ['lan:ipv4:10.0.0'] };

        index.addUser(userA);
        index.addUser(userB);
        expect(index.getCandidateIdsFor(userA)).toEqual(['sock-2']);

        index.removeUser('sock-2');
        expect(index.getCandidateIdsFor(userA)).toEqual([]);
        expect(index.socketKeys.has('sock-2')).toBe(false);
        expect(index.index.size).toBeGreaterThan(0); // userA's keys remain

        index.removeUser('sock-1');
        expect(index.index.size).toBe(0); // all empty buckets pruned
    });

    it('returns affected socket ids including the user themselves', () => {
        const index = new SimilarityIndex();
        const userA = { id: 'sock-1', publicIp: '1.2.3.4', networkFingerprints: [] };
        const userB = { id: 'sock-2', publicIp: '1.2.3.4', networkFingerprints: [] };

        index.addUser(userA);
        index.addUser(userB);

        const affected = index.getAffectedSocketIds(userA);
        expect(affected).toContain('sock-1');
        expect(affected).toContain('sock-2');
    });

    it('indexes users by roomCode and isolates them from non-room users', () => {
        const index = new SimilarityIndex();
        const userA = { id: 'sock-1', roomCode: 'ROOM1', publicIp: '1.1.1.1' };
        const userB = { id: 'sock-2', roomCode: 'ROOM1', publicIp: '2.2.2.2' };
        const userC = { id: 'sock-3', roomCode: 'ROOM2', publicIp: '1.1.1.1' };
        const userD = { id: 'sock-4', roomCode: null, publicIp: '1.1.1.1' };

        index.addUser(userA);
        index.addUser(userB);
        index.addUser(userC);
        index.addUser(userD);

        expect(index.getCandidateIdsFor(userA)).toEqual(['sock-2']);
        expect(index.getCandidateIdsFor(userB)).toEqual(['sock-1']);
        expect(index.getCandidateIdsFor(userC)).toEqual([]);
        expect(index.getCandidateIdsFor(userD)).toEqual([]);
    });
});

describe('SignalingSessionRegistry', () => {
    it('authorizes reciprocal signaling for registered sessions within TTL', () => {
        const registry = new SignalingSessionRegistry({ ttlMs: 1000 });
        registry.registerSession('peerA', 'peerB');

        expect(registry.isAuthorized('peerA', 'peerB')).toBe(true);
        expect(registry.isAuthorized('peerB', 'peerA')).toBe(true);
        expect(registry.isAuthorized('peerA', 'peerC')).toBe(false);
    });

    it('expires sessions after TTL', () => {
        let now = 1000;
        const registry = new SignalingSessionRegistry({ ttlMs: 500, nowFn: () => now });
        registry.registerSession('peerA', 'peerB');
        expect(registry.isAuthorized('peerA', 'peerB')).toBe(true);

        now = 1600;
        expect(registry.isAuthorized('peerA', 'peerB')).toBe(false);
    });

    it('removes sessions when a socket disconnects', () => {
        const registry = new SignalingSessionRegistry();
        registry.registerSession('peerA', 'peerB');
        registry.removeSocket('peerA');
        expect(registry.isAuthorized('peerA', 'peerB')).toBe(false);
    });
});
