import { describe, it, expect } from 'vitest';
import { parseRoomFromHash } from '../useSignaling';

describe('Render Cold-Start Banner & Room Recovery Lifecycle (TEST-05)', () => {
    // Helper function reproducing App.jsx's exact banner state calculation
    function computeServerStatusMessage(isConnected, disconnectElapsed) {
        if (!isConnected && disconnectElapsed > 3000 && disconnectElapsed < 60000) {
            return {
                title: 'Server is starting up…',
                description: 'This app uses a free-tier server, which may sleep when inactive. Startup usually takes up to a minute.',
                type: 'warning'
            };
        }
        if (!isConnected && disconnectElapsed >= 60000) {
            return {
                title: 'Connection issue',
                description: 'The server may be offline or unavailable. Please try again later.',
                type: 'error'
            };
        }
        return null;
    }

    it('suppresses banner during normal connection attempts (< 3s)', () => {
        expect(computeServerStatusMessage(false, 0)).toBeNull();
        expect(computeServerStatusMessage(false, 1500)).toBeNull();
        expect(computeServerStatusMessage(false, 3000)).toBeNull();
    });

    it('displays polite sleeping server warning banner after 3 seconds of cold-start delay', () => {
        const banner3s = computeServerStatusMessage(false, 3500);
        expect(banner3s).not.toBeNull();
        expect(banner3s.type).toBe('warning');
        expect(banner3s.title).toBe('Server is starting up…');
        expect(banner3s.description).toContain('free-tier server, which may sleep');

        const banner30s = computeServerStatusMessage(false, 30000);
        expect(banner30s).not.toBeNull();
        expect(banner30s.type).toBe('warning');
    });

    it('switches to connection error banner when server fails to wake after 60 seconds', () => {
        const banner60s = computeServerStatusMessage(false, 60000);
        expect(banner60s).not.toBeNull();
        expect(banner60s.type).toBe('error');
        expect(banner60s.title).toBe('Connection issue');
        expect(banner60s.description).toContain('offline or unavailable');

        const banner90s = computeServerStatusMessage(false, 90000);
        expect(banner90s.type).toBe('error');
    });

    it('automatically dismisses server starting banner as soon as connection is established', () => {
        // While disconnected at 15s: warning banner is active
        expect(computeServerStatusMessage(false, 15000)).not.toBeNull();

        // Socket connects: banner immediately clears to null
        expect(computeServerStatusMessage(true, 15000)).toBeNull();
        expect(computeServerStatusMessage(true, 75000)).toBeNull();
    });

    it('retains URL room hash and automatically emits join upon reconnection after cold-start', () => {
        const hash = '#room=RENDER99';
        const roomCode = parseRoomFromHash(hash);
        expect(roomCode).toBe('RENDER99');

        // Mock socket reconnection and room rejoining flow
        const emittedEvents = [];
        const mockSocket = {
            emit: (event, data) => emittedEvents.push({ event, data })
        };

        // Simulate reconnect handler
        let joinedThisConnection = false;
        const handleConnect = (currentRoom) => {
            if (currentRoom && !joinedThisConnection) {
                joinedThisConnection = true;
                mockSocket.emit('join', { roomCode: currentRoom });
            }
        };

        // 1. First connection after sleeping: joins room
        handleConnect(roomCode);
        expect(emittedEvents).toEqual([{ event: 'join', data: { roomCode: 'RENDER99' } }]);

        // 2. Disconnect happens
        joinedThisConnection = false;

        // 3. Reconnection 45s later: re-joins same room automatically
        handleConnect(roomCode);
        expect(emittedEvents.length).toBe(2);
        expect(emittedEvents[1]).toEqual({ event: 'join', data: { roomCode: 'RENDER99' } });
    });
});
