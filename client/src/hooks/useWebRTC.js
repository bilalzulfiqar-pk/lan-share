import { useCallback, useEffect, useRef, useState } from 'react';
import { TransferEngine } from '../lib/transferEngine';

const ERROR_AUTO_CLEAR_MS = 6000;

// Thin React binding around TransferEngine. All connection and transfer logic
// lives in the engine; this hook only mirrors engine events into state.
export function useWebRTC(socket, myId, { getPeerName, onChat, onNotify, strictLocalMode: initialStrictLocalMode = false, soundEnabled = false } = {}) {
    const [history, setHistory] = useState([]);
    const [peerStatus, setPeerStatus] = useState({});
    const [connectionTypes, setConnectionTypes] = useState({});
    const [strictLocalMode, setStrictLocalMode] = useState(initialStrictLocalMode);
    const [error, setError] = useState(null);

    const engineRef = useRef(null);
    const getPeerNameRef = useRef(getPeerName);
    const onChatRef = useRef(onChat);
    const onNotifyRef = useRef(onNotify);
    const myIdRef = useRef(myId);
    const strictLocalModeRef = useRef(strictLocalMode);

    useEffect(() => {
        getPeerNameRef.current = getPeerName;
        onChatRef.current = onChat;
        onNotifyRef.current = onNotify;
    });

    // Keep myId updated in the engine without tearing down active WebRTC sessions
    useEffect(() => {
        myIdRef.current = myId;
        if (engineRef.current && myId) {
            engineRef.current.updateMyId(myId);
        }
    }, [myId]);

    // Keep strictLocalMode updated in engine
    useEffect(() => {
        strictLocalModeRef.current = strictLocalMode;
        if (engineRef.current) {
            engineRef.current.setStrictLocalMode(strictLocalMode);
        }
    }, [strictLocalMode]);

    // Keep soundEnabled updated in engine
    useEffect(() => {
        if (engineRef.current) {
            engineRef.current.setSoundEnabled(soundEnabled);
        }
    }, [soundEnabled]);

    useEffect(() => {
        if (!socket) return undefined;

        const engine = new TransferEngine({
            socket,
            myId: myIdRef.current,
            strictLocalMode: strictLocalModeRef.current,
            soundEnabled,
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
                    case 'connection-type':
                        setConnectionTypes((prev) => ({ ...prev, [event.peerId]: event.connectionType }));
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
    }, [socket]);

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

    const getConnectionType = useCallback((peerId) => {
        return connectionTypes[peerId] || engineRef.current?.getConnectionType(peerId) || 'direct-lan';
    }, [connectionTypes]);

    return {
        history,
        peerStatus,
        connectionTypes,
        strictLocalMode,
        setStrictLocalMode,
        error,
        sendFilesOffer,
        requestFile,
        saveReceivedFile,
        cancelTransfer,
        sendChat,
        getConnectionType
    };
}
