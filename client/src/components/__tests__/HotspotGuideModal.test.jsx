import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { HotspotGuideModal } from '../HotspotGuideModal';

describe('HotspotGuideModal component rendering', () => {
    it('renders nothing when closed', () => {
        const html = renderToStaticMarkup(
            <HotspotGuideModal
                open={false}
                onClose={() => {}}
                reduceMotion={true}
            />
        );
        expect(html).toBe('');
    });

    it('renders 3 simple steps explaining hotspot creation, connection, and 50+ MB/s Wi-Fi speed', () => {
        const html = renderToStaticMarkup(
            <HotspotGuideModal
                open={true}
                onClose={() => {}}
                reduceMotion={true}
            />
        );

        // Header & badges
        expect(html).toContain('Mobile Hotspot Direct Link');
        expect(html).toContain('50+ MB/s Local Speed');
        expect(html).toContain('Bypass campus/hotel AP Isolation');

        // Step 1: Turn on phone hotspot
        expect(html).toContain('Turn On Phone Hotspot');
        expect(html).toContain('Cellular data can even be turned OFF');

        // Step 2: Connect other device
        expect(html).toContain('Connect Your Other Device');
        expect(html).toContain('unrestricted local LAN');

        // Step 3: Transfer unlimited
        expect(html).toContain('Transfer Unlimited at 50+ MB/s');
        expect(html).toContain('zero internet data usage');

        // Why is this needed section
        expect(html).toContain('Why is this needed?');
        expect(html).toContain('AP / Client Isolation');
        expect(html).toContain('150 MB caps');

        // Dismiss action
        expect(html).toContain('Got It');
    });
});
