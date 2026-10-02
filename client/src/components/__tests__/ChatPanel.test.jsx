import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChatPanel } from '../ChatPanel';

describe('ChatPanel component rendering', () => {
    const defaultProps = {
        open: true,
        peerName: 'Device 402',
        connectionLabel: 'Connected · peer-to-peer',
        messages: [
            { id: 'm1', text: 'Hello from peer', ts: 1710000000000, direction: 'in' },
            { id: 'm2', text: 'Hey there!', ts: 1710000010000, direction: 'out' }
        ],
        onSend: () => {},
        onClose: () => {},
        reduceMotion: true,
        isPeerOnline: true
    };

    it('renders peer name, connection label, and active input when peer is online', () => {
        const html = renderToStaticMarkup(<ChatPanel {...defaultProps} />);

        expect(html).toContain('Device 402');
        expect(html).toContain('Connected · peer-to-peer');
        expect(html).toContain('placeholder="Type a message, link or key…"');
        expect(html).not.toContain('is-offline');
        expect(html).not.toContain('peer-offline-dot');
        expect(html).not.toContain('placeholder="Peer has disconnected"');
        // The text input is not disabled
        expect(html).toContain('<input class="chat-input" placeholder="Type a message, link or key…"');
    });

    it('renders offline indicator and disables input when peer is offline', () => {
        const html = renderToStaticMarkup(
            <ChatPanel
                {...defaultProps}
                connectionLabel="Peer disconnected · Offline"
                isPeerOnline={false}
            />
        );

        expect(html).toContain('Device 402');
        expect(html).toContain('Peer disconnected · Offline');
        expect(html).toContain('is-offline');
        expect(html).toContain('peer-offline-dot');
        expect(html).toContain('placeholder="Peer has disconnected"');
        expect(html).toContain('disabled=""');
    });
});
