import { useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';

const SIGNALING_SERVER_PORT = 3001;
const DEVICE_ID_STORAGE_KEY = 'lan-share-device-id';
const DISCOVERY_ICE_SERVERS = [
    {
        urls: [
            'stun:stun.l.google.com:19302',
            'stun:stun1.l.google.com:19302'
        ]
    }
];

export function parseRoomFromHash(hash) {
    if (typeof hash !== 'string' || !hash) return null;
    const cleanHash = hash.startsWith('#') ? hash.slice(1) : hash;
    const match = cleanHash.match(/(?:^|[/?&;#])room=([A-Za-z0-9_-]+)(?:[/?&;#]|$)/i);
    if (match && match[1]) {
        return match[1].slice(0, 16).toUpperCase();
    }
    return null;
}

function createDeviceId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }

    return `device-${Math.random().toString(36).slice(2, 12)}`;
}

function getOrCreateDeviceId() {
    const existingDeviceId = localStorage.getItem(DEVICE_ID_STORAGE_KEY);
    if (existingDeviceId) {
        return existingDeviceId;
    }

    const newDeviceId = createDeviceId();
    localStorage.setItem(DEVICE_ID_STORAGE_KEY, newDeviceId);
    return newDeviceId;
}

function extractPrivateIpv4(candidateValue) {
    if (typeof candidateValue !== 'string') {
        return null;
    }

    const match = candidateValue.match(/\b(\d{1,3}(?:\.\d{1,3}){3})\b/);
    if (!match) {
        return null;
    }

    const ip = match[1];
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
        return null;
    }

    const [first, second] = parts;
    const isPrivateRange =
        first === 10 ||
        (first === 172 && second >= 16 && second <= 31) ||
        (first === 192 && second === 168);

    return isPrivateRange ? ip : null;
}

function extractIpv4(candidateValue) {
    if (typeof candidateValue !== 'string') {
        return null;
    }

    const match = candidateValue.match(/\b(\d{1,3}(?:\.\d{1,3}){3})\b/);
    if (!match) {
        return null;
    }

    const ip = match[1];
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
        return null;
    }

    return ip;
}

function getLanFingerprint(ipAddress) {
    const parts = ipAddress.split('.');
    if (parts.length !== 4) {
        return null;
    }

    return `lan:ipv4:${parts[0]}.${parts[1]}.${parts[2]}`;
}

function getWanFingerprint(ipAddress) {
    return ipAddress ? `wan:ipv4:${ipAddress}` : null;
}

function parseCandidateType(candidateValue) {
    if (typeof candidateValue !== 'string') {
        return null;
    }

    const match = candidateValue.match(/\btyp\s+([a-z0-9]+)/i);
    return match ? match[1].toLowerCase() : null;
}

function collectFingerprintsFromCandidate(candidate) {
    if (!candidate) {
        return [];
    }

    const candidateValue = candidate.candidate || '';
    const candidateType = candidate.type || parseCandidateType(candidateValue);
    const fingerprints = [];

    const candidateAddress = extractIpv4(candidate.address) || extractIpv4(candidateValue);
    const privateAddress =
        extractPrivateIpv4(candidate.address) ||
        extractPrivateIpv4(candidate.relatedAddress) ||
        extractPrivateIpv4(candidateValue);

    if (privateAddress && (candidateType === 'host' || !candidateType)) {
        const lanFingerprint = getLanFingerprint(privateAddress);
        if (lanFingerprint) {
            fingerprints.push(lanFingerprint);
        }
    }

    if (candidateType === 'srflx' || candidateType === 'prflx') {
        const wanFingerprint = getWanFingerprint(candidateAddress);
        if (wanFingerprint) {
            fingerprints.push(wanFingerprint);
        }
    }

    return fingerprints;
}

async function detectLocalNetworkFingerprints() {
    if (typeof RTCPeerConnection === 'undefined') {
        return [];
    }

    const pc = new RTCPeerConnection({ iceServers: DISCOVERY_ICE_SERVERS });
    const fingerprints = new Set();

    return new Promise((resolve) => {
        let settled = false;
        const timeout = window.setTimeout(finish, 3000);

        function finish() {
            if (settled) {
                return;
            }

            settled = true;
            window.clearTimeout(timeout);
            pc.close();

            resolve(Array.from(fingerprints).sort());
        }

        pc.onicecandidate = (event) => {
            if (!event.candidate) {
                finish();
                return;
            }

            collectFingerprintsFromCandidate(event.candidate).forEach((fingerprint) => {
                fingerprints.add(fingerprint);
            });
        };

        pc.onicegatheringstatechange = () => {
            if (pc.iceGatheringState === 'complete') {
                finish();
            }
        };

        pc.createDataChannel('network-probe');
        pc.createOffer()
            .then((offer) => pc.setLocalDescription(offer))
            .catch(() => finish());
    });
}

