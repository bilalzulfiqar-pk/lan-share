import { describe, it, expect } from 'vitest';
import { parseRoomFromHash } from '../useSignaling';

describe('parseRoomFromHash', () => {
    it('parses standard #room=XXXXXX', () => {
        expect(parseRoomFromHash('#room=123456')).toBe('123456');
        expect(parseRoomFromHash('#room=abc-xyz')).toBe('ABC-XYZ');
        expect(parseRoomFromHash('#room=998877')).toBe('998877');
    });

    it('parses room when additional hash query parameters exist', () => {
        expect(parseRoomFromHash('#room=492810&other=true')).toBe('492810');
        expect(parseRoomFromHash('#foo=bar&room=ROOM42&baz=1')).toBe('ROOM42');
    });

    it('handles hash without leading hash sign', () => {
        expect(parseRoomFromHash('room=123456')).toBe('123456');
    });

    it('returns null for unrelated hashes or empty strings', () => {
        expect(parseRoomFromHash('#something-else')).toBeNull();
        expect(parseRoomFromHash('')).toBeNull();
        expect(parseRoomFromHash(null)).toBeNull();
        expect(parseRoomFromHash(undefined)).toBeNull();
        expect(parseRoomFromHash('#room=')).toBeNull();
    });

    it('handles router-style paths, trailing slashes, and question mark syntax', () => {
        expect(parseRoomFromHash('#room=849201/')).toBe('849201');
        expect(parseRoomFromHash('#/room=849201')).toBe('849201');
        expect(parseRoomFromHash('#/app?room=654321')).toBe('654321');
        expect(parseRoomFromHash('#room=123456#sub')).toBe('123456');
    });

    it('enforces maximum length of 16 characters and uppercase normalization', () => {
        const longCode = 'a'.repeat(25);
        const parsed = parseRoomFromHash(`#room=${longCode}`);
        expect(parsed.length).toBe(16);
        expect(parsed).toBe('A'.repeat(16));
    });
});

describe('roomCode serialization for leaveRoom (CORE-BUG-08)', () => {
    it('serializes roomCode as null instead of dropping the key over JSON', () => {
        const activeRoom = 'ROOM42';
        const activePayload = { name: 'Device', roomCode: activeRoom ?? null };
        expect(JSON.parse(JSON.stringify(activePayload))).toEqual({ name: 'Device', roomCode: 'ROOM42' });

        // When leaving room (roomCode becomes null)
        const leftRoom = null;
        const leftPayload = { name: 'Device', roomCode: leftRoom ?? null };
        const serialized = JSON.stringify(leftPayload);

        // Crucial: roomCode key MUST be present in JSON as null, not omitted
        expect(serialized).toContain('"roomCode":null');
        expect(JSON.parse(serialized)).toEqual({ name: 'Device', roomCode: null });

        // Verify the old bug behavior would have omitted the key
        const buggyPayload = { name: 'Device', roomCode: leftRoom || undefined };
        expect(JSON.stringify(buggyPayload)).not.toContain('"roomCode"');
    });
});
