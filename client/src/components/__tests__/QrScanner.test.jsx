import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QrScanner } from '../QrScanner';

describe('QrScanner component rendering', () => {
    it('renders the viewfinder container, loader, and cancel button', () => {
        const html = renderToStaticMarkup(
            <QrScanner onScan={() => {}} onCancel={() => {}} />
        );

        expect(html).toContain('room-scanner-container');
        expect(html).toContain('role="region"');
        expect(html).toContain('aria-label="Room QR Scanner"');
        expect(html).toContain('Starting camera...');
        expect(html).toContain('Cancel &amp; Enter Code');
        expect(html).toContain('room-scanner-cancel-btn');
        expect(html).toContain('playsInline=""');
        expect(html).toContain('autoPlay=""');
        expect(html).toContain('aria-label="Camera preview for QR code scanning"');
    });
});

