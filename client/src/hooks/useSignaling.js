import { useEffect, useState, useRef } from 'react';
import { io } from 'socket.io-client';

const SIGNALING_SERVER_PORT = 3001;

export function useSignaling(displayName) {
    const [socket, setSocket] = useState(null);
    const [peers, setPeers] = useState([]);
    const [isConnected, setIsConnected] = useState(false);
    const [myId, setMyId] = useState(null);

    useEffect(() => {
        // Connect to server on the same hostname but port 3001
        const protocol = window.location.protocol;
        const hostname = window.location.hostname;
        const url = `${protocol}//${hostname}:${SIGNALING_SERVER_PORT}`;

        console.log("Connecting to signaling server:", url);

        const newSocket = io(url);

        newSocket.on('connect', () => {
            console.log('Connected to signaling server', newSocket.id);
            setIsConnected(true);
            setMyId(newSocket.id);
            // Join with initial name
            newSocket.emit('join', displayName);
        });

        newSocket.on('disconnect', () => {
            console.log('Disconnected from signaling server');
            setIsConnected(false);
            setPeers([]);
        });

        newSocket.on('users-update', (users) => {
            // Filter out self
            setPeers(users.filter(u => u.id !== newSocket.id));
        });

        setSocket(newSocket);

        return () => {
            newSocket.disconnect();
        };
    }, []); // Only run once on mount (connection logic)

    // Handle name updates if socket is connected
    useEffect(() => {
        if (socket && isConnected) {
            socket.emit('join', displayName);
        }
    }, [displayName, socket, isConnected]);

    return { socket, peers, isConnected, myId };
}
