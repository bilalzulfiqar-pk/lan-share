import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ConnectionModeBadge } from '../ConnectionModeBadge';
import { MODE_CONFIG } from '../../lib/connectionModes';

describe('ConnectionModeBadge Component', () => {
    it('renders Local Wi-Fi Transfer by default or with direct-lan mode', () => {
        const html = renderToStaticMarkup(<ConnectionModeBadge mode="direct-lan" />);
        expect(html).toContain('Local Wi-Fi Transfer');
        expect(html).toContain('conn-mode-badge');
        expect(html).toContain('mode-direct-lan');
        expect(html).toContain('Files flow directly through your local Wi-Fi router at maximum speed (up to 80+ MB/s). Zero internet bandwidth or cloud data used.');
        expect(html).toContain('Both devices are on the same local Wi-Fi network, and your router permits direct device-to-device communication.');
        expect(html).not.toContain('💡 Tip:');
    });

    it('renders Direct Internet Transfer for direct-stun mode', () => {
        const html = renderToStaticMarkup(<ConnectionModeBadge mode="direct-stun" />);
        expect(html).toContain('Direct Internet Transfer');
        expect(html).toContain('mode-direct-stun');
        expect(html).toContain('Devices are connected directly peer-to-peer over the internet using WebRTC. Files stream directly between devices without touching any cloud storage.');
        expect(html).toContain('Devices are connected across different networks or firewalls that permit direct peer-to-peer WebRTC connections.');
        expect(html).toContain('💡 Tip: Need faster local transfer speeds without using internet data? Connect both devices to a personal mobile hotspot.');
    });

    it('renders Cloud Relay Transfer with 150 MB note in description and AP isolation explanation', () => {
        const html = renderToStaticMarkup(<ConnectionModeBadge mode="relay-turn" />);
        expect(html).toContain('Cloud Relay Transfer');
        expect(html).toContain('mode-relay-turn');
        expect(html).toContain('Files are routed through a secure, encrypted cloud relay (Metered.ca TURN). Speeds depend on your internet connection (Max 150 MB per file).');
        expect(html).toContain('Your Wi-Fi network (e.g., university, hotel, or office network) has Access Point (AP) Isolation or high-security firewalls enabled, blocking direct local communication.');
        expect(html).toContain('💡 Tip: Need to send files larger than 150 MB? Turn on a mobile hotspot on your phone and connect both devices to transfer unlimited files directly at full 50+ MB/s Wi-Fi speed!');
    });

    it('renders Pinned indicator chip and is-pinned class when pinned', () => {
        const unpinnedHtml = renderToStaticMarkup(<ConnectionModeBadge mode="direct-lan" defaultPinned={false} />);
        expect(unpinnedHtml).not.toContain('conn-mode-pinned-chip');
        expect(unpinnedHtml).not.toContain('conn-mode-badge mode-direct-lan is-pinned');

        const pinnedHtml = renderToStaticMarkup(<ConnectionModeBadge mode="direct-lan" defaultPinned={true} />);
        expect(pinnedHtml).toContain('conn-mode-pinned-chip');
        expect(pinnedHtml).toContain('data-testid="conn-mode-pinned-indicator"');
        expect(pinnedHtml).toContain('Pinned');
        expect(pinnedHtml).toContain('is-pinned');
        expect(pinnedHtml).toContain('conn-mode-popover is-open');
    });

    it('exports MODE_CONFIG with correct exact copy and Option B comments', () => {
        expect(MODE_CONFIG['direct-lan'].label).toBe('Local Wi-Fi Transfer');
        expect(MODE_CONFIG['direct-stun'].label).toBe('Direct Internet Transfer');
        expect(MODE_CONFIG['relay-turn'].label).toBe('Cloud Relay Transfer');
        expect(MODE_CONFIG['relay-turn'].description).toContain('(Max 150 MB per file).');
    });
});
