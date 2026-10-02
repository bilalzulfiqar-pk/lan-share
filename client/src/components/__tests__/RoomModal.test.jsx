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
