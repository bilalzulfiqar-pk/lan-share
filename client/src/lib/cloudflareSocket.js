// Cloudflare Workers + Durable Objects WebSocket adapter.
// Exposes a Socket.IO-compatible surface for useSignaling and useWebRTC.

export function toWebSocketUrl(serverUrl) {
    let url = serverUrl || '';
    if (url.startsWith('http://')) {
        url = 'ws://' + url.slice('http://'.length);
    } else if (url.startsWith('https://')) {
        url = 'wss://' + url.slice('https://'.length);
    } else if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
        url = 'wss://' + url.replace(/^\/+/, '');
    }
    url = url.replace(/\/+$/, '');
    if (!url.endsWith('/ws')) {
        url += '/ws';
    }
    return url;
}

export function toHttpUrl(serverUrl) {
    let url = serverUrl || '';
    if (url.startsWith('ws://')) {
        url = 'http://' + url.slice('ws://'.length);
    } else if (url.startsWith('wss://')) {
        url = 'https://' + url.slice('wss://'.length);
    }
    url = url.replace(/\/ws\/?$/, '');
    return url.replace(/\/+$/, '');
}

export function shouldUseCloudflareSocket(url, signalingTransport) {
    if (signalingTransport === 'ws' || signalingTransport === 'cloudflare') {
        return true;
    }
    if (signalingTransport === 'socketio') {
        return false;
    }
    if (typeof url === 'string' && /\.workers\.dev(\/|$)/i.test(url)) {
        return true;
    }
    return false;
}

