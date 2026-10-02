import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { RoomModal } from '../RoomModal';
import { Header } from '../Header';
import { FileItem } from '../FileItem';
import { HistoryPanel } from '../HistoryPanel';
import { ChatPanel } from '../ChatPanel';
import { ConnectionModeBadge } from '../ConnectionModeBadge';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appCssPath = path.resolve(__dirname, '../../App.css');
const appCss = fs.readFileSync(appCssPath, 'utf8');

describe('Frontend UI & State Synchronization Enhancements', () => {

    describe('1. Room Modal Layout, Responsiveness & CSS Rules', () => {
        it('renders initial Join state with proper input wrapper and auto-width classes', () => {
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

            expect(html).toContain('room-card');
            expect(html).toContain('room-input-wrapper');
            expect(html).toContain('room-code-input');
            expect(html).toContain('room-join-btn');
            expect(html).toContain('btn-auto');
            expect(html).toContain('placeholder="e.g. 492810"');
            expect(html).toContain('Join Room');
            expect(html).toContain('Create Random 6-Digit Room');
        });

        it('renders active room section with QR canvas, shareable link, and leave button', () => {
            const html = renderToStaticMarkup(
                <RoomModal
                    open={true}
                    onClose={() => {}}
                    roomCode="123456"
                    onJoinRoom={() => {}}
                    onLeaveRoom={() => {}}
                    reduceMotion={true}
                />
            );

            expect(html).toContain('ACTIVE ROOM CODE');
            expect(html).toContain('123456');
            expect(html).toContain('qr-canvas-frame');
            expect(html).toContain('qr-url-row');
            expect(html).toContain('Copy Link');
            expect(html).toContain('room-leave-btn');
            expect(html).toContain('Leave Room');
            expect(html).not.toContain('Return to Local Radar');
            expect(html).toContain('Switch to a different room');
        });

        it('verifies CSS rules prevent specificity clashes and enable mobile responsiveness', () => {
            // Check that room-card has max-height and overflow-y: auto
            expect(appCss).toMatch(/\.room-card\s*\{[^}]*max-height:\s*calc\([^}]*overflow-y:\s*auto/);

            // Check that room-join-btn in @media (max-width: 380px) uses !important to override .btn-primary.btn-auto
            expect(appCss).toMatch(/@media\s*\(max-width:\s*380px\)\s*\{[\s\S]*?\.room-join-btn[\s\S]*?width:\s*100%\s*!important/);

            // Check that qr-canvas-frame canvas has max-width: 100% and height: auto
            expect(appCss).toMatch(/\.qr-canvas-frame\s+canvas\s*\{[^}]*max-width:\s*100%[^}]*height:\s*auto/);

            // Check that room-leave-btn has white-space: normal
            expect(appCss).toMatch(/\.room-leave-btn\s*\{[^}]*white-space:\s*normal/);
        });
    });

    describe('2. Header Rooms Button & Visual Enhancements', () => {
        const baseHeaderProps = {
            isConnected: true,
            displayName: 'My MacBook',
            onNameChange: () => {},
            deviceId: 'dev-999',
            themePickerRef: { current: null },
            themeButtonRef: { current: null },
            showThemeMenu: false,
            setShowThemeMenu: () => {},
            currentTheme: { name: 'Dark' },
            currentMode: 'dark',
            currentSwatch: { primary: '#60a5fa' },
            showQrPopup: false,
            setShowQrPopup: () => {},
            notifyEnabled: false,
            handleNotifyToggle: () => {},
            showDebugSidebar: false,
            toggleDebugSidebar: () => {},
            onOpenRoomModal: () => {}
        };

        it('renders default button as "Rooms" with network hub SVG icon when roomCode is null', () => {
            const html = renderToStaticMarkup(<Header {...baseHeaderProps} roomCode={null} />);

            expect(html).toContain('Rooms');
            expect(html).not.toContain('>Room<');
            expect(html).toContain('room-header-btn');
            expect(html).not.toContain('is-in-room');

            // 3-node network hub icon paths
            expect(html).toContain('<rect x="16" y="16" width="6" height="6"');
            expect(html).toContain('<rect x="2" y="16" width="6" height="6"');
            expect(html).toContain('<rect x="9" y="2" width="6" height="6"');
        });

        it('renders cyberpunk room code showcase with pulsing dot when roomCode is active', () => {
            const html = renderToStaticMarkup(<Header {...baseHeaderProps} roomCode="948201" />);

            expect(html).toContain('room-header-btn is-in-room');
            expect(html).toContain('room-pulse-dot');
            expect(html).toContain('room-header-hash');
            expect(html).toContain('948201');
            expect(html).toContain('Current room: 948201');
            expect(html).not.toContain('room-header-text');
        });
    });

    describe('3. FileItem & HistoryPanel Disconnected Peer Cleanup', () => {
        const failedTransferItem = {
            id: 'transfer-1',
            fileName: 'dataset.zip',
            fileSize: 100 * 1024 * 1024,
            fileType: 'application/zip',
            direction: 'in',
            status: 'failed',
            error: 'Connection closed.',
            peerId: 'peer-abc'
        };

        it('renders "Restart Transfer" button when peer IS online in peers list', () => {
            const html = renderToStaticMarkup(
                <FileItem
                    item={failedTransferItem}
                    peers={[{ id: 'peer-abc', name: 'Bob' }]}
                    getPeerName={() => 'Bob'}
                    onRequest={() => {}}
                />
            );

            expect(html).toContain('Restart Transfer');
            expect(html).toContain('data-testid="restart-transfer-btn"');
            expect(html).not.toContain('Peer Offline');
            expect(html).not.toContain('data-testid="peer-offline-badge"');
        });

        it('renders "Peer Offline" badge and hides "Restart Transfer" when peer is absent from peers list', () => {
            const html = renderToStaticMarkup(
                <FileItem
                    item={failedTransferItem}
                    peers={[{ id: 'peer-other', name: 'Charlie' }]}
                    getPeerName={() => 'Bob'}
                    onRequest={() => {}}
                />
            );

            expect(html).not.toContain('Restart Transfer');
            expect(html).not.toContain('data-testid="restart-transfer-btn"');
            expect(html).toContain('Peer Offline');
            expect(html).toContain('data-testid="peer-offline-badge"');
        });

        it('renders "Peer Offline" when item.error is "Peer disconnected."', () => {
            const disconnectedItem = {
                ...failedTransferItem,
                error: 'Peer disconnected.'
            };

            const html = renderToStaticMarkup(
                <FileItem
                    item={disconnectedItem}
                    getPeerName={() => 'Bob'}
                    onRequest={() => {}}
                />
            );

            expect(html).not.toContain('Restart Transfer');
            expect(html).toContain('Peer Offline');
        });

        it('renders "Peer Offline" when item.error is "Peer is no longer connected."', () => {
            const noLongerConnectedItem = {
                ...failedTransferItem,
                error: 'Peer is no longer connected.'
            };

            const html = renderToStaticMarkup(
                <FileItem
                    item={noLongerConnectedItem}
                    getPeerName={() => 'Bob'}
                    onRequest={() => {}}
                />
            );

            expect(html).not.toContain('Restart Transfer');
            expect(html).toContain('Peer Offline');
        });

        it('propagates peers prop through HistoryPanel to FileItem', () => {
            const html = renderToStaticMarkup(
                <HistoryPanel
                    history={[failedTransferItem]}
                    peers={[]} // empty peers list = peer is offline
                    getPeerName={() => 'Bob'}
                    onRequest={() => {}}
                    onSave={() => {}}
                    onCancel={() => {}}
                />
            );

            expect(html).not.toContain('Restart Transfer');
            expect(html).toContain('Peer Offline');
        });
    });

    describe('4. ChatPanel Offline Indication & Guarding', () => {
        it('renders normal active state when peer is online', () => {
            const html = renderToStaticMarkup(
                <ChatPanel
                    open={true}
                    peerName="Bob"
                    connectionLabel="Connected · peer-to-peer"
                    messages={[]}
                    onSend={() => {}}
                    onClose={() => {}}
                    isPeerOnline={true}
                />
            );

            expect(html).toContain('Bob');
            expect(html).toContain('Connected · peer-to-peer');
            expect(html).not.toContain('is-offline');
            expect(html).not.toContain('peer-offline-dot');
            expect(html).toContain('placeholder="Type a message, link or key…"');
            expect(html).not.toContain('<input class="chat-input" disabled');
            expect(html).toContain('<input class="chat-input" placeholder="Type a message, link or key…"');
        });

        it('renders offline indicator dot, offline label, and disabled input when peer is offline', () => {
            const html = renderToStaticMarkup(
                <ChatPanel
                    open={true}
                    peerName="Bob"
                    connectionLabel="Peer disconnected · Offline"
                    messages={[]}
                    onSend={() => {}}
                    onClose={() => {}}
                    isPeerOnline={false}
                />
            );

            expect(html).toContain('Bob');
            expect(html).toContain('Peer disconnected · Offline');
            expect(html).toContain('chat-status-text is-offline');
            expect(html).toContain('peer-offline-dot');
            expect(html).toContain('placeholder="Peer has disconnected"');
            expect(html).toContain('disabled=""');
        });
    });

    describe('5. Connection Mode Popover & Mode-Adaptive Diagnostic Styling', () => {
        it('renders mode-adaptive class on the why-block for direct-lan, direct-stun, and relay-turn', () => {
            const htmlLan = renderToStaticMarkup(<ConnectionModeBadge mode="direct-lan" />);
            expect(htmlLan).toContain('conn-mode-popover-why-block mode-direct-lan');
            expect(htmlLan).toContain('Why this mode is active:');
            expect(htmlLan).not.toContain('conn-mode-why-indicator');

            const htmlStun = renderToStaticMarkup(<ConnectionModeBadge mode="direct-stun" />);
            expect(htmlStun).toContain('conn-mode-popover-why-block mode-direct-stun');
            expect(htmlStun).toContain('Why this mode is active:');

            const htmlRelay = renderToStaticMarkup(<ConnectionModeBadge mode="relay-turn" />);
            expect(htmlRelay).toContain('conn-mode-popover-why-block mode-relay-turn');
            expect(htmlRelay).toContain('Why this mode is active:');
        });

        it('verifies CSS rules remove AI slop left border and provide mode-adaptive tinting', () => {
            // Check that border-left is none
            expect(appCss).toMatch(/\.conn-mode-popover-why-block\s*\{[^}]*border-left:\s*none;/);

            // Check mode-adaptive color rules
            expect(appCss).toMatch(/\.conn-mode-popover-why-block\.mode-direct-lan\s*\{[^}]*background:\s*rgba\(16,\s*185,\s*129/);
            expect(appCss).toMatch(/\.conn-mode-popover-why-block\.mode-direct-stun\s*\{[^}]*background:\s*rgba\(59,\s*130,\s*246/);
            expect(appCss).toMatch(/\.conn-mode-popover-why-block\.mode-relay-turn\s*\{[^}]*background:\s*rgba\(245,\s*158,\s*11/);

            // Check smooth 180ms/220ms popover transitions & hover bridge
            expect(appCss).toMatch(/\.conn-mode-popover\s*\{[\s\S]*?transition:\s*opacity\s*180ms[\s\S]*?transform\s*180ms/);
            expect(appCss).toMatch(/\.conn-mode-popover::after\s*\{[^}]*height:\s*12px;/);
            expect(appCss).toMatch(/\.conn-mode-popover\.is-open\s*\{[\s\S]*?transition:\s*opacity\s*220ms[\s\S]*?transform\s*220ms/);

            // Check pinned chip & active state styling
            expect(appCss).toMatch(/\.conn-mode-pinned-chip\s*\{[^}]*border-radius:\s*var\(--radius-pill\);/);
            expect(appCss).toMatch(/\.conn-mode-badge\.is-pinned\s*\{[^}]*box-shadow:/);
        });
    });
});
