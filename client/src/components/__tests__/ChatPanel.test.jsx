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
        expect(html).toContain('disabled=""');
    });

    it('renders message bubbles as selectable divs with separate copy buttons and clickable links (BUG-MED-01, FEAT-02, TEST-03)', () => {
        const props = {
            ...defaultProps,
            messages: [
                { id: 'm1', text: 'Visit https://github.com/mian-b/lan-share for code', ts: 1710000000000, direction: 'in' },
                { id: 'm2', text: 'token_sample_test_abcdef1234567890', ts: 1710000010000, direction: 'out' }
            ]
        };

        const html = renderToStaticMarkup(<ChatPanel {...props} />);

        // Must NOT render button as the outer chat bubble (no nested interactive HTML)
        expect(html).not.toMatch(/<button[^>]*class="chat-bubble\s/);
        expect(html).toContain('<div class="chat-bubble chat-bubble-in');

        // Links must render as valid <a> tags
        expect(html).toContain('<a href="https://github.com/mian-b/lan-share" target="_blank" rel="noopener noreferrer" class="chat-message-link">https://github.com/mian-b/lan-share</a>');

        // High-entropy secrets must render as <code>
        expect(html).toContain('<code class="chat-message-code">token_sample_test_abcdef1234567890</code>');

        // Copy button exists inside each bubble with accessible label and micro-icon
        expect(html).toContain('class="chat-bubble-copy');
        expect(html).toContain('title="Copy message text"');
        expect(html).toContain('aria-label="Copy message:');
        expect(html).toContain('<svg width="12" height="12"');
    });
});
