// In-memory stand-ins for RTCPeerConnection, RTCDataChannel and the signaling
// socket, used to run two TransferEngines against each other in Node.
//
// Ordering contract (mirrors real browser behaviour the engine relies on):
// - ondatachannel fires synchronously when the offer is applied, before the
//   channel opens, so handlers are attached first.
// - channels open asynchronously after the transport is established.
// - messages are delivered asynchronously (never re-entrant with send()).

export class MockDataChannel {
    constructor(label) {
        this.label = label;
        this.readyState = 'connecting';
        this.binaryType = 'arraybuffer';
        this.bufferedAmount = 0;
        this.bufferedAmountLowThreshold = 0;
        this.peer = null;
        this.onopen = null;
        this.onmessage = null;
        this.onclose = null;
        this._listeners = new Map();
    }

    addEventListener(type, listener) {
        if (!this._listeners.has(type)) {
            this._listeners.set(type, new Set());
        }
        this._listeners.get(type).add(listener);
    }

    removeEventListener(type, listener) {
        this._listeners.get(type)?.delete(listener);
    }

    _emit(type, event) {
        this[`on${type}`]?.(event);
        this._listeners.get(type)?.forEach((listener) => listener(event));
    }

    send(data) {
        if (this.readyState !== 'open') {
            throw new Error('MockDataChannel.send on a non-open channel');
        }

        queueMicrotask(() => {
            this.peer._emit('message', { data });
        });
    }

    _openOne() {
        if (this.readyState !== 'connecting') return;
        this.readyState = 'open';
        this._emit('open', {});
    }

    _open() {
        this._openOne();
        this.peer?._openOne();
    }

    close() {
        if (this.readyState === 'closed') return;
        this.readyState = 'closed';
        this._emit('close', {});
        if (this.peer && this.peer.readyState !== 'closed') {
            this.peer.readyState = 'closed';
            this.peer._emit('close', {});
        }
    }
}

export class MockPeerConnection {
    constructor() {
        this.counterpart = null;
        this.connectionState = 'new';
        this.signalingState = 'stable';
        this.sctp = { maxMessageSize: 262144 };
        this.onicecandidate = null;
        this.onconnectionstatechange = null;
        this.ondatachannel = null;
        this._localChannels = [];
        this._undeliveredChannels = [];
    }

    createDataChannel(label) {
        const local = new MockDataChannel(label);
        const remote = new MockDataChannel(label);
        local.peer = remote;
        remote.peer = local;
        this._localChannels.push(local);

        if (this.connectionState === 'connected') {
            // In-band channel creation on a live connection: the remote side
            // learns about it directly and the pair opens shortly after.
            this.counterpart.ondatachannel?.({ channel: remote });
            queueMicrotask(() => local._open());
        } else {
            // Announced through the next offer.
            this._undeliveredChannels.push(remote);
        }

        return local;
    }

    async createOffer() {
        this._offerCount = (this._offerCount || 0) + 1;
        return { type: 'offer', sdp: `mock-offer-${this._offerCount}` };
    }

    async createAnswer() {
        return { type: 'answer', sdp: 'mock-answer' };
    }

    async setLocalDescription(description) {
        // Modern browsers auto-generate the description when called with no
        // argument (the perfect-negotiation idiom the engine relies on).
        if (!description) {
            description = this.remoteDescription?.type === 'offer'
                ? { type: 'answer', sdp: 'mock-answer' }
                : { type: 'offer', sdp: 'mock-offer-auto' };
        }

        this.localDescription = description;
        this.signalingState = description?.type === 'offer' ? 'have-local-offer' : 'stable';
    }

    async setRemoteDescription(description) {
        // Implicit rollback, as modern browsers do for perfect negotiation.
        this.signalingState = 'stable';
        this.remoteDescription = description;

        if (description?.type === 'offer') {
            const announced = this.counterpart?._undeliveredChannels.splice(0) || [];
            announced.forEach((channel) => {
                this.ondatachannel?.({ channel });
            });
        }

        if (description?.type === 'answer') {
            this._establish();
            this.counterpart?._establish();
        }
    }

    async addIceCandidate() {
        // Candidates are not simulated.
    }

    _establish() {
        if (this.connectionState === 'connected') return;
        this.connectionState = 'connected';
        this.onconnectionstatechange?.();
        this._localChannels.forEach((channel) => channel._open());
        this.counterpart?._localChannels.forEach((channel) => channel._open());
    }

    close() {
        this.connectionState = 'closed';
        [...this._localChannels].forEach((channel) => channel.close());
    }
}

// Installs an RTCPeerConnection global that pairs consecutive constructions,
// modelling a direct link between two test users.
export function installMockWebRTC() {
    const registry = { pending: null };

    globalThis.RTCPeerConnection = class extends MockPeerConnection {
        constructor(config) {
            super();
            this.config = config;

            if (registry.pending) {
                this.counterpart = registry.pending;
                registry.pending.counterpart = this;
                registry.pending = null;
            } else {
                registry.pending = this;
            }
        }
    };

    return registry;
}

// Minimal socket.io-like surface, routed through a shared bus by target id.
export class MockSocket {
    constructor(id, bus) {
        this.id = id;
        this.bus = bus;
        this.handlers = new Map();
        bus.sockets.set(id, this);
    }

    on(event, handler) {
        if (!this.handlers.has(event)) {
            this.handlers.set(event, new Set());
        }
        this.handlers.get(event).add(handler);
    }

    off(event) {
        this.handlers.delete(event);
    }

    emit(event, payload) {
        const target = this.bus.sockets.get(payload?.target);
        target?.receive(event, payload);
    }

    receive(event, payload) {
        this.handlers.get(event)?.forEach((handler) => handler(payload));
    }
}

export function createSocketBus() {
    return { sockets: new Map() };
}

export function createMockFile(name, size, type = 'application/octet-stream', seed = 0x2a, readDelayMs = 1) {
    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i += 1) {
        bytes[i] = (i + seed) % 251;
    }

    const buffer = bytes.buffer;

    return {
        name,
        size,
        type,
        slice(start, end) {
            const from = Math.min(start, size);
            const to = Math.min(end, size);
            const sliced = buffer.slice(from, to);
            if (readDelayMs <= 0) {
                return { arrayBuffer: async () => sliced };
            }
            // Pacing so tests can observe in-flight states.
            return {
                arrayBuffer: () => new Promise((resolve) => setTimeout(() => resolve(sliced), readDelayMs))
            };
        }
    };
}

// Waits for a condition. The predicate may return a boolean or a promise of
// one (async readiness checks).
export async function waitFor(predicate, { timeout = 5000, interval = 10, label = 'condition' } = {}) {
    const startedAt = Date.now();
    let result = await predicate();
    while (!result) {
        if (Date.now() - startedAt > timeout) {
            throw new Error(`Timed out waiting for ${label}`);
        }
        await new Promise((resolve) => setTimeout(resolve, interval));
        result = await predicate();
    }
    return result;
}