export function useSignaling(displayName) {
    const [socket, setSocket] = useState(null);
    const [peers, setPeers] = useState([]);
    const [isConnected, setIsConnected] = useState(false);
    const [isReconnecting, setIsReconnecting] = useState(false); // Track reconnection attempts
    const [myId, setMyId] = useState(null);
    const [connectionStartTime, setConnectionStartTime] = useState(() => Date.now());
    const [networkFingerprints, setNetworkFingerprints] = useState([]);
    const [deviceId] = useState(() => getOrCreateDeviceId());
    const [serverUrl, setServerUrl] = useState('');
    const [transportName, setTransportName] = useState('pending');
    const [roomCode, setRoomCode] = useState(() => {
        if (typeof window !== 'undefined' && window.location.hash) {
            return parseRoomFromHash(window.location.hash);
        }
        return null;
    });
    const currentRoomRef = useRef(roomCode);
    useEffect(() => {
        currentRoomRef.current = roomCode;
    }, [roomCode]);
    const joinedThisConnectionRef = useRef(false);
    const [serverDebug, setServerDebug] = useState({
        publicIp: null,
        networkFingerprints: [],
        deviceId: null,
        roomCode: null,
        visiblePeers: []
    });

    const joinRoom = useCallback((code) => {
        if (!code) return;
        const sanitized = String(code).replace(/\s+/g, '').toUpperCase().slice(0, 16);
        if (!/^[A-Z0-9_-]+$/.test(sanitized)) return;

        currentRoomRef.current = sanitized;
        setRoomCode(sanitized);
        if (typeof window !== 'undefined') {
            const targetHash = `#room=${sanitized}`;
            if (window.location.hash !== targetHash) {
                window.location.hash = targetHash;
            }
        }
        if (socket && isConnected) {
            socket.emit('join-room', { roomCode: sanitized });
        }
    }, [socket, isConnected]);

    const leaveRoom = useCallback(() => {
        currentRoomRef.current = null;
        setRoomCode(null);
        if (typeof window !== 'undefined' && window.location.hash) {
            if (window.location.hash.includes('room=')) {
                const cleanHash = window.location.hash
                    .replace(/(?:^#|[&;?])room=[^&;#]*/i, '')
                    .replace(/^[&;?]/, '');
                const targetUrl = window.location.pathname + window.location.search + (cleanHash ? '#' + cleanHash : '');
                history.replaceState(null, '', targetUrl);
            }
        }
        if (socket && isConnected) {
            socket.emit('leave-room');
        }
    }, [socket, isConnected]);

    // Keep roomCode synchronized with window hash changes
    useEffect(() => {
        if (typeof window === 'undefined') return;

        const handleHashChange = () => {
            const newRoom = parseRoomFromHash(window.location.hash);
            if (newRoom === currentRoomRef.current) {
                return;
            }

            currentRoomRef.current = newRoom;
            setRoomCode(newRoom);

            if (socket && isConnected) {
                if (newRoom) {
                    socket.emit('join-room', { roomCode: newRoom });
                } else {
                    socket.emit('leave-room');
                }
            }
        };

        window.addEventListener('hashchange', handleHashChange);
        return () => window.removeEventListener('hashchange', handleHashChange);
    }, [socket, isConnected]);

    useEffect(() => {
        let cancelled = false;

        detectLocalNetworkFingerprints().then((fingerprints) => {
            if (!cancelled) {
                setNetworkFingerprints(fingerprints);
            }
        });

        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        // Connect to server on the same hostname but port 3001
        // Priority 1: Environment Variable (for production/custom setup)
        const envUrl = import.meta.env.VITE_SERVER_URL;

        // Priority 2: Auto-detect (for local LAN development)
        const protocol = window.location.protocol;
        const hostname = window.location.hostname;
        const localUrl = `${protocol}//${hostname}:${SIGNALING_SERVER_PORT}`;

        const url = envUrl || localUrl;

        console.log("Connecting to signaling server:", url);
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setServerUrl(url);

        const newSocket = io(url);

        newSocket.on('connect', () => {
            console.log('Connected to signaling server', newSocket.id);
            setIsConnected(true);
            setIsReconnecting(false);
            setMyId(newSocket.id);
            setTransportName(newSocket.io.engine.transport.name);

            newSocket.io.engine.on('upgrade', (transport) => {
                setTransportName(transport.name);
            });
        });

        newSocket.on('disconnect', () => {
            console.log('Disconnected from signaling server');
            setIsConnected(false);
            setIsReconnecting(true); // Mark as trying to reconnect
            setConnectionStartTime(Date.now()); // Reset timer on disconnect to track reconnection time
            setPeers([]);
            setTransportName('disconnected');
        });

        newSocket.on('users-update', (users) => {
            // Filter out self
            setPeers(users.filter(u => u.id !== newSocket.id));
        });

        newSocket.on('debug-state', (payload) => {
            setServerDebug({
                publicIp: payload?.publicIp || null,
                networkFingerprints: Array.isArray(payload?.networkFingerprints) ? payload.networkFingerprints : [],
                deviceId: payload?.deviceId || null,
                roomCode: payload?.roomCode || null,
                visiblePeers: Array.isArray(payload?.visiblePeers) ? payload.visiblePeers : []
            });
        });

        setSocket(newSocket);

        return () => {
            newSocket.off('debug-state');
            newSocket.disconnect();
        };
    }, []); // Only run once on mount (connection logic)

    // Join immediately when the connection comes up, then debounce updates so
    // typing a new display name does not spam the server on every keystroke.
    useEffect(() => {
        if (!socket || !isConnected) {
            joinedThisConnectionRef.current = false;
            return;
        }

        if (!joinedThisConnectionRef.current) {
            joinedThisConnectionRef.current = true;
            socket.emit('join', {
                name: displayName,
                networkFingerprints,
                deviceId,
                roomCode: roomCode || undefined
            });
            return;
        }

        const timer = window.setTimeout(() => {
            socket.emit('join', {
                name: displayName,
                networkFingerprints,
                deviceId,
                roomCode: roomCode || undefined
            });
        }, 400);

        return () => window.clearTimeout(timer);
    }, [deviceId, displayName, socket, isConnected, networkFingerprints, roomCode]);

    return {
        socket,
        peers,
        isConnected,
        isReconnecting,
        connectionStartTime,
        myId,
        roomCode,
        joinRoom,
        leaveRoom,
        debugInfo: {
            deviceId,
            serverUrl,
            transportName,
            localNetworkFingerprints: networkFingerprints,
            roomCode,
            serverDebug,
            userAgent: navigator.userAgent
        }
    };
}
