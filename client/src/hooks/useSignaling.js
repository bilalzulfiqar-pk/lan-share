import { useEffect, useRef, useState } from 'react';
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
    const joinedThisConnectionRef = useRef(false);
    const [serverDebug, setServerDebug] = useState({
        publicIp: null,
        networkFingerprints: [],
        deviceId: null,
        visiblePeers: []
    });

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
                deviceId
            });
            return;
        }

        const timer = window.setTimeout(() => {
            socket.emit('join', {
                name: displayName,
                networkFingerprints,
                deviceId
            });
        }, 400);

        return () => window.clearTimeout(timer);
    }, [deviceId, displayName, socket, isConnected, networkFingerprints]);

    return {
        socket,
        peers,
        isConnected,
        isReconnecting,
        connectionStartTime,
        myId,
        debugInfo: {
            deviceId,
            serverUrl,
            transportName,
            localNetworkFingerprints: networkFingerprints,
            serverDebug,
            userAgent: navigator.userAgent
        }
    };
}
