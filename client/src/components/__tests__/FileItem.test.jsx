import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FileItem, formatEta } from '../FileItem';

describe('FileItem component honest state rendering', () => {
    it('renders "Connecting to device…" for connecting status', () => {
        const item = {
            id: 'f1',
            fileName: 'document.pdf',
            fileSize: 1024 * 1024,
            fileType: 'application/pdf',
            direction: 'out',
            status: 'connecting',
            progress: 0,
            peerId: 'peer1'
        };

        const html = renderToStaticMarkup(
            <FileItem item={item} getPeerName={() => 'Bob'} />
        );

        expect(html).toContain('Connecting to device…');
        expect(html).toContain('transfer-status connecting');
        expect(html).not.toContain('Waiting for accept');
        expect(html).toContain('Cancel transfer');
    });

    it('renders "Offered to peer (ready to download)" for offered status on sender', () => {
        const item = {
            id: 'f2',
            fileName: 'video.mp4',
            fileSize: 50 * 1024 * 1024,
            fileType: 'video/mp4',
            direction: 'out',
            status: 'offered',
            progress: 0,
            peerId: 'peer1'
        };

        const html = renderToStaticMarkup(
            <FileItem item={item} getPeerName={() => 'Bob'} />
        );

        expect(html).toContain('Offered to peer (ready to download)');
        expect(html).toContain('transfer-status offered');
        expect(html).not.toContain('Waiting for accept');
        expect(html).toContain('Cancel transfer');
    });

    it('renders "Sending..." and progress/speed for uploading status', () => {
        const item = {
            id: 'f3',
            fileName: 'archive.zip',
            fileSize: 100 * 1024 * 1024,
            fileType: 'application/zip',
            direction: 'out',
            status: 'uploading',
            progress: 45,
            speed: 5 * 1024 * 1024,
            eta: 11,
            peerId: 'peer1'
        };

        const html = renderToStaticMarkup(
            <FileItem item={item} getPeerName={() => 'Bob'} />
        );

        expect(html).toContain('Sending...');
        expect(html).toContain('transfer-status uploading');
        expect(html).toContain('role="progressbar"');
        expect(html).toContain('aria-valuenow="45"');
        expect(html).toContain('45%');
        expect(html).toContain('transfer-progress-percent');
        expect(html).toContain('5 MB/s');
        expect(html).toContain('11s left');
    });

    it('renders "Sent & verified (SHA-256)" for completed status on sender', () => {
        const item = {
            id: 'f4',
            fileName: 'photo.png',
            fileSize: 2 * 1024 * 1024,
            fileType: 'image/png',
            direction: 'out',
            status: 'completed',
            progress: 100,
            peerId: 'peer1'
        };

        const html = renderToStaticMarkup(
            <FileItem item={item} getPeerName={() => 'Bob'} />
        );

        expect(html).toContain('Sent &amp; verified (SHA-256)');
        expect(html).toContain('transfer-status completed');
    });

    it('renders "Direct connection failed" for blocked status', () => {
        const item = {
            id: 'f5',
            fileName: 'data.csv',
            fileSize: 1024,
            fileType: 'text/csv',
            direction: 'out',
            status: 'blocked',
            peerId: 'peer1'
        };

        const html = renderToStaticMarkup(
            <FileItem item={item} getPeerName={() => 'Bob'} />
        );

        expect(html).toContain('Direct connection failed');
        expect(html).toContain('transfer-status blocked');
    });

    it('renders "Direct connection failed" for failed status without custom error', () => {
        const item = {
            id: 'f6',
            fileName: 'data.csv',
            fileSize: 1024,
            fileType: 'text/csv',
            direction: 'out',
            status: 'failed',
            peerId: 'peer1'
        };

        const html = renderToStaticMarkup(
            <FileItem item={item} getPeerName={() => 'Bob'} />
        );

        expect(html).toContain('Direct connection failed');
        expect(html).toContain('transfer-status failed');
    });

    it('never displays "Waiting for accept" even if sender item has idle status fallback', () => {
        const item = {
            id: 'f7',
            fileName: 'data.csv',
            fileSize: 1024,
            fileType: 'text/csv',
            direction: 'out',
            status: 'idle',
            peerId: 'peer1'
        };

        const html = renderToStaticMarkup(
            <FileItem item={item} getPeerName={() => 'Bob'} />
        );

        expect(html).not.toContain('Waiting for accept');
        expect(html).toContain('Connecting to device…');
    });

    it('renders download button for receiver with idle or offered status', () => {
        const item = {
            id: 'f8',
            fileName: 'sheet.xlsx',
            fileSize: 2048,
            fileType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            direction: 'in',
            status: 'idle',
            peerId: 'peer1'
        };

        const html = renderToStaticMarkup(
            <FileItem item={item} getPeerName={() => 'Alice'} />
        );

        expect(html).toContain('Download');
        expect(html).toContain('Available');
    });

    it('renders "View Mobile Hotspot Guide" button on blocked or isolation items', () => {
        const blockedItem = {
            id: 'f9',
            fileName: 'huge.zip',
            fileSize: 200 * 1024 * 1024,
            fileType: 'application/zip',
            direction: 'out',
            status: 'blocked',
            error: 'Files over 150 MB cannot be sent over cloud relay on the free tier. Please enable a personal mobile hotspot to transfer large files directly at full Wi-Fi speed.',
            peerId: 'peer1'
        };

        const html = renderToStaticMarkup(
            <FileItem item={blockedItem} getPeerName={() => 'Alice'} onOpenHotspotGuide={() => {}} />
        );

        expect(html).toContain('View Mobile Hotspot Guide');
        expect(html).toContain('data-testid="file-hotspot-guide-btn"');
    });

    it('renders "Restart Transfer" button for receiver on failed or error transfers', () => {
        const failedItem = {
            id: 'f10',
            fileName: 'interrupted.mp4',
            fileSize: 10 * 1024 * 1024,
            fileType: 'video/mp4',
            direction: 'in',
            status: 'failed',
            error: 'Transfer interrupted.',
            peerId: 'peer1'
        };

        const html = renderToStaticMarkup(
            <FileItem item={failedItem} getPeerName={() => 'Alice'} onRequest={() => {}} />
        );

        expect(html).toContain('Restart Transfer');
        expect(html).toContain('data-testid="restart-transfer-btn"');
    });

    it('renders "Peer Offline" badge and hides "Restart Transfer" when item.error is "Peer disconnected."', () => {
        const disconnectedItem = {
            id: 'f11',
            fileName: 'interrupted.mp4',
            fileSize: 10 * 1024 * 1024,
            fileType: 'video/mp4',
            direction: 'in',
            status: 'error',
            error: 'Peer disconnected.',
            peerId: 'peer1'
        };

        const html = renderToStaticMarkup(
            <FileItem item={disconnectedItem} getPeerName={() => 'Alice'} onRequest={() => {}} />
        );

        expect(html).not.toContain('Restart Transfer');
        expect(html).not.toContain('data-testid="restart-transfer-btn"');
        expect(html).toContain('Peer Offline');
        expect(html).toContain('data-testid="peer-offline-badge"');
    });

    it('renders "Peer Offline" badge when isPeerOnline is false or peer is missing from peers array', () => {
        const failedItem = {
            id: 'f12',
            fileName: 'video.mkv',
            fileSize: 50 * 1024 * 1024,
            fileType: 'video/x-matroska',
            direction: 'in',
            status: 'failed',
            error: 'Connection closed.',
            peerId: 'peer-leaving'
        };

        // Case A: isPeerOnline explicitly false
        const htmlExplicitOffline = renderToStaticMarkup(
            <FileItem item={failedItem} getPeerName={() => 'Alice'} onRequest={() => {}} isPeerOnline={false} />
        );
        expect(htmlExplicitOffline).not.toContain('Restart Transfer');
        expect(htmlExplicitOffline).toContain('Peer Offline');

        // Case B: peer is missing from active peers list
        const htmlMissingFromPeers = renderToStaticMarkup(
            <FileItem item={failedItem} getPeerName={() => 'Alice'} onRequest={() => {}} peers={[{ id: 'other-peer' }]} />
        );
        expect(htmlMissingFromPeers).not.toContain('Restart Transfer');
        expect(htmlMissingFromPeers).toContain('Peer Offline');

        // Case C: peer IS present in peers list
        const htmlPeerOnline = renderToStaticMarkup(
            <FileItem item={failedItem} getPeerName={() => 'Alice'} onRequest={() => {}} peers={[{ id: 'peer-leaving' }]} />
        );
        expect(htmlPeerOnline).toContain('Restart Transfer');
        expect(htmlPeerOnline).not.toContain('Peer Offline');
    });

    it('renders "Peer Offline" badge when item.error is "Peer is no longer connected."', () => {
        const item = {
            id: 'f13',
            fileName: 'document.pdf',
            fileSize: 1024 * 1024,
            fileType: 'application/pdf',
            direction: 'in',
            status: 'error',
            error: 'Peer is no longer connected.',
            peerId: 'peer99'
        };

        const html = renderToStaticMarkup(
            <FileItem item={item} getPeerName={() => 'Alice'} onRequest={() => {}} />
        );

        expect(html).not.toContain('Restart Transfer');
        expect(html).toContain('Peer Offline');
        expect(html).toContain('data-testid="peer-offline-badge"');
    });

    it('renders clean file metadata without transport badges on individual file cards', () => {
        const lanItem = {
            id: 'f14',
            fileName: 'clip.mp4',
            fileSize: 10 * 1024 * 1024,
            direction: 'out',
            status: 'uploading',
            connectionType: 'direct-lan',
            peerId: 'peer1'
        };

        const lanHtml = renderToStaticMarkup(
            <FileItem item={lanItem} getPeerName={() => 'Alice'} />
        );
        expect(lanHtml).toContain('clip.mp4');
        expect(lanHtml).toContain('10 MB');
        expect(lanHtml).toContain('To: Alice');
        // FileItem deliberately omits transport badge to avoid asymmetric transport confusion
        expect(lanHtml).not.toContain('mode-direct-lan');
        expect(lanHtml).not.toContain('Local Wi-Fi Transfer');
    });

    it('formats ETA without off-by-one rounding errors like "1m 60s" (BUG-MED-02)', () => {
        // 119.6s should render "2m left", not "1m 60s"
        const item119s = {
            id: 'f15',
            fileName: 'large.zip',
            fileSize: 100 * 1024 * 1024,
            direction: 'out',
            status: 'uploading',
            progress: 50,
            speed: 1024 * 1024,
            eta: 119.6,
            peerId: 'peer1'
        };

        const html119 = renderToStaticMarkup(
            <FileItem item={item119s} getPeerName={() => 'Alice'} />
        );
        expect(html119).toContain('2m left');
        expect(html119).not.toContain('1m 60s');

        // 59.8s should render "1m left", not "60s"
        const item59s = {
            id: 'f16',
            fileName: 'clip.mp4',
            fileSize: 10 * 1024 * 1024,
            direction: 'out',
            status: 'uploading',
            progress: 80,
            speed: 1024 * 1024,
            eta: 59.8,
            peerId: 'peer1'
        };

        const html59 = renderToStaticMarkup(
            <FileItem item={item59s} getPeerName={() => 'Alice'} />
        );
        expect(html59).toContain('1m left');
    });

    describe('formatEta duration formatting', () => {
        it('formats sub-minute durations in seconds', () => {
            expect(formatEta(11)).toBe('11s');
            expect(formatEta(59)).toBe('59s');
            expect(formatEta(0)).toBe('1s');
        });

        it('formats minute durations correctly', () => {
            expect(formatEta(60)).toBe('1m');
            expect(formatEta(65)).toBe('1m 5s');
            expect(formatEta(120)).toBe('2m');
            expect(formatEta(3599)).toBe('59m 59s');
        });

        it('formats hour durations cleanly with ${hours}h ${minutes}m or ${hours}h', () => {
            expect(formatEta(3600)).toBe('1h');
            expect(formatEta(3660)).toBe('1h 1m');
            expect(formatEta(4500)).toBe('1h 15m');
            expect(formatEta(7200)).toBe('2h');
            expect(formatEta(7260)).toBe('2h 1m');
        });

        it('returns null for null, undefined, or non-finite seconds', () => {
            expect(formatEta(null)).toBeNull();
            expect(formatEta(undefined)).toBeNull();
            expect(formatEta(Infinity)).toBeNull();
            expect(formatEta(NaN)).toBeNull();
        });
    });
});


