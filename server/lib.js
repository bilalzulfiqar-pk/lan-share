// Pure signaling-server logic. Kept free of I/O so it can be unit tested.

const MAX_NAME_LENGTH = 32;
const MAX_FINGERPRINTS = 12;
const MAX_DEVICE_ID_LENGTH = 128;

function sanitizeName(name) {
    if (typeof name !== 'string') {
        return 'Unknown Device';
    }

    const normalized = name.trim().slice(0, MAX_NAME_LENGTH);
    return normalized || 'Unknown Device';
}

function sanitizeNetworkFingerprint(networkFingerprint) {
    if (typeof networkFingerprint !== 'string') {
        return null;
    }

    const normalized = networkFingerprint.trim().toLowerCase().slice(0, 64);
    return /^[a-z0-9:.-]+$/.test(normalized) ? normalized : null;
}

function sanitizeNetworkFingerprints(value) {
    if (!Array.isArray(value)) {
        return [];
    }

    return Array.from(new Set(
        value
            .map(sanitizeNetworkFingerprint)
            .filter(Boolean)
    )).slice(0, MAX_FINGERPRINTS);
}

function sanitizeDeviceId(deviceId) {
    if (typeof deviceId !== 'string') {
        return null;
    }

    const normalized = deviceId.trim().toLowerCase().slice(0, MAX_DEVICE_ID_LENGTH);
    return /^[a-z0-9-]+$/.test(normalized) ? normalized : null;
}

function normalizeJoinPayload(payload) {
    if (typeof payload === 'string') {
        return {
            name: sanitizeName(payload),
            networkFingerprint: null,
            networkFingerprints: [],
            deviceId: null
        };
    }

    if (payload && typeof payload === 'object') {
        const networkFingerprints = sanitizeNetworkFingerprints(payload.networkFingerprints);
        const legacyFingerprint = sanitizeNetworkFingerprint(payload.networkFingerprint);

        if (legacyFingerprint && !networkFingerprints.includes(legacyFingerprint)) {
            networkFingerprints.push(legacyFingerprint);
        }

        return {
            name: sanitizeName(payload.name),
            networkFingerprint: networkFingerprints[0] || null,
            networkFingerprints,
            deviceId: sanitizeDeviceId(payload.deviceId)
        };
    }

    return {
        name: 'Unknown Device',
        networkFingerprint: null,
        networkFingerprints: [],
        deviceId: null
    };
}

// The public IP is read from x-forwarded-for. Reverse proxies (Render et al.)
// append the real client IP to the end of the chain, while the leading entries
// are client-controlled and only meaningful for hop-by-hop proxies we do not
// run — so the last entry is the trustworthy one.
function getClientIp(headers, fallbackAddress = '') {
    const forwardedFor = headers['x-forwarded-for'];
    if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
        const lastEntry = forwardedFor.split(',').pop().trim();
        if (lastEntry) {
            return lastEntry;
        }
    }

    return fallbackAddress.replace(/^::ffff:/, '');
}

function detectDeviceType(userAgent) {
    if (typeof userAgent !== 'string') {
        return 'desktop';
    }

    return /Android|iPhone|iPad|iPod|Mobile|Opera Mini|IEMobile/i.test(userAgent)
        ? 'mobile'
        : 'desktop';
}

function splitFingerprints(networkFingerprints = []) {
    return {
        lan: networkFingerprints.filter((fingerprint) => fingerprint.startsWith('lan:')),
        wan: networkFingerprints.filter((fingerprint) => fingerprint.startsWith('wan:'))
    };
}

function hasOverlap(leftValues, rightValues) {
    return leftValues.some((value) => rightValues.includes(value));
}

function areUsersVisible(leftUser, rightUser) {
    if (!leftUser || !rightUser) {
        return false;
    }

    const leftFingerprints = leftUser.networkFingerprints || [];
    const rightFingerprints = rightUser.networkFingerprints || [];
    const leftFingerprintGroups = splitFingerprints(leftFingerprints);
    const rightFingerprintGroups = splitFingerprints(rightFingerprints);
    const leftHasLan = leftFingerprintGroups.lan.length > 0;
    const rightHasLan = rightFingerprintGroups.lan.length > 0;
    const leftHasWan = leftFingerprintGroups.wan.length > 0;
    const rightHasWan = rightFingerprintGroups.wan.length > 0;
    const bothHaveLan = leftHasLan && rightHasLan;
    const bothHaveWan = leftHasWan && rightHasWan;
    const sharesWanFingerprint = hasOverlap(leftFingerprintGroups.wan, rightFingerprintGroups.wan);
    const sharesLanFingerprint = hasOverlap(leftFingerprintGroups.lan, rightFingerprintGroups.lan);
    const sharesHttpPublicIp =
        Boolean(leftUser.publicIp) &&
        Boolean(rightUser.publicIp) &&
        leftUser.publicIp === rightUser.publicIp;

    // Strongest signal: both browsers exposed the same LAN subnet.
    if (bothHaveLan && sharesLanFingerprint) {
        return true;
    }

    // Next strongest signal: both browsers independently discovered the same
    // public network identity through ICE/STUN.
    if (bothHaveWan && sharesWanFingerprint) {
        return true;
    }

    if (!sharesHttpPublicIp) {
        return false;
    }

    // If one browser only exposed LAN and the other only exposed WAN, or one
    // side exposed nothing at all, keep the same-public-IP fallback instead of
    // hiding a device that was valid moments earlier.
    if (!bothHaveLan || !bothHaveWan) {
        return true;
    }

    // Both devices exposed comparable fingerprint types but none matched, so
    // they are likely not on the same local network segment.
    return false;
}

