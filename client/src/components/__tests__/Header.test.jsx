import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Header, SHOW_NOTIFICATION_BELL } from '../Header';

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

    it('renders default Rooms button when not in a room', () => {
        const html = renderToStaticMarkup(<Header {...defaultProps} roomCode={null} />);

        expect(html).toContain('LAN Share');
        expect(html).toContain('Online');
        expect(html).toContain('room-header-btn');
        expect(html).not.toContain('is-in-room');
        expect(html).toContain('Rooms');
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

    it('renders muted alert tooltip and aria attributes when notifyEnabled is false', () => {
        const html = renderToStaticMarkup(<Header {...defaultProps} notifyEnabled={false} />);

        expect(html).toContain('title="Alerts muted - click to enable sounds and notifications"');
        expect(html).toContain('aria-label="Enable sound alerts and notifications"');
        expect(html).toContain('aria-pressed="false"');
        expect(html).not.toContain('is-active-icon');
    });

    it('renders active alert tooltip when notifyEnabled is true and browser banners are blocked/unsupported', () => {
        const html = renderToStaticMarkup(<Header {...defaultProps} notifyEnabled={true} />);

        expect(html).toContain('title="Sound alerts active (browser banners blocked in site settings) - click to mute"');
        expect(html).toContain('aria-label="Mute sound alerts and notifications"');
        expect(html).toContain('aria-pressed="true"');
        expect(html).toContain('is-active-icon');
    });

    it('renders full sound & banner alert tooltip when notifyEnabled is true and permission is granted', () => {
        const originalNotification = globalThis.Notification;
        const originalWindow = globalThis.window;
        globalThis.Notification = { permission: 'granted' };
        globalThis.window = { Notification: globalThis.Notification };
        try {
            const html = renderToStaticMarkup(<Header {...defaultProps} notifyEnabled={true} />);
            expect(html).toContain('title="Sound &amp; banner alerts active - click to mute"');
            expect(html).toContain('is-active-icon');
        } finally {
            globalThis.Notification = originalNotification;
            globalThis.window = originalWindow;
        }
    });

    it('renders the mobile more button and desktop tool classes', () => {
        const html = renderToStaticMarkup(<Header {...defaultProps} />);

        expect(html).toContain('header-more-btn');
        expect(html).toContain('aria-label="More settings and tools"');
        expect(html).toContain('aria-haspopup="menu"');
        expect(html).toContain('header-tool-theme');
        expect(html).toContain('header-tool-qr');
        expect(html).toContain('header-tool-debug');
    });

    it('exports SHOW_NOTIFICATION_BELL and hides the bell icon when showNotificationBell is false', () => {
        expect(SHOW_NOTIFICATION_BELL).toBe(true);

        const html = renderToStaticMarkup(<Header {...defaultProps} showNotificationBell={false} />);
        expect(html).not.toContain('aria-label="Enable sound alerts and notifications"');
        expect(html).not.toContain('aria-label="Mute sound alerts and notifications"');
    });
});
