import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TransferEngine } from '../transferEngine';
import { MODE_CONFIG } from '../connectionModes';
import {
    RELAY_MAX_FILE_SIZE_BYTES,
    RELAY_SIZE_LIMIT_ERROR,
    STRICT_LOCAL_RELAY_BLOCKED_ERROR,
    FILE_STATUS,
    stripRelayFromSdp
} from '../protocol';
import {
    installMockWebRTC,
    createSocketBus,
    MockSocket,
    waitFor
} from './harness.mjs';

function createVirtualFile(name, size, type = 'application/octet-stream') {
    return {
        name,
        size,
        type,
        slice: (start, end) => ({
            arrayBuffer: async () => new ArrayBuffer(Math.max(0, Math.min(size, end) - start))
        })
    };
}

function lastUpdateFor(events, id) {
    const updates = events.filter((event) => event.type === 'history:update' && event.id === id);
    return updates[updates.length - 1]?.updates;
}

function firstAddedItem(events) {
    return events.find((event) => event.type === 'history:add')?.items[0];
}

describe('Simulated Network Scenarios (TEST-01 to TEST-04)', () => {
    let bus;
    let socketA;
    let socketB;
    let engineA;
    let engineB;
    let eventsA;
    let eventsB;

    beforeEach(() => {
        installMockWebRTC();
        bus = createSocketBus();
        socketA = new MockSocket('alice', bus);
        socketB = new MockSocket('bob', bus);
        eventsA = [];
        eventsB = [];
    });

    afterEach(() => {
        engineA?.destroy();
        engineB?.destroy();
    });

    // TEST-01: Scenario A - Home Wi-Fi LAN (host candidates)
    it('TEST-01: Home LAN host pair classifies as direct-lan and permits multi-GB file transfer', async () => {
        engineA = new TransferEngine({
            socket: socketA,
            myId: 'alice',
            getPeerName: () => 'Bob',
            onEvent: (event) => eventsA.push(event),
            fetchTurnCredentials: false
        });

        engineB = new TransferEngine({
            socket: socketB,
            myId: 'bob',
            getPeerName: () => 'Alice',
            onEvent: (event) => eventsB.push(event),
            fetchTurnCredentials: false
        });

        // Mock W3C transport stats with selectedCandidatePairId pointing to host pair
        const mockLanStats = new Map([
            ['transport-0', {
                type: 'transport',
                selectedCandidatePairId: 'pair-lan'
            }],
            ['pair-lan', {
                id: 'pair-lan',
                type: 'candidate-pair',
                state: 'succeeded',
                nominated: true,
                localCandidateId: 'cand-loc',
                remoteCandidateId: 'cand-rem'
            }],
            ['cand-loc', { id: 'cand-loc', type: 'local-candidate', candidateType: 'host' }],
            ['cand-rem', { id: 'cand-rem', type: 'remote-candidate', candidateType: 'host' }]
        ]);

        const sessionA = engineA.getOrCreateSession('bob');
        sessionA.pc.getStats = vi.fn(async () => mockLanStats);

        const connType = await engineA.detectConnectionType(sessionA);
        expect(connType).toBe('direct-lan');
        expect(sessionA.connectionType).toBe('direct-lan');
        expect(MODE_CONFIG['direct-lan'].label).toBe('Local Wi-Fi Transfer');

        // Offer a 4 GB file (exceeds the 150 MB relay cap by ~27x)
        const fourGbFile = createVirtualFile('archive-4gb.iso', 4 * 1024 * 1024 * 1024, 'application/x-iso9660-image');
        engineA.offerFiles('bob', [fourGbFile]);

        const offeredId = await waitFor(() => firstAddedItem(eventsA)?.id, { label: 'offered file' });
        const historyItem = firstAddedItem(eventsA);

        // Assert 4 GB file is allowed (NOT blocked) because connection is direct-lan
        expect(historyItem.status).not.toBe(FILE_STATUS.BLOCKED);
        expect(engineA.outgoing.has(offeredId)).toBe(true);
        expect(lastUpdateFor(eventsA, offeredId)?.status).not.toBe(FILE_STATUS.BLOCKED);
    });

    // TEST-02: Scenario B - Cross-VLAN Direct Internet (srflx STUN)
    it('TEST-02: Cross-VLAN srflx pair classifies as direct-stun and allows cross-subnet room pairing', async () => {
        engineA = new TransferEngine({
            socket: socketA,
            myId: 'alice',
            getPeerName: () => 'Bob',
            onEvent: (event) => eventsA.push(event),
            fetchTurnCredentials: false
        });

        // Mock srflx candidate pair
        const mockStunStats = [
            {
                type: 'transport',
                selectedCandidatePairId: 'pair-stun'
            },
            {
                id: 'pair-stun',
                type: 'candidate-pair',
                state: 'succeeded',
                nominated: true,
                localCandidateId: 'cand-srflx-loc',
                remoteCandidateId: 'cand-srflx-rem'
            },
            { id: 'cand-srflx-loc', candidateType: 'srflx' },
            { id: 'cand-srflx-rem', candidateType: 'srflx' }
        ];

        const sessionA = engineA.getOrCreateSession('bob');
        sessionA.pc.getStats = vi.fn(async () => mockStunStats);

        const connType = await engineA.detectConnectionType(sessionA);
        expect(connType).toBe('direct-stun');
        expect(MODE_CONFIG['direct-stun'].label).toBe('Direct Internet Transfer');

        // In direct-stun, files larger than 150 MB are still permitted
        const largeFile = createVirtualFile('dataset-500mb.tar', 500 * 1024 * 1024, 'application/x-tar');
        engineA.offerFiles('bob', [largeFile]);

        const fileId = await waitFor(() => firstAddedItem(eventsA)?.id, { label: 'offered file' });
        expect(engineA.outgoing.has(fileId)).toBe(true);
        expect(firstAddedItem(eventsA).status).not.toBe(FILE_STATUS.BLOCKED);
    });

    // TEST-03: Scenario C - AP Isolation & Corporate Firewall (relay TURN)
    it('TEST-03: Relay TURN connection notifies user, allows 50 MB, and blocks 200 MB file', async () => {
        let notifiedEvent = null;
        engineA = new TransferEngine({
            socket: socketA,
            myId: 'alice',
            getPeerName: () => 'Bob',
            onEvent: (event) => {
                eventsA.push(event);
                if (event.type === 'notify' && event.title === 'Cloud Relay Active') {
                    notifiedEvent = event;
                }
            },
            fetchTurnCredentials: false
        });

        const mockRelayStats = new Map([
            ['transport-0', {
                type: 'transport',
                selectedCandidatePairId: 'pair-relay'
            }],
            ['pair-relay', {
                id: 'pair-relay',
                type: 'candidate-pair',
                state: 'succeeded',
                nominated: true,
                localCandidateId: 'cand-relay-loc',
                remoteCandidateId: 'cand-rem'
            }],
            ['cand-relay-loc', { id: 'cand-relay-loc', candidateType: 'relay' }],
            ['cand-rem', { id: 'cand-rem', candidateType: 'host' }]
        ]);

        const sessionA = engineA.getOrCreateSession('bob');
        sessionA.pc.getStats = vi.fn(async () => mockRelayStats);

        const connType = await engineA.detectConnectionType(sessionA);
        expect(connType).toBe('relay-turn');
        expect(MODE_CONFIG['relay-turn'].label).toBe('Cloud Relay Transfer');

        // Verify clear non-blocking user notification is emitted
        expect(notifiedEvent).not.toBeNull();
        expect(notifiedEvent.title).toBe('Cloud Relay Active');
        expect(notifiedEvent.body).toContain('AP Isolation');
        expect(notifiedEvent.body).toContain('150 MB max per file');

        // 50 MB file (<= 150 MB cap) must SUCCEED over relay
        const smallFile = createVirtualFile('project-50mb.zip', 50 * 1024 * 1024, 'application/zip');
        engineA.offerFiles('bob', [smallFile]);
        const smallId = await waitFor(() => eventsA.find((e) => e.type === 'history:add' && e.items[0]?.fileName === 'project-50mb.zip')?.items[0]?.id);
        expect(engineA.outgoing.has(smallId)).toBe(true);

        // 200 MB file (> 150 MB cap) must be strictly BLOCKED before streaming
        const largeFile = createVirtualFile('backup-200mb.bin', 200 * 1024 * 1024, 'application/octet-stream');
        engineA.offerFiles('bob', [largeFile]);
        const largeItem = eventsA.find((e) => e.type === 'history:add' && e.items[0]?.fileName === 'backup-200mb.bin')?.items[0];

        expect(largeItem).toBeDefined();
        expect(largeItem.status).toBe(FILE_STATUS.BLOCKED);
        expect(largeItem.error).toBe(RELAY_SIZE_LIMIT_ERROR);
        expect(engineA.outgoing.has(largeItem.id)).toBe(false); // Cleaned from outgoing
    });

    // TEST-04: Scenario D - Strict Local Mode Under AP Isolation
    it('TEST-04: Strict Local Mode strips relay candidates and rejects all non-local relay transfers', async () => {
        engineA = new TransferEngine({
            socket: socketA,
            myId: 'alice',
            getPeerName: () => 'Bob',
            onEvent: (event) => eventsA.push(event),
            strictLocalMode: true,
            fetchTurnCredentials: false
        });

        const sessionA = engineA.getOrCreateSession('bob');

        // 1. Assert relay candidates in signaling are dropped by handleIceCandidate
        const socketEmitSpy = vi.spyOn(socketA, 'emit');
        const relayCandidate = {
            candidate: 'candidate:3 1 UDP 16777215 203.0.113.5 3478 typ relay raddr 198.51.100.1 rport 5002',
            sdpMid: '0',
            sdpMLineIndex: 0
        };

        sessionA.pc.onicecandidate?.({ candidate: relayCandidate });
        // Under strictLocalMode, relay candidate must NOT be emitted to peer
        expect(socketEmitSpy).not.toHaveBeenCalledWith('ice-candidate', expect.anything());

        // 2. Assert SDP stripping removes typ relay
        const sdp = [
            'v=0',
            'a=candidate:1 1 UDP 2130706431 192.168.1.10 5000 typ host',
            'a=candidate:2 1 UDP 16777215 203.0.113.5 3478 typ relay raddr 198.51.100.1 rport 5002'
        ].join('\r\n');

        const strippedSdp = stripRelayFromSdp(sdp);
        expect(strippedSdp).toContain('typ host');
        expect(strippedSdp).not.toContain('typ relay');

        // 3. If forced to relay-turn, even a tiny 1 MB file is blocked with STRICT_LOCAL_RELAY_BLOCKED_ERROR
        sessionA.connectionType = 'relay-turn';
        const tinyFile = createVirtualFile('note.txt', 1024, 'text/plain');
        engineA.offerFiles('bob', [tinyFile]);

        const blockedItem = eventsA.find((e) => e.type === 'history:add' && e.items[0]?.fileName === 'note.txt')?.items[0];
        expect(blockedItem.status).toBe(FILE_STATUS.BLOCKED);
        expect(blockedItem.error).toBe(STRICT_LOCAL_RELAY_BLOCKED_ERROR);
    });

    // TEST-05: prflx candidate pair with private LAN IPs resolves to direct-lan
    it('TEST-05: prflx candidate pair with RFC 1918 private IPs classifies as direct-lan', async () => {
        engineA = new TransferEngine({
            socket: socketA,
            myId: 'alice',
            getPeerName: () => 'Bob',
            onEvent: (event) => eventsA.push(event),
            fetchTurnCredentials: false
        });

        const mockPrflxStats = new Map([
            ['transport-0', {
                type: 'transport',
                selectedCandidatePairId: 'pair-prflx'
            }],
            ['pair-prflx', {
                id: 'pair-prflx',
                type: 'candidate-pair',
                state: 'succeeded',
                nominated: true,
                localCandidateId: 'cand-loc',
                remoteCandidateId: 'cand-rem'
            }],
            ['cand-loc', {
                id: 'cand-loc',
                type: 'local-candidate',
                candidateType: 'host',
                address: 'laptop.local'
            }],
            ['cand-rem', {
                id: 'cand-rem',
                type: 'remote-candidate',
                candidateType: 'prflx',
                address: '192.168.1.105'
            }]
        ]);

        const sessionA = engineA.getOrCreateSession('bob');
        sessionA.pc.getStats = vi.fn(async () => mockPrflxStats);

        const connType = await engineA.detectConnectionType(sessionA);
        expect(connType).toBe('direct-lan');
        expect(sessionA.connectionType).toBe('direct-lan');

        // Both prflx candidates on private subnet
        const mockBothPrflxStats = new Map([
            ['transport-0', {
                type: 'transport',
                selectedCandidatePairId: 'pair-both-prflx'
            }],
            ['pair-both-prflx', {
                id: 'pair-both-prflx',
                type: 'candidate-pair',
                state: 'succeeded',
                nominated: true,
                localCandidateId: 'cand-loc-prflx',
                remoteCandidateId: 'cand-rem-prflx'
            }],
            ['cand-loc-prflx', {
                id: 'cand-loc-prflx',
                candidateType: 'prflx',
                address: '192.168.1.20'
            }],
            ['cand-rem-prflx', {
                id: 'cand-rem-prflx',
                candidateType: 'prflx',
                address: '192.168.1.50'
            }]
        ]);

        sessionA.pc.getStats = vi.fn(async () => mockBothPrflxStats);
        const bothType = await engineA.detectConnectionType(sessionA);
        expect(bothType).toBe('direct-lan');

        // WAN IP with prflx/srflx must still resolve to direct-stun
        const mockWanStats = new Map([
            ['transport-0', {
                type: 'transport',
                selectedCandidatePairId: 'pair-wan'
            }],
            ['pair-wan', {
                id: 'pair-wan',
                type: 'candidate-pair',
                state: 'succeeded',
                nominated: true,
                localCandidateId: 'cand-wan-loc',
                remoteCandidateId: 'cand-wan-rem'
            }],
            ['cand-wan-loc', {
                id: 'cand-wan-loc',
                candidateType: 'host',
                address: 'laptop.local'
            }],
            ['cand-wan-rem', {
                id: 'cand-wan-rem',
                candidateType: 'srflx',
                address: '103.148.128.82'
            }]
        ]);
        sessionA.pc.getStats = vi.fn(async () => mockWanStats);
        const wanType = await engineA.detectConnectionType(sessionA);
        expect(wanType).toBe('direct-stun');
    });

    // TEST-06: Simultaneous offer collision (glare) resolves cleanly via polite/impolite rollback
    it('TEST-06: Glare resolution handles simultaneous offers with polite peer rollback without deadlock', async () => {
        // 'alice' < 'bob' -> alice is polite, bob is impolite
        engineA = new TransferEngine({
            socket: socketA,
            myId: 'alice',
            getPeerName: () => 'Bob',
            onEvent: (event) => eventsA.push(event),
            fetchTurnCredentials: false
        });

        engineB = new TransferEngine({
            socket: socketB,
            myId: 'bob',
            getPeerName: () => 'Alice',
            onEvent: (event) => eventsB.push(event),
            fetchTurnCredentials: false
        });

        const sessionA = engineA.getOrCreateSession('bob');
        const sessionB = engineB.getOrCreateSession('alice');

        expect(sessionA.polite).toBe(true);
        expect(sessionB.polite).toBe(false);

        // Both peers initiate an offer simultaneously (glare state)
        sessionA.pc.signalingState = 'have-local-offer';
        sessionB.pc.signalingState = 'have-local-offer';

        const setLocalDescSpyA = vi.spyOn(sessionA.pc, 'setLocalDescription');
        const setRemoteDescSpyA = vi.spyOn(sessionA.pc, 'setRemoteDescription');

        // Offer from impolite peer Bob arrives at polite peer Alice
        await engineA.handleOffer({
            offer: { type: 'offer', sdp: 'offer-from-bob' },
            sender: 'bob'
        });

        // Polite peer Alice must execute rollback on local description
        expect(setLocalDescSpyA).toHaveBeenCalledWith({ type: 'rollback' });
        // And then apply remote offer from Bob
        expect(setRemoteDescSpyA).toHaveBeenCalledWith(expect.objectContaining({ type: 'offer' }));

        // Offer from polite peer Alice arrives at impolite peer Bob (while Bob still has offer in flight)
        const setRemoteDescSpyB = vi.spyOn(sessionB.pc, 'setRemoteDescription');
        sessionB.pc.signalingState = 'have-local-offer';

        await engineB.handleOffer({
            offer: { type: 'offer', sdp: 'offer-from-alice' },
            sender: 'alice'
        });

        // Impolite peer Bob must IGNORE the colliding offer
        expect(sessionB.ignoreOffer).toBe(true);
        expect(setRemoteDescSpyB).not.toHaveBeenCalled();
    });

    // TEST-07: Automatic ICE restart firing after 3 seconds in disconnected state
    it('TEST-07: Automatically triggers ICE restart after 3 seconds in disconnected state', async () => {
        vi.useFakeTimers();
        try {
            engineA = new TransferEngine({
                socket: socketA,
                myId: 'alice',
                getPeerName: () => 'Bob',
                onEvent: (event) => eventsA.push(event),
                fetchTurnCredentials: false
            });

            const sessionA = engineA.getOrCreateSession('bob');
            sessionA.channelReady = true;
            sessionA.pc.connectionState = 'connected';
            sessionA.pc.iceConnectionState = 'connected';

            const iceRestartSpy = vi.spyOn(engineA, 'attemptIceRestart');

            // Peer drops to disconnected
            sessionA.pc.connectionState = 'disconnected';
            sessionA.pc.iceConnectionState = 'disconnected';
            engineA.handleConnectionStateChange(sessionA, 'disconnected');

            // At 1.5s, no restart yet (within 3s grace window)
            vi.advanceTimersByTime(1500);
            expect(iceRestartSpy).not.toHaveBeenCalled();

            // At 3s, automatic ICE restart should fire
            vi.advanceTimersByTime(1600);
            expect(iceRestartSpy).toHaveBeenCalledTimes(1);
        } finally {
            vi.useRealTimers();
        }
    });
});
