import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RoomModal } from '../RoomModal';

describe('RoomModal component rendering', () => {
    it('renders nothing when closed', () => {
        const html = renderToStaticMarkup(
            <RoomModal
                open={false}
                onClose={() => {}}
                roomCode={null}
                onJoinRoom={() => {}}
                onLeaveRoom={() => {}}
                reduceMotion={true}
            />
        );
        expect(html).toBe('');
    });

    it('renders creation and join input when not in a room', () => {
        const html = renderToStaticMarkup(
            <RoomModal
                open={true}
                onClose={() => {}}
                roomCode={null}
                onJoinRoom={() => {}}
                onLeaveRoom={() => {}}
                reduceMotion={true}
            />
        );

        expect(html).toContain('Room Pairing');
        expect(html).toContain('Better Discovery');
        expect(html).not.toContain('Local Radar Mode');
        expect(html).toContain('Create Random 6-Digit Room');
        expect(html).toContain('or enter an existing code');
        expect(html).toContain('placeholder="e.g. 492810"');
        expect(html).toContain('Join Room');
        expect(html).toContain('room-join-btn');
        expect(html).toContain('btn-auto');
        expect(html).toContain('room-scan-pill-btn');
        expect(html).toContain('Scan');
        expect(html).not.toContain('ACTIVE ROOM CODE');
        expect(html).not.toContain('Leave Room');
    });

    it('renders active room code, QR code canvas, copy link, and leave button when in a room', () => {
        const html = renderToStaticMarkup(
            <RoomModal
                open={true}
                onClose={() => {}}
                roomCode="749201"
                onJoinRoom={() => {}}
                onLeaveRoom={() => {}}
                reduceMotion={true}
            />
        );

        expect(html).toContain('Room Pairing');
        expect(html).toContain('In Room: 749201');
        expect(html).toContain('ACTIVE ROOM CODE');
        expect(html).toContain('749201');
        expect(html).toContain('aria-label="QR code for room 749201"');
        expect(html).toContain('Copy Link');
        expect(html).toContain('Leave Room');
        expect(html).not.toContain('Return to Local Radar');
        expect(html).toContain('role="dialog"');
        expect(html).toContain('room-card');
        expect(html).not.toContain('Create Random 6-Digit Room');
    });
});

describe('extractRoomCode helper for QR scanner', () => {
    it('extracts room code from full URL hash (#room=XXXXXX)', async () => {
        const { extractRoomCode } = await import('../../lib/qrScanner');
        expect(extractRoomCode('https://lan-share.vercel.app/#room=492810')).toBe('492810');
        expect(extractRoomCode('http://localhost:5173/#room=room-99')).toBe('ROOM-99');
        expect(extractRoomCode('http://192.168.1.50:5173/#room=ALPHA_1')).toBe('ALPHA_1');
    });

    it('extracts room code from query params (?room=XXXXXX)', async () => {
        const { extractRoomCode } = await import('../../lib/qrScanner');
        expect(extractRoomCode('https://example.com/?room=859302')).toBe('859302');
        expect(extractRoomCode('https://example.com/app?other=1&room=778899#hash')).toBe('778899');
    });

    it('extracts raw alphanumeric room codes', async () => {
        const { extractRoomCode } = await import('../../lib/qrScanner');
        expect(extractRoomCode('492810')).toBe('492810');
        expect(extractRoomCode('  room-xyz  ')).toBe('ROOM-XYZ');
        expect(extractRoomCode('998877')).toBe('998877');
    });

    it('rejects invalid or too short codes', async () => {
        const { extractRoomCode } = await import('../../lib/qrScanner');
        expect(extractRoomCode('')).toBeNull();
        expect(extractRoomCode(null)).toBeNull();
        expect(extractRoomCode('12')).toBeNull(); // too short
        expect(extractRoomCode('this is an arbitrary message without code')).toBeNull();
    });
});


