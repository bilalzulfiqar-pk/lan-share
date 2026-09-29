import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TransferEngine } from '../transferEngine';
import {
    RELAY_MAX_FILE_SIZE_BYTES,
    RELAY_SIZE_LIMIT_ERROR,
    STRICT_LOCAL_RELAY_BLOCKED_ERROR,
    FILE_STATUS
} from '../protocol';
import {
    installMockWebRTC,
    createSocketBus,
    MockSocket,
    createMockFile,
    waitFor
} from './harness.mjs';

describe('WebRTC Connection Type Detection & Strict Local Mode', () => {
    let bus;
    let socketA;
    let engineA;
    let peerAId;
    let peerBId;

    beforeEach(() => {
        installMockWebRTC();
        bus = createSocketBus();
        peerAId = 'peer-a-1111';
        peerBId = 'peer-b-2222';
        socketA = new MockSocket(peerAId, bus);
    });

    afterEach(() => {
        engineA?.destroy();
    });

    it('detects relay-turn, direct-stun, and direct-lan from getStats', () => {
        engineA = new TransferEngine({
            socket: socketA,
            myId: peerAId,
            fetchTurnCredentials: false
        });

        // 1. Relay pair
        const mockRelayStats = new Map([
            ['pair-1', {
                type: 'candidate-pair',
                selected: true,
                localCandidateId: 'local-1',
                remoteCandidateId: 'remote-1'
            }],
            ['local-1', { candidateType: 'relay' }],
            ['remote-1', { candidateType: 'host' }]
        ]);
        expect(engineA.parseConnectionType(mockRelayStats)).toBe('relay-turn');

        // 2. STUN pair
        const mockStunStats = new Map([
            ['pair-2', {
                type: 'candidate-pair',
                selected: true,
                localCandidateId: 'local-2',
                remoteCandidateId: 'remote-2'
            }],
            ['local-2', { candidateType: 'srflx' }],
            ['remote-2', { candidateType: 'srflx' }]
        ]);
        expect(engineA.parseConnectionType(mockStunStats)).toBe('direct-stun');

        // 3. Direct LAN pair
        const mockLanStats = new Map([
            ['pair-3', {
                type: 'candidate-pair',
                selected: true,
                localCandidateId: 'local-3',
                remoteCandidateId: 'remote-3'
            }],
            ['local-3', { candidateType: 'host' }],
            ['remote-3', { candidateType: 'host' }]
        ]);
        expect(engineA.parseConnectionType(mockLanStats)).toBe('direct-lan');

        // 4. Plain array/object reports without .get method
        const arrayStats = [
            { type: 'transport', selectedCandidatePairId: 'pair-arr' },
            { id: 'pair-arr', type: 'candidate-pair', localCandidateId: 'loc-arr', remoteCandidateId: 'rem-arr' },
            { id: 'loc-arr', candidateType: 'relay' },
            { id: 'rem-arr', candidateType: 'host' }
        ];
        expect(engineA.parseConnectionType(arrayStats)).toBe('relay-turn');
    });

    it('filters out relay candidates when strictLocalMode is enabled', async () => {
        const emitSpy = vi.spyOn(socketA, 'emit');

        engineA = new TransferEngine({
            socket: socketA,
            myId: peerAId,
            strictLocalMode: true,
            fetchTurnCredentials: false
        });

        const session = engineA.getOrCreateSession(peerBId);

        // Simulate local ICE candidate generation
        // Host candidate should be emitted
        session.pc.onicecandidate({
            candidate: { candidate: 'candidate:1 1 UDP 12345 192.168.1.50 5000 typ host', type: 'host' }
        });
        expect(emitSpy).toHaveBeenCalledWith('ice-candidate', expect.objectContaining({
            target: peerBId,
            candidate: expect.objectContaining({ type: 'host' })
        }));

        emitSpy.mockClear();

        // Relay candidate should be STRIPPED and NOT emitted
        session.pc.onicecandidate({
            candidate: { candidate: 'candidate:2 1 UDP 12345 104.28.1.1 5000 typ relay', type: 'relay' }
        });
        expect(emitSpy).not.toHaveBeenCalled();

        // Inbound relay candidate should be dropped in handleIceCandidate
        const addIceSpy = vi.spyOn(session.pc, 'addIceCandidate');
        session.remoteDescriptionSet = true;

        await engineA.handleIceCandidate({
            sender: peerBId,
            candidate: { candidate: 'candidate:3 1 UDP 12345 104.28.1.1 5000 typ relay', type: 'relay' }
        });
        expect(addIceSpy).not.toHaveBeenCalled();

        // Inbound host candidate should be accepted
        await engineA.handleIceCandidate({
            sender: peerBId,
            candidate: { candidate: 'candidate:4 1 UDP 12345 192.168.1.60 5000 typ host', type: 'host' }
        });
        expect(addIceSpy).toHaveBeenCalledTimes(1);
    });

    it('strips relay candidates from remote offer and answer SDP when in strictLocalMode', async () => {
        engineA = new TransferEngine({
            socket: socketA,
            myId: peerAId,
            strictLocalMode: true,
            fetchTurnCredentials: false
        });

        const sdpWithRelay = 'v=0\r\na=candidate:1 1 UDP 12345 104.28.1.1 5000 typ relay\r\na=candidate:2 1 UDP 12345 192.168.1.10 5000 typ host\r\n';

        let capturedRemoteDesc = null;
        const mockPc = {
            signalingState: 'stable',
            setRemoteDescription: vi.fn(async (desc) => { capturedRemoteDesc = desc; }),
            setLocalDescription: vi.fn(async () => {}),
            createOffer: vi.fn(async () => ({ type: 'offer', sdp: '' })),
            localDescription: { type: 'answer', sdp: '' },
            createDataChannel: vi.fn(() => ({})),
            getStats: vi.fn(async () => []),
            setConfiguration: vi.fn(),
            close: vi.fn()
        };

        const session = engineA.getOrCreateSession(peerBId);
        session.pc = mockPc;

        await engineA.handleOffer({
            sender: peerBId,
            offer: { type: 'offer', sdp: sdpWithRelay }
        });

        expect(capturedRemoteDesc).not.toBeNull();
        expect(capturedRemoteDesc.sdp).not.toContain('typ relay');
        expect(capturedRemoteDesc.sdp).toContain('typ host');
    });

    it('updates pc.setConfiguration when setTurnCredentials or setStrictLocalMode is called', () => {
        engineA = new TransferEngine({
            socket: socketA,
            myId: peerAId,
            fetchTurnCredentials: false
        });

        const session = engineA.getOrCreateSession(peerBId);
        session.pc.setConfiguration = vi.fn();

        engineA.setTurnCredentials({
            iceServers: [{ urls: 'turn:metered.ca:443', username: 'u', credential: 'p' }]
        });

        expect(session.pc.setConfiguration).toHaveBeenCalledWith(expect.objectContaining({
            iceServers: expect.arrayContaining([
                expect.objectContaining({ urls: 'turn:metered.ca:443' })
            ])
        }));

        engineA.setStrictLocalMode(true);
        expect(session.pc.setConfiguration).toHaveBeenCalledWith(expect.objectContaining({
            iceServers: expect.not.arrayContaining([
                expect.objectContaining({ urls: 'turn:metered.ca:443' })
            ])
        }));
    });
});

