import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FileItem } from '../FileItem';

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

    it('renders ConnectionModeBadge with informative labels and details when connectionType is provided', () => {
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
        expect(lanHtml).toContain('Local Wi-Fi Transfer');
        expect(lanHtml).toContain('mode-direct-lan');
        expect(lanHtml).toContain('Files flow directly through your local Wi-Fi router');

        const stunItem = {
            ...lanItem,
            id: 'f15',
            connectionType: 'direct-stun'
        };
        const stunHtml = renderToStaticMarkup(
            <FileItem item={stunItem} getPeerName={() => 'Alice'} />
        );
        expect(stunHtml).toContain('Direct Internet Transfer');
        expect(stunHtml).toContain('mode-direct-stun');

        const relayItem = {
            ...lanItem,
            id: 'f16',
            connectionType: 'relay-turn'
        };
        const relayHtml = renderToStaticMarkup(
            <FileItem item={relayItem} getPeerName={() => 'Alice'} />
        );
        expect(relayHtml).toContain('Cloud Relay Transfer');
        expect(relayHtml).toContain('mode-relay-turn');
        expect(relayHtml).toContain('(Max 150 MB per file)');
    });
});