function createVisibleUser(user) {
    return {
        id: user.id,
        name: user.name,
        deviceId: user.deviceId,
        deviceType: user.deviceType
    };
}

function getVisibleUsersFor(users, user, candidateIds = null) {
    if (!user) {
        return [];
    }

    const candidates = candidateIds
        ? candidateIds.map((id) => users[id]).filter(Boolean)
        : Object.values(users);

    return candidates
        .filter((candidate) => candidate.id !== user.id && areUsersVisible(user, candidate))
        .map(createVisibleUser);
}

function isValidSessionDescription(value, expectedType) {
    return Boolean(
        value &&
        typeof value === 'object' &&
        value.type === expectedType &&
        typeof value.sdp === 'string' &&
        value.sdp.length > 0 &&
        value.sdp.length <= 32 * 1024
    );
}

function isValidIceCandidate(value) {
    return Boolean(
        value &&
        typeof value === 'object' &&
        typeof value.candidate === 'string' &&
        value.candidate.length > 0 &&
        value.candidate.length <= 1024
    );
}

// Token-bucket rate limiter. Keys are opaque strings (socket ids).
function createRateLimiter({ capacity = 40, refillPerSecond = 20, maxEntries = 5000 } = {}) {
    const buckets = new Map();

    function prune(now) {
        for (const [key, bucket] of buckets) {
            if (now - bucket.last > 5 * 60 * 1000) {
                buckets.delete(key);
            }
        }
    }

    return {
        tryConsume(key, cost = 1) {
            const now = Date.now();

            if (buckets.size > maxEntries) {
                prune(now);
            }

            let bucket = buckets.get(key);
            if (!bucket) {
                bucket = { tokens: capacity, last: now };
                buckets.set(key, bucket);
            }

            const elapsedSeconds = (now - bucket.last) / 1000;
            bucket.tokens = Math.min(capacity, bucket.tokens + elapsedSeconds * refillPerSecond);
            bucket.last = now;

            if (bucket.tokens >= cost) {
                bucket.tokens -= cost;
                return true;
            }

            return false;
        },
        reset(key) {
            buckets.delete(key);
        }
    };
}

// Inverted index for fast candidate lookup. Maps network similarity keys
// (public IP, LAN fingerprints, WAN fingerprints) to sets of socket IDs.
// Reduces global N^2 visibility comparisons to O(M^2) within matching subnets.
class SimilarityIndex {
    constructor() {
        this.index = new Map();
        this.socketKeys = new Map();
    }

    _getKeysFor(user) {
        const keys = new Set();
        if (user && user.publicIp) {
            keys.add(`ip:${user.publicIp}`);
        }
        if (user && Array.isArray(user.networkFingerprints)) {
            for (const fp of user.networkFingerprints) {
                if (typeof fp === 'string' && fp.trim()) {
                    keys.add(`fp:${fp.trim().toLowerCase()}`);
                }
            }
        }
        return keys;
    }

    addUser(user) {
        if (!user || !user.id) return;
        this.removeUser(user.id);

        const keys = this._getKeysFor(user);
        this.socketKeys.set(user.id, keys);

        for (const key of keys) {
            let bucket = this.index.get(key);
            if (!bucket) {
                bucket = new Set();
                this.index.set(key, bucket);
            }
            bucket.add(user.id);
        }
    }

    removeUser(socketId) {
        if (!socketId) return;
        const keys = this.socketKeys.get(socketId);
        if (!keys) return;

        for (const key of keys) {
            const bucket = this.index.get(key);
            if (bucket) {
                bucket.delete(socketId);
                if (bucket.size === 0) {
                    this.index.delete(key);
                }
            }
        }

        this.socketKeys.delete(socketId);
    }

    getCandidateIdsFor(user) {
        if (!user || !user.id) return [];
        const keys = this._getKeysFor(user);
        const candidates = new Set();

        for (const key of keys) {
            const bucket = this.index.get(key);
            if (bucket) {
                for (const socketId of bucket) {
                    if (socketId !== user.id) {
                        candidates.add(socketId);
                    }
                }
            }
        }

        return Array.from(candidates);
    }

    getAffectedSocketIds(user) {
        if (!user || !user.id) return [];
        const candidates = this.getCandidateIdsFor(user);
        candidates.push(user.id);
        return candidates;
    }
}

module.exports = {
    sanitizeName,
    sanitizeNetworkFingerprint,
    sanitizeNetworkFingerprints,
    sanitizeDeviceId,
    normalizeJoinPayload,
    getClientIp,
    detectDeviceType,
    splitFingerprints,
    hasOverlap,
    areUsersVisible,
    createVisibleUser,
    getVisibleUsersFor,
    isValidSessionDescription,
    isValidIceCandidate,
    createRateLimiter,
    SimilarityIndex
};
