const DEFAULT_STUN_SERVERS = [
    {
        urls: [
            'stun:stun.l.google.com:19302',
            'stun:stun1.l.google.com:19302'
        ]
    }
];

class TurnCredentialManager {
    constructor({
        apiKey = null,
        appName = null,
        fetchFn = null,
        nowFn = () => Date.now(),
        ttlMs = 60 * 60 * 1000 // 1 hour in-memory cache
    } = {}) {
        this.apiKey = apiKey;
        this.appName = appName;
        this.fetchFn = fetchFn;
        this.nowFn = nowFn;
        this.ttlMs = ttlMs;
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
                const url = `https://${encodeURIComponent(appName)}.metered.ca/api/v1/turn/credentials?apiKey=${encodeURIComponent(apiKey)}`;
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
                        return this.cachedData;
                    }
                    return { iceServers: DEFAULT_STUN_SERVERS };
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
                    return this.cachedData;
                }
                return { iceServers: DEFAULT_STUN_SERVERS };
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

function createTurnCredentialsHandler({ manager, limiter, getClientIp = (headers, addr) => addr || '127.0.0.1' }) {
    return async function handleTurnCredentials(req, res) {
        const headers = req?.headers || {};
        const clientIp = getClientIp(headers, req?.socket?.remoteAddress);
        if (limiter && !limiter.tryConsume(clientIp)) {
            return res.status(429).json({ error: 'Too many requests for TURN credentials. Please wait.' });
        }

        try {
            const credentials = await manager.getCredentials();
            if (typeof res.setHeader === 'function') {
                res.setHeader('Cache-Control', 'private, no-cache');
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

