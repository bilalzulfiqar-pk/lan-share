import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TurnCredentialManager, DEFAULT_STUN_SERVERS } from './turn.js';
import { app, turnLimiter, handleTurnCredentials } from './index.js';

describe('Server TurnCredentialManager', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        process.env = { ...originalEnv };
        delete process.env.METERED_API_KEY;
        delete process.env.METERED_APP_NAME;
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    it('returns default Google STUN servers when env vars are absent', async () => {
        const fetchFn = vi.fn();
        const manager = new TurnCredentialManager({ fetchFn });

        const result = await manager.getCredentials();

        expect(result).toEqual({ iceServers: DEFAULT_STUN_SERVERS });
        expect(fetchFn).not.toHaveBeenCalled();
        expect(result.iceServers[0].urls[0]).toContain('stun.l.google.com');
    });

    it('fetches short-lived ICE servers from Metered.ca when configured', async () => {
        const mockMeteredServers = [
            { urls: 'stun:stun.relay.metered.ca:80' },
            { urls: 'turn:standard.relay.metered.ca:80', username: 'user123', credential: 'secretpassword' }
        ];

        const fetchFn = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => mockMeteredServers
        });

        const manager = new TurnCredentialManager({
            apiKey: 'test-api-key',
            appName: 'test-app',
            fetchFn
        });

        const result = await manager.getCredentials();

        expect(fetchFn).toHaveBeenCalledTimes(1);
        expect(fetchFn).toHaveBeenCalledWith('https://test-app.metered.ca/api/v1/turn/credentials?apiKey=test-api-key');
        expect(result).toEqual({ iceServers: mockMeteredServers });
    });

    it('caches credentials in memory for 1 hour to prevent API spam', async () => {
        let currentTime = 1000000;
        const nowFn = () => currentTime;

        const mockServers = [{ urls: 'turn:relay.metered.ca:443', username: 'u', credential: 'c' }];
        const fetchFn = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => mockServers
        });

        const manager = new TurnCredentialManager({
            apiKey: 'key',
            appName: 'app',
            fetchFn,
            nowFn,
            ttlMs: 3600 * 1000 // 1 hour
        });

        // First call triggers fetch
        const res1 = await manager.getCredentials();
        expect(fetchFn).toHaveBeenCalledTimes(1);
        expect(res1.iceServers).toEqual(mockServers);

        // Advance time by 30 minutes (within 1 hour)
        currentTime += 30 * 60 * 1000;
        const res2 = await manager.getCredentials();
        expect(fetchFn).toHaveBeenCalledTimes(1); // Cached!
        expect(res2).toBe(res1);

        // Advance time past 1 hour (70 minutes total)
        currentTime += 40 * 60 * 1000;
        const res3 = await manager.getCredentials();
        expect(fetchFn).toHaveBeenCalledTimes(2); // Refetched!
        expect(res3.iceServers).toEqual(mockServers);
    });

    it('coalesces concurrent in-flight requests into a single fetch', async () => {
        let resolveFetch;
        const fetchPromise = new Promise((resolve) => {
            resolveFetch = resolve;
        });

        const fetchFn = vi.fn().mockReturnValue(fetchPromise);
        const manager = new TurnCredentialManager({
            apiKey: 'key',
            appName: 'app',
            fetchFn
        });

        const p1 = manager.getCredentials();
        const p2 = manager.getCredentials();
        const p3 = manager.getCredentials();
        const p4 = manager.getCredentials();
        const p5 = manager.getCredentials();

        resolveFetch({
            ok: true,
            json: async () => [{ urls: 'turn:coalesced.metered.ca:443' }]
        });

        const [r1, r2, r3, r4, r5] = await Promise.all([p1, p2, p3, p4, p5]);

        expect(fetchFn).toHaveBeenCalledTimes(1);
        expect(r1.iceServers[0].urls).toBe('turn:coalesced.metered.ca:443');
        expect(r2).toBe(r1);
        expect(r3).toBe(r1);
        expect(r4).toBe(r1);
        expect(r5).toBe(r1);
    });

    it('falls back gracefully to STUN or stale cache if Metered API errors', async () => {
        // Initial failure with no cache
        const failingFetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 500,
            statusText: 'Internal Error'
        });

        const manager = new TurnCredentialManager({
            apiKey: 'key',
            appName: 'app',
            fetchFn: failingFetch
        });

        const result = await manager.getCredentials();
        expect(result).toEqual({ iceServers: DEFAULT_STUN_SERVERS });

        // Network throw
        const throwingFetch = vi.fn().mockRejectedValue(new Error('Network timeout'));
        const manager2 = new TurnCredentialManager({
            apiKey: 'key',
            appName: 'app',
            fetchFn: throwingFetch
        });

        const result2 = await manager2.getCredentials();
        expect(result2).toEqual({ iceServers: DEFAULT_STUN_SERVERS });
    });

    it('serves stale cache if a refresh attempt fails', async () => {
        let currentTime = 1000000;
        const cachedServers = [{ urls: 'turn:stale.relay.ca:443', username: 'u', credential: 'p' }];

        let shouldFail = false;
        const fetchFn = vi.fn().mockImplementation(async () => {
            if (shouldFail) {
                return { ok: false, status: 503, statusText: 'Service Unavailable' };
            }
            return { ok: true, json: async () => cachedServers };
        });

        const manager = new TurnCredentialManager({
            apiKey: 'key',
            appName: 'app',
            fetchFn,
            nowFn: () => currentTime,
            ttlMs: 3600 * 1000
        });

        const res1 = await manager.getCredentials();
        expect(res1.iceServers).toEqual(cachedServers);

        // Expire cache and fail the next fetch
        currentTime += 3600 * 1000 + 100;
        shouldFail = true;

        const res2 = await manager.getCredentials();
        // Returns stale cached data rather than throwing or losing connectivity
        expect(res2.iceServers).toEqual(cachedServers);
    });
});

