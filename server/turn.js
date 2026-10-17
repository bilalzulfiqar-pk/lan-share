const DEFAULT_STUN_SERVERS = [
    {
        urls: [
            'stun:stun.l.google.com:19302',
            'stun:stun1.l.google.com:19302'
        ]
    },
    {
        urls: [
            'stun:stun.cloudflare.com:3478'
        ]
    }
];

const DEFAULT_NEGATIVE_TTL_MS = 60 * 1000; // 1 minute negative cache backoff on Metered failure

class TurnCredentialManager {
    constructor({
        apiKey = null,
        appName = null,
        fetchFn = null,
        nowFn = () => Date.now(),
        ttlMs = 60 * 60 * 1000, // 1 hour in-memory cache
        negativeTtlMs = DEFAULT_NEGATIVE_TTL_MS
    } = {}) {
        this.apiKey = apiKey;
        this.appName = appName;
        this.fetchFn = fetchFn;
        this.nowFn = nowFn;
        this.ttlMs = ttlMs;
        this.negativeTtlMs = negativeTtlMs;
        this.cachedData = null;
        this.expiresAt = 0;
        this.pendingFetchPromise = null;
    }

    _resolveApiKey() {
        const val = (this.apiKey !== null && this.apiKey !== undefined) ? this.apiKey : process.env.METERED_API_KEY;
        return typeof val === 'string' ? val.trim() : null;
    }

    _resolveAppName() {
        const val = (this.appName !== null && this.appName !== undefined) ? this.appName : process.env.METERED_APP_NAME;
        return typeof val === 'string' ? val.trim() : null;
    }

    async getCredentials({ forceRefresh = false } = {}) {
        const apiKey = this._resolveApiKey();
        const appName = this._resolveAppName();

        if (!apiKey || !appName) {
            return { iceServers: DEFAULT_STUN_SERVERS };
        }

        const now = this.nowFn();
        if (!forceRefresh && this.cachedData && now < this.expiresAt) {
            return this.cachedData;
        }

        if (this.pendingFetchPromise) {
            return this.pendingFetchPromise;
        }

        const fetcher = this.fetchFn || globalThis.fetch;
        if (typeof fetcher !== 'function') {
            return { iceServers: DEFAULT_STUN_SERVERS };
        }

        this.pendingFetchPromise = (async () => {
            let timeoutId = null;
            try {
                let host = appName.replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim();
                if (!host.includes('.')) {
                    host = `${host}.metered.live`;
                } else if (host.endsWith('.metered.ca')) {
                    host = host.replace(/\.metered\.ca$/, '.metered.live');
                }
                const url = `https://${host}/api/v1/turn/credentials?apiKey=${encodeURIComponent(apiKey)}`;
                let res;
                if (typeof AbortController !== 'undefined' && fetcher === globalThis.fetch) {
                    const controller = new AbortController();
                    timeoutId = setTimeout(() => controller.abort(), 8000);
                    res = await fetcher(url, { signal: controller.signal });
                } else {
                    res = await fetcher(url);
                }

                if (!res.ok) {
                    console.error(`[TURN] Metered API error: HTTP ${res.status}`);
                    if (this.cachedData) {
                        this.expiresAt = this.nowFn() + this.negativeTtlMs;
                        return this.cachedData;
                    }
                    this.cachedData = { iceServers: DEFAULT_STUN_SERVERS };
                    this.expiresAt = this.nowFn() + this.negativeTtlMs;
                    return this.cachedData;
                }

                const data = await res.json();
                const rawServers = Array.isArray(data)
                    ? data
                    : (Array.isArray(data?.iceServers) ? data.iceServers : null);

                const iceServers = (rawServers && rawServers.length > 0)
                    ? rawServers
                    : DEFAULT_STUN_SERVERS;

                this.cachedData = { iceServers };
                this.expiresAt = this.nowFn() + this.ttlMs;
                return this.cachedData;
            } catch (err) {
                console.error('[TURN] Failed to fetch Metered credentials:', err.message || err);
                if (this.cachedData) {
                    this.expiresAt = this.nowFn() + this.negativeTtlMs;
                    return this.cachedData;
                }
                this.cachedData = { iceServers: DEFAULT_STUN_SERVERS };
                this.expiresAt = this.nowFn() + this.negativeTtlMs;
                return this.cachedData;
            } finally {
                if (timeoutId) {
                    clearTimeout(timeoutId);
                }
                this.pendingFetchPromise = null;
            }
        })();

        return this.pendingFetchPromise;
    }

    clearCache() {
        this.cachedData = null;
        this.expiresAt = 0;
        this.pendingFetchPromise = null;
    }
}

function createTurnCredentialsHandler({ manager, limiter, getClientIp = (headers, addr) => addr || '127.0.0.1', isValidSocket = () => false }) {
    return async function handleTurnCredentials(req, res) {
        const headers = req?.headers || {};
        const clientIp = req?.ip ? String(req.ip).replace(/^::ffff:/i, '') : getClientIp(headers, req?.socket?.remoteAddress);

        const socketId = req?.query?.socketId;
        const limiterKey = (socketId && typeof isValidSocket === 'function' && isValidSocket(socketId, clientIp))
            ? `socket:${socketId}`
            : clientIp;

        if (limiter && !limiter.tryConsume(limiterKey)) {
            return res.status(429).json({
                error: 'Too many requests for TURN credentials. Please wait.',
                iceServers: DEFAULT_STUN_SERVERS
            });
        }

        try {
            const credentials = await manager.getCredentials();
            if (typeof res.setHeader === 'function') {
                res.setHeader('Cache-Control', 'public, max-age=1800');
            }
            return res.json(credentials);
        } catch (err) {
            console.error('[TURN] Unexpected error fetching credentials:', err);
            return res.status(500).json({ error: 'Internal server error', iceServers: DEFAULT_STUN_SERVERS });
        }
    };
}

module.exports = {
    DEFAULT_STUN_SERVERS,
    TurnCredentialManager,
    createTurnCredentialsHandler
};

