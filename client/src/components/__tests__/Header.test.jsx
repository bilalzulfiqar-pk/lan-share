import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Header } from '../Header';

describe('Header component rendering', () => {
    const defaultProps = {
        isConnected: true,
        displayName: 'Test Device',
        onNameChange: () => {},
        deviceId: 'dev-1234567890',
        themePickerRef: { current: null },
        themeButtonRef: { current: null },
        showThemeMenu: false,
        setShowThemeMenu: () => {},
        currentTheme: { name: 'Ocean' },
        currentMode: 'dark',
        currentSwatch: { primary: '#60a5fa' },
        showQrPopup: false,
        setShowQrPopup: () => {},
        notifyEnabled: false,
        handleNotifyToggle: () => {},
        showDebugSidebar: false,
        toggleDebugSidebar: () => {},
        roomCode: null,
        onOpenRoomModal: () => {}
    };

    it('renders default Room button when not in a room', () => {
        const html = renderToStaticMarkup(<Header {...defaultProps} roomCode={null} />);

        expect(html).toContain('LAN Share');
        expect(html).toContain('Online');
        expect(html).toContain('room-header-btn');
        expect(html).not.toContain('is-in-room');
        expect(html).toContain('Room');
        expect(html).toContain('value="Test Device"');
        expect(html).toContain('dev-12345678');
    });

    it('renders cyberpunk Room badge with active code when in a room', () => {
        const html = renderToStaticMarkup(<Header {...defaultProps} roomCode="492810" />);

        expect(html).toContain('room-header-btn is-in-room');
        expect(html).toContain('room-pulse-dot');
        expect(html).toContain('room-header-hash');
        expect(html).toContain('492810');
        expect(html).toContain('Current room: 492810');
    });

    it('displays Offline indicator when isConnected is false', () => {
        const html = renderToStaticMarkup(<Header {...defaultProps} isConnected={false} />);

        expect(html).toContain('Offline');
        expect(html).toContain('status-dot offline');
    });
});
