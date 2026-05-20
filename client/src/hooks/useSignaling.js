import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';

const SIGNALING_SERVER_PORT = 3001;
const DEVICE_ID_STORAGE_KEY = 'lan-share-device-id';

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

function getSubnetFingerprint(ipAddress) {
    const parts = ipAddress.split('.');
    if (parts.length !== 4) {
        return null;
    }

    return `ipv4:${parts[0]}.${parts[1]}.${parts[2]}`;
}

async function detectLocalNetworkFingerprint() {
    if (typeof RTCPeerConnection === 'undefined') {
        return null;
    }

    const pc = new RTCPeerConnection({ iceServers: [] });
    const fingerprints = new Set();

    return new Promise((resolve) => {
        let settled = false;
        const timeout = window.setTimeout(finish, 1500);

        function finish() {
            if (settled) {
                return;
            }

            settled = true;
            window.clearTimeout(timeout);
            pc.close();

            const fingerprint = Array.from(fingerprints).sort()[0] || null;
            resolve(fingerprint);
        }

        pc.onicecandidate = (event) => {
            if (!event.candidate) {
                finish();
                return;
            }

            const ipAddress =
                extractPrivateIpv4(event.candidate.address) ||
                extractPrivateIpv4(event.candidate.candidate);
            const fingerprint = ipAddress ? getSubnetFingerprint(ipAddress) : null;

            if (fingerprint) {
                fingerprints.add(fingerprint);
            }
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
    const [networkFingerprint, setNetworkFingerprint] = useState(null);
    const [deviceId] = useState(() => getOrCreateDeviceId());

    useEffect(() => {
        let cancelled = false;

        detectLocalNetworkFingerprint().then((fingerprint) => {
            if (!cancelled) {
                setNetworkFingerprint(fingerprint);
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

        const newSocket = io(url);

        newSocket.on('connect', () => {
            console.log('Connected to signaling server', newSocket.id);
            setIsConnected(true);
            setIsReconnecting(false);
            setMyId(newSocket.id);
        });

        newSocket.on('disconnect', () => {
            console.log('Disconnected from signaling server');
            setIsConnected(false);
            setIsReconnecting(true); // Mark as trying to reconnect
            setConnectionStartTime(Date.now()); // Reset timer on disconnect to track reconnection time
            setPeers([]);
        });

        newSocket.on('users-update', (users) => {
            // Filter out self
            setPeers(users.filter(u => u.id !== newSocket.id));
        });

        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSocket(newSocket);

        return () => {
            newSocket.disconnect();
        };
    }, []); // Only run once on mount (connection logic)

    // Handle name updates if socket is connected
    useEffect(() => {
        if (socket && isConnected) {
            socket.emit('join', {
                name: displayName,
                networkFingerprint,
                deviceId
            });
        }
    }, [deviceId, displayName, socket, isConnected, networkFingerprint]);

    return { socket, peers, isConnected, isReconnecting, connectionStartTime, myId };
}
