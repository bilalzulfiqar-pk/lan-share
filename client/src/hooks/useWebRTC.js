import { useCallback, useEffect, useRef, useState } from 'react';
import { TransferEngine } from '../lib/transferEngine';

const ERROR_AUTO_CLEAR_MS = 6000;

// Thin React binding around TransferEngine. All connection and transfer logic
// lives in the engine; this hook only mirrors engine events into state.
export function useWebRTC(socket, myId, { getPeerName, onChat, onNotify } = {}) {
    const [history, setHistory] = useState([]);
    const [peerStatus, setPeerStatus] = useState({});
    const [error, setError] = useState(null);

    const engineRef = useRef(null);
    const getPeerNameRef = useRef(getPeerName);
    const onChatRef = useRef(onChat);
    const onNotifyRef = useRef(onNotify);

    useEffect(() => {
        getPeerNameRef.current = getPeerName;
        onChatRef.current = onChat;
        onNotifyRef.current = onNotify;
    });

    useEffect(() => {
        if (!socket || !myId) return undefined;

        const engine = new TransferEngine({
            socket,
            myId,
            getPeerName: (peerId) => getPeerNameRef.current?.(peerId) || 'Unknown',
            onEvent: (event) => {
                switch (event.type) {
                    case 'history:add':
                        setHistory((prev) => [...prev, ...event.items]);
                        break;
                    case 'history:update':
                        setHistory((prev) => prev.map((item) => (
                            item.id === event.id ? { ...item, ...event.updates } : item
                        )));
                        break;
                    case 'peer-status':
                        setPeerStatus((prev) => ({ ...prev, [event.peerId]: event.status }));
                        break;
                    case 'error':
                        setError(event.message);
                        break;
                    case 'chat':
                        onChatRef.current?.(event.peerId, event.message);
                        break;
                    case 'notify':
                        onNotifyRef.current?.(event);
                        break;
                }
            }
        });

        engineRef.current = engine;

        return () => {
            engine.destroy();
            engineRef.current = null;
        };
    }, [socket, myId]);

    useEffect(() => {
        if (!error) return undefined;
        const timer = window.setTimeout(() => setError(null), ERROR_AUTO_CLEAR_MS);
        return () => window.clearTimeout(timer);
    }, [error]);

    const sendFilesOffer = useCallback((peerId, files) => {
        engineRef.current?.offerFiles(peerId, files);
    }, []);

    const requestFile = useCallback((fileId) => {
        engineRef.current?.requestFile(fileId);
    }, []);

    const saveReceivedFile = useCallback((fileId, fileName) => {
        engineRef.current?.saveReceivedFile(fileId, fileName);
    }, []);

    const cancelTransfer = useCallback((fileId) => {
        engineRef.current?.cancelTransfer(fileId);
    }, []);

    const sendChat = useCallback((peerId, text) => {
        engineRef.current?.sendChat(peerId, text);
    }, []);

    return {
        history,
        peerStatus,
        error,
        sendFilesOffer,
        requestFile,
        saveReceivedFile,
        cancelTransfer,
        sendChat
    };
}