describe('GET /api/turn-credentials endpoint and rate limiting', () => {
    it('handles requests to /api/turn-credentials and enforces rate limiting', async () => {
        // Reset the rate limiter
        const testIp = '198.51.100.42';
        turnLimiter.reset(testIp);

        // Mock express req/res
        const createMockReqRes = (ip) => {
            const req = {
                headers: { 'x-forwarded-for': ip },
                socket: { remoteAddress: ip }
            };
            const res = {
                statusCode: 200,
                headers: {},
                _data: null,
                status(code) {
                    this.statusCode = code;
                    return this;
                },
                json(data) {
                    this._data = data;
                    return this;
                }
            };
            return { req, res };
        };

        // Call the route handler directly
        const first = createMockReqRes(testIp);
        await handleTurnCredentials(first.req, first.res);
        expect(first.res.statusCode).toBe(200);
        expect(first.res._data).toHaveProperty('iceServers');

        // Consume all remaining tokens (capacity is 30)
        for (let i = 0; i < 35; i++) {
            const next = createMockReqRes(testIp);
            await handleTurnCredentials(next.req, next.res);
            if (next.res.statusCode === 429) {
                expect(next.res._data.error).toContain('Too many requests');
                return; // Rate limit successfully triggered!
            }
        }

        // If loop completes without 429, fail
        expect.unreachable('Expected rate limiter to return 429 status after token exhaustion');
    });

    it('sets Cache-Control: private, no-cache header on successful credential response', async () => {
        let headerName = null;
        let headerVal = null;
        const req = { headers: {}, socket: { remoteAddress: '127.0.0.1' } };
        const res = {
            statusCode: 200,
            setHeader(name, val) {
                headerName = name;
                headerVal = val;
            },
            status(code) {
                this.statusCode = code;
                return this;
            },
            json(data) {
                this._data = data;
                return this;
            }
        };

        await handleTurnCredentials(req, res);
        expect(res.statusCode).toBe(200);
        expect(headerName).toBe('Cache-Control');
        expect(headerVal).toBe('private, no-cache');
    });

    it('falls back to default STUN servers if Metered returns an empty array', async () => {
        const fetchFn = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => []
        });

        const manager = new TurnCredentialManager({
            apiKey: 'key',
            appName: 'app',
            fetchFn
        });

        const res = await manager.getCredentials();
        expect(res).toEqual({ iceServers: DEFAULT_STUN_SERVERS });
    });

    it('trims whitespace from apiKey and appName to prevent URL syntax errors', async () => {
        const fetchFn = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => [{ urls: 'stun:stun.metered.ca:80' }]
        });

        const manager = new TurnCredentialManager({
            apiKey: '   secret-key   \n',
            appName: '  my-app  \t',
            fetchFn
        });

        await manager.getCredentials();
        expect(fetchFn).toHaveBeenCalledWith('https://my-app.metered.ca/api/v1/turn/credentials?apiKey=secret-key');
    });
});
