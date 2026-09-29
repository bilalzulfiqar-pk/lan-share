import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    sanitizeRoomCode,
    areUsersVisible,
    getVisibleUsersFor,
    SimilarityIndex
} from './lib.js';

describe('Server Room Logic and Cross-IP Visibility', () => {
    let similarityIndex;
    let users;

    beforeEach(() => {
        similarityIndex = new SimilarityIndex();
        users = {};
    });

    it('enables cross-IP and cross-subnet visibility when sharing the same roomCode', () => {
        // Alice on Mobile Hotspot (Cellular IP)
        const userA = {
            id: 'socket-alice',
            name: 'Alice',
            deviceId: 'dev-alice',
            deviceType: 'mobile',
            publicIp: '172.56.21.89',
            networkFingerprints: ['lan:ipv4:192.168.43.1'],
            roomCode: '749201'
        };

        // Bob on Campus Wi-Fi / VLAN
        const userB = {
            id: 'socket-bob',
            name: 'Bob',
            deviceId: 'dev-bob',
            deviceType: 'desktop',
            publicIp: '140.211.9.87',
            networkFingerprints: ['lan:ipv4:10.128.4.52'],
            roomCode: '749201'
        };

        // Charlie on Campus Wi-Fi without room (default local radar)
        const userC = {
            id: 'socket-charlie',
            name: 'Charlie',
            deviceId: 'dev-charlie',
            deviceType: 'desktop',
            publicIp: '140.211.9.87',
            networkFingerprints: ['lan:ipv4:10.128.4.52'],
            roomCode: null
        };

        users[userA.id] = userA;
        users[userB.id] = userB;
        users[userC.id] = userC;

        similarityIndex.addUser(userA);
        similarityIndex.addUser(userB);
        similarityIndex.addUser(userC);

        // Alice sees Bob
        const candidatesA = similarityIndex.getCandidateIdsFor(userA);
        const visibleToAlice = getVisibleUsersFor(users, userA, candidatesA);
        expect(visibleToAlice).toHaveLength(1);
        expect(visibleToAlice[0].id).toBe('socket-bob');
        expect(visibleToAlice[0].name).toBe('Bob');
        expect(visibleToAlice[0].roomCode).toBe('749201');

        // Bob sees Alice, but NOT Charlie (even though Bob and Charlie share campus IP/subnet)
        const candidatesB = similarityIndex.getCandidateIdsFor(userB);
        const visibleToBob = getVisibleUsersFor(users, userB, candidatesB);
        expect(visibleToBob).toHaveLength(1);
        expect(visibleToBob[0].id).toBe('socket-alice');
        expect(visibleToBob[0].name).toBe('Alice');

        // Charlie sees nobody in his candidate/visibility list
        const candidatesC = similarityIndex.getCandidateIdsFor(userC);
        const visibleToCharlie = getVisibleUsersFor(users, userC, candidatesC);
        expect(visibleToCharlie).toHaveLength(0);
    });

    it('returns to local network radar when leaving a room', () => {
        // Device 1 and Device 2 on the same Wi-Fi
        const user1 = {
            id: 'socket-1',
            name: 'Device 1',
            deviceId: 'dev-1',
            deviceType: 'desktop',
            publicIp: '192.168.1.100',
            networkFingerprints: ['lan:ipv4:192.168.1'],
            roomCode: 'ROOM42'
        };

        const user2 = {
            id: 'socket-2',
            name: 'Device 2',
            deviceId: 'dev-2',
            deviceType: 'mobile',
            publicIp: '192.168.1.100',
            networkFingerprints: ['lan:ipv4:192.168.1'],
            roomCode: null
        };

        users[user1.id] = user1;
        users[user2.id] = user2;
        similarityIndex.addUser(user1);
        similarityIndex.addUser(user2);

        // While Device 1 is in ROOM42, neither sees each other
        expect(getVisibleUsersFor(users, user1, similarityIndex.getCandidateIdsFor(user1))).toHaveLength(0);
        expect(getVisibleUsersFor(users, user2, similarityIndex.getCandidateIdsFor(user2))).toHaveLength(0);

        // Device 1 leaves the room
        user1.roomCode = null;
        similarityIndex.addUser(user1);

        // Now both see each other on local radar
        const visibleTo1 = getVisibleUsersFor(users, user1, similarityIndex.getCandidateIdsFor(user1));
        const visibleTo2 = getVisibleUsersFor(users, user2, similarityIndex.getCandidateIdsFor(user2));

        expect(visibleTo1).toHaveLength(1);
        expect(visibleTo1[0].id).toBe('socket-2');
        expect(visibleTo2).toHaveLength(1);
        expect(visibleTo2[0].id).toBe('socket-1');
    });

    it('correctly tracks affected sockets across room transitions', () => {
        const userA = { id: 's-a', roomCode: 'ROOMX', publicIp: '1.1.1.1' };
        const userB = { id: 's-b', roomCode: 'ROOMX', publicIp: '2.2.2.2' };
        similarityIndex.addUser(userA);
        similarityIndex.addUser(userB);

        // When userC joins ROOMX
        const userC = { id: 's-c', roomCode: 'ROOMX', publicIp: '3.3.3.3' };
        similarityIndex.addUser(userC);

        const affected = similarityIndex.getAffectedSocketIds(userC);
        expect(affected).toContain('s-a');
        expect(affected).toContain('s-b');
        expect(affected).toContain('s-c');

        // When userC leaves ROOMX
        const oldAffected = similarityIndex.getAffectedSocketIds(userC);
        userC.roomCode = null;
        similarityIndex.addUser(userC);
        const newAffected = similarityIndex.getAffectedSocketIds(userC);
        const allAffected = Array.from(new Set([...oldAffected, ...newAffected]));

        expect(allAffected).toContain('s-a');
        expect(allAffected).toContain('s-b');
        expect(allAffected).toContain('s-c');
    });

    it('blocks visibility between devices in different rooms even on the same LAN subnet', () => {
        const userA = {
            id: 's-1',
            publicIp: '192.168.1.1',
            networkFingerprints: ['lan:ipv4:192.168.1'],
            roomCode: 'ALPHA'
        };
        const userB = {
            id: 's-2',
            publicIp: '192.168.1.1',
            networkFingerprints: ['lan:ipv4:192.168.1'],
            roomCode: 'BETA'
        };
        const userC = {
            id: 's-3',
            publicIp: '192.168.1.1',
            networkFingerprints: ['lan:ipv4:192.168.1'],
            roomCode: null
        };

        expect(areUsersVisible(userA, userB)).toBe(false);
        expect(areUsersVisible(userA, userC)).toBe(false);
        expect(areUsersVisible(userB, userC)).toBe(false);
    });
});