export function createCloudflareSocket(serverUrl) {
    const wsUrl = toWebSocketUrl(serverUrl);
    const httpUrl = toHttpUrl(serverUrl);

    const listeners = new Map();
    const pendingAcks = new Map();
    const messageQueue = [];

    let ws = null;
    let isManuallyDisconnected = false;
    let reconnectAttempts = 0;
    let reconnectTimer = null;
    let pingIntervalTimer = null;
    let ackCounter = 0;
    let hasConnectedBefore = false;

    function stopPingTimer() {
        if (pingIntervalTimer) {
            clearInterval(pingIntervalTimer);
            pingIntervalTimer = null;
        }
    }

    function startPingTimer() {
        stopPingTimer();
        pingIntervalTimer = setInterval(() => {
            const isOpen = ws && (ws.readyState === 1 || (typeof WebSocket !== 'undefined' && ws.readyState === WebSocket.OPEN));
            if (isOpen) {
                try {
                    ws.send(JSON.stringify({ type: 'ping' }));
                } catch (err) {
                    console.error('[cloudflareSocket] Failed to send keepalive ping:', err);
                }
            }
        }, 25000);

        if (pingIntervalTimer && typeof pingIntervalTimer.unref === 'function') {
            pingIntervalTimer.unref();
        }
    }

    function emitLocal(event, ...args) {
        const set = listeners.get(event);
        if (set) {
            Array.from(set).forEach((cb) => {
                try {
                    cb(...args);
                } catch (err) {
                    console.error(`[cloudflareSocket] Error in listener for "${event}":`, err);
                }
            });
        }
    }

    const socket = {
        id: null,
        connected: false,
        io: {
            uri: httpUrl,
            engine: {
                transport: { name: 'websocket' },
                on: () => {},
                off: () => {}
            }
        },

        on(event, callback) {
            if (typeof callback !== 'function') return socket;
            if (!listeners.has(event)) {
                listeners.set(event, new Set());
            }
            listeners.get(event).add(callback);
            return socket;
        },

        off(event, callback) {
            if (!listeners.has(event)) return socket;
            if (typeof callback === 'function') {
                const set = listeners.get(event);
                set.delete(callback);
                if (set.size === 0) {
                    listeners.delete(event);
                }
            } else {
                listeners.delete(event);
            }
            return socket;
        },

        emit(event, payload, ackCallback) {
            let ackId = undefined;
            if (typeof ackCallback === 'function') {
                ackId = `ack_${++ackCounter}_${Date.now()}`;
                pendingAcks.set(ackId, ackCallback);
            }

            const message = {
                type: event,
                data: payload,
                ...(ackId !== undefined ? { ackId } : {})
            };

            const payloadStr = JSON.stringify(message);

            const isOpen = ws && (ws.readyState === 1 || (typeof WebSocket !== 'undefined' && ws.readyState === WebSocket.OPEN));
            if (isOpen) {
                try {
                    ws.send(payloadStr);
                } catch (err) {
                    console.error(`[cloudflareSocket] Failed to send ${event}:`, err);
                }
            } else {
                messageQueue.push(payloadStr);
            }

            return socket;
        },

        disconnect() {
            isManuallyDisconnected = true;
            stopPingTimer();
            if (reconnectTimer) {
                clearTimeout(reconnectTimer);
                reconnectTimer = null;
            }
            messageQueue.length = 0;
            pendingAcks.clear();
            socket.connected = false;
            if (ws) {
                try {
                    ws.close();
                } catch {
                    // Ignore close errors during disconnect
                }
            }
            return socket;
        }
    };

    function scheduleReconnect() {
        if (reconnectTimer || isManuallyDisconnected) return;

        const delay = Math.min(5000, 1000 * Math.pow(2, reconnectAttempts));
        reconnectAttempts++;

        reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            connect();
        }, delay);
    }

    function connect() {
        if (isManuallyDisconnected) return;

        try {
            const WebSocketImpl = typeof WebSocket !== 'undefined' ? WebSocket : globalThis.WebSocket;
            if (!WebSocketImpl) {
                console.error('[cloudflareSocket] WebSocket is not available');
                return;
            }

            ws = new WebSocketImpl(wsUrl);

            ws.onopen = () => {
                // Connected state is finalized when the server sends the assigned socket ID
            };

            ws.onmessage = (event) => {
                let msg;
                try {
                    msg = typeof event.data === 'string'
                        ? JSON.parse(event.data)
                        : JSON.parse(new TextDecoder().decode(event.data));
                } catch {
                    return;
                }

                if (!msg || typeof msg !== 'object') return;

                if (msg.type === 'connected') {
                    socket.id = msg.id;
                    socket.connected = true;
                    hasConnectedBefore = true;
                    reconnectAttempts = 0;
                    startPingTimer();

                    // Flush any messages that were queued before connected
                    while (messageQueue.length > 0) {
                        const queued = messageQueue.shift();
                        try {
                            ws.send(queued);
                        } catch (err) {
                            console.error('[cloudflareSocket] Failed to send queued message:', err);
                        }
                    }

                    emitLocal('connect');
                    return;
                }

                if (msg.type === 'ack') {
                    const cb = pendingAcks.get(msg.ackId);
                    if (cb) {
                        pendingAcks.delete(msg.ackId);
                        try {
                            cb(msg.payload);
                        } catch (err) {
                            console.error('[cloudflareSocket] Error in ack callback:', err);
                        }
                    }
                    return;
                }

                if (msg.type === 'pong') {
                    return;
                }

                emitLocal(msg.type, msg.data);
            };

            ws.onerror = (err) => {
                if (!socket.connected && !hasConnectedBefore) {
                    emitLocal('connect_error', err);
                }
            };

            ws.onclose = () => {
                stopPingTimer();
                const wasConnected = socket.connected;
                socket.connected = false;

                if (wasConnected) {
                    emitLocal('disconnect');
                } else if (!hasConnectedBefore) {
                    emitLocal('connect_error', new Error('Failed to connect'));
                }

                if (!isManuallyDisconnected) {
                    scheduleReconnect();
                }
            };
        } catch (err) {
            if (!hasConnectedBefore) {
                emitLocal('connect_error', err);
            }
            if (!isManuallyDisconnected) {
                scheduleReconnect();
            }
        }
    }

    connect();

    return socket;
}