describe('Relay 150 MB Quota Protection', () => {
    let bus;
    let socketA;
    let socketB;
    let engineA;
    let engineB;
    let peerAId;
    let peerBId;
    let historyA = [];
    let historyB = [];
    let errorsA = [];

    beforeEach(async () => {
        installMockWebRTC();
        bus = createSocketBus();
        peerAId = 'peer-a-1234';
        peerBId = 'peer-b-5678';
        historyA = [];
        historyB = [];
        errorsA = [];

        socketA = new MockSocket(peerAId, bus);
        socketB = new MockSocket(peerBId, bus);

        engineA = new TransferEngine({
            socket: socketA,
            myId: peerAId,
            fetchTurnCredentials: false,
            onEvent: (event) => {
                if (event.type === 'history:add') historyA.push(...event.items);
                if (event.type === 'history:update') {
                    historyA = historyA.map((it) => (it.id === event.id ? { ...it, ...event.updates } : it));
                }
                if (event.type === 'error') errorsA.push(event.message);
            }
        });

        engineB = new TransferEngine({
            socket: socketB,
            myId: peerBId,
            fetchTurnCredentials: false,
            onEvent: (event) => {
                if (event.type === 'history:add') historyB.push(...event.items);
                if (event.type === 'history:update') {
                    historyB = historyB.map((it) => (it.id === event.id ? { ...it, ...event.updates } : it));
                }
            }
        });

        // Establish connection
        const sessionA = engineA.getOrCreateSession(peerBId);
        await waitFor(() => sessionA.channelReady, { label: 'sessionA channelReady' });
    });

    afterEach(() => {
        engineA?.destroy();
        engineB?.destroy();
    });

    it('blocks offering files larger than 150 MB ONLY when connection is relay-turn', () => {
        const sessionA = engineA.sessions.get(peerBId);
        sessionA.connectionType = 'relay-turn';

        const largeFile = createMockFile('massive-video.mp4', 200 * 1024 * 1024); // 200 MB
        engineA.offerFiles(peerBId, [largeFile]);

        // File should immediately be blocked
        expect(historyA).toHaveLength(1);
        expect(historyA[0].status).toBe(FILE_STATUS.BLOCKED);
        expect(historyA[0].error).toBe(RELAY_SIZE_LIMIT_ERROR);
        expect(errorsA).toContain(RELAY_SIZE_LIMIT_ERROR);

        // Peer B should NOT receive any offer for the blocked file
        expect(historyB).toHaveLength(0);
    });

    it('allows files larger than 150 MB when connection is direct-lan or direct-stun', async () => {
        const sessionA = engineA.sessions.get(peerBId);
        sessionA.connectionType = 'direct-lan';

        const largeFile = createMockFile('large-dataset.bin', 300 * 1024 * 1024); // 300 MB
        engineA.offerFiles(peerBId, [largeFile]);

        expect(historyA).toHaveLength(1);
        expect(historyA[0].status).toBe(FILE_STATUS.OFFERED);

        await waitFor(() => historyB.length > 0, { label: 'peer B receives offer' });
        expect(historyB[0].fileName).toBe('large-dataset.bin');
        expect(historyB[0].status).toBe('idle');
    });

    it('dynamically blocks pending files if connection resolves to relay-turn after offer', () => {
        const sessionA = engineA.sessions.get(peerBId);
        sessionA.connectionType = 'direct-lan';

        const fileA = createMockFile('small.pdf', 10 * 1024 * 1024); // 10 MB (allowed)
        const fileB = createMockFile('giant.iso', 500 * 1024 * 1024); // 500 MB (blocked on relay)

        // Queue in pendingOfferFiles
        sessionA.pendingOfferFiles = [
            { id: 'f-1', name: fileA.name, size: fileA.size },
            { id: 'f-2', name: fileB.name, size: fileB.size }
        ];

        // Connection switches to relay
        sessionA.connectionType = 'relay-turn';
        engineA.checkRelayCapForSession(sessionA);

        // Small file remains pending; large file was dropped from pendingOfferFiles
        expect(sessionA.pendingOfferFiles).toHaveLength(1);
        expect(sessionA.pendingOfferFiles[0].id).toBe('f-1');
        expect(errorsA).toContain(RELAY_SIZE_LIMIT_ERROR);
    });

    it('blocks receiver from requesting an oversized file over relay-turn', async () => {
        const sessionB = engineB.sessions.get(peerAId);
        sessionB.connectionType = 'relay-turn';

        // Simulate incoming offer
        engineB.handleFilesOffer(sessionB, [
            { id: 'incoming-oversized', name: 'large.zip', size: 180 * 1024 * 1024, type: 'application/zip' }
        ]);

        expect(historyB).toHaveLength(1);
        expect(historyB[0].status).toBe(FILE_STATUS.BLOCKED);
        expect(historyB[0].error).toBe(RELAY_SIZE_LIMIT_ERROR);

        // Attempting to request should be blocked
        await engineB.requestFile('incoming-oversized');
        expect(historyB[0].status).toBe(FILE_STATUS.BLOCKED);
    });

    it('blocks ANY file transfer (even small files) when connection is relay-turn and strictLocalMode is enabled', async () => {
        engineA.setStrictLocalMode(true);
        const sessionA = engineA.sessions.get(peerBId);
        sessionA.connectionType = 'relay-turn';

        const tinyFile = createMockFile('tiny.txt', 1024); // 1 KB
        engineA.offerFiles(peerBId, [tinyFile]);

        expect(historyA).toHaveLength(1);
        expect(historyA[0].status).toBe(FILE_STATUS.BLOCKED);
        expect(historyA[0].error).toBe(STRICT_LOCAL_RELAY_BLOCKED_ERROR);
        expect(errorsA).toContain(STRICT_LOCAL_RELAY_BLOCKED_ERROR);
    });

    it('dynamically blocks active and pending files when strictLocalMode is enabled on relay connection', () => {
        const sessionA = engineA.sessions.get(peerBId);
        sessionA.connectionType = 'relay-turn';

        const regularFile = createMockFile('document.pdf', 5 * 1024 * 1024);
        sessionA.pendingOfferFiles = [
            { id: 'f-reg', name: regularFile.name, size: regularFile.size }
        ];

        // Toggling strictLocalMode should trigger checkRelayCapForSession and block the pending files
        engineA.setStrictLocalMode(true);

        expect(sessionA.pendingOfferFiles).toHaveLength(0);
        expect(errorsA).toContain(STRICT_LOCAL_RELAY_BLOCKED_ERROR);
    });
});

