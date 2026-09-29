# Changelog

All notable changes and architectural improvements to LAN Share are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [1.1.0] - 2026-09-29

### Added
* **6-Digit Room Codes & Cross-Network URL Hash Pairing:** Enabled peer discovery across segmented VLANs, 2.4/5 GHz bands, and university subnets via 6-digit codes (e.g. `492810`) and shareable URL hashes (`#room=492810`). Includes camera-scannable QR code generation.
* **Mobile Multi-GB OPFS Streaming:** Integrated the Origin Private File System (`navigator.storage.getDirectory()`) for Android Chrome, iOS Safari, and desktop Firefox. Chunks stream directly into OPFS writable streams, keeping RAM usage < 15 MB even for 10 GB+ files, followed by native `navigator.share` system sheet export.
* **Screen Wake Lock & Mobile Audio Beacon:** Integrated `navigator.wakeLock.request('screen')` during active transfers, paired with an inaudible background audio beacon loop to prevent mobile operating systems from freezing WebRTC threads when tabs are hidden.
* **Ephemeral Metered.ca TURN Relay with 150 MB Safety Cap:** Added a secure server-side credential minting endpoint (`GET /api/turn-credentials`) providing zero-cost TURN relay fallback on AP-isolated networks, capped at 150 MB to protect free monthly quotas.
* **Mobile Hotspot Guidance Modal:** Added an in-app visual guide helping users bypass router AP isolation by toggling a personal smartphone hotspot to achieve 50+ MB/s Wi-Fi transfers with zero mobile data.
* **Chunk-Offset Transfer Resumption:** Protocol update allowing receivers to request byte ranges (`fromOffset`) to seamlessly resume transfers across momentary Wi-Fi blips without re-uploading from scratch.

### Changed
* **Transfer State Machine & Honest Status Flow:** Completely redesigned transfer statuses to eliminate misleading "Waiting for accept" labels. Senders now see `Connecting to device…`, `Offered to peer (ready to download)`, and live telemetry (`Uploading (XX MB/s) — ETA Xs`).
* **Disconnect Grace Window:** Replaced instant aborts on channel close with an 8-second grace window that attempts automatic ICE renegotiation before declaring failure.
* **Test Suite Expansion:** Expanded automated Vitest suites from 181 to 265 passing unit, integration, and child-process signaling tests.

### Fixed
* **Cross-Room Signaling Leakage:** Enforced mutual room visibility checks in signaling relays to prevent cross-room offer snooping.
* **Premature Sender Eviction:** Retained selected `File` handles across connection timeouts so receivers can click "Restart Transfer" without the sender re-selecting files.

---

## [1.0.0] - 2026-09-10

### Added
* **Server-Side Similarity Indexing (`SimilarityIndex`):** Replaced global $O(N^2)$ pairwise user matching with an in-memory inverted index partitioned by public IP (`ip:*`), LAN subnet (`fp:lan:*`), and STUN WAN hash (`fp:wan:*`). Emits visibility updates in $O(M^2)$ time only to candidate peer clusters, dropping server CPU overhead from ~350 ms to < 0.2 ms for 1,000 concurrent connections on low-resource hosting.
* **Contextual AP / Client Isolation Diagnostics:** Added a 20-second connection watchdog in the transfer engine that detects when routers on hotel, airport, or university Wi-Fi networks silently drop local peer UDP packets. Surfaces an informative troubleshooting message in both the transfer history item and the top-level error banner.
* **Direct-to-Disk Streaming (Chromium):** Implemented streaming chunk consumption via `window.showSaveFilePicker` and `WritableStream`, allowing multi-gigabyte file downloads without ballooning browser memory.
* **Cryptographic Transfer Verification:** Integrated chunked SHA-256 calculation on both sender and receiver streams, badging verified transfers automatically upon completion.
* **Animated Radar Discovery:** Added a radial radar visualizer that scans and displays active local devices with device-type iconography (mobile vs. desktop), distance rings, and sweep animations.
* **Integrated Peer-to-Peer Chat:** Embedded real-time WebRTC DataChannel messaging with link detection, monospace code formatting, unread badges, and local persistence.
* **Instant QR Code Pairing:** Added a header QR modal enabling phones to quickly connect to the client URL on the local network.
* **Progress & Speed Metrics:** Real-time transfer metrics calculating percentage completion, throughput in MB/s, and dynamic ETA estimations.
* **PWA & Desktop Install Support:** Added Web App Manifest and mobile viewport configuration for standalone app installation.
* **Multi-Theme Support:** Added a multi-palette theme selector (Ocean, Forest, Rose, Neon across light and dark modes) with persistent storage and system theme matching.
* **Comprehensive Test Suites:** Added automated Vitest suites covering the chunking protocol, transfer engine, signaling server similarity indexing, and child-process live-server integration tests (`QA-CHECKLIST.md` included).

### Changed
* **Cross-Browser SCTP Message Capping:** Capped maximum chunk size to 64 KiB (`MAX_CHUNK_SIZE_BYTES = 65536`) to prevent WebRTC DataChannel buffer overflows across heterogeneous browser engines (Chrome, Firefox, Safari).
* **GPU-Accelerated Transitions:** Replaced spring-based animation loops in menus and overlays with native CSS hardware-accelerated transforms and opacity transitions.
* **Responsive Header Layout:** Restructured navigation headers to prioritize status indicators alongside the logo and prevent user name clipping on compact mobile screens.

### Fixed
* **Signaling Reconnect Resilience:** Decoupled `TransferEngine` session lifecycle from socket identity updates, allowing active peer transfers to proceed uninterrupted across transient signaling disconnects and reconnects.
* **Memory Management & Blob URL Revocation:** Resolved memory leaks and premature URL revoking by introducing a 60-second grace period for completed download URLs, and explicitly releasing memory when transfers are canceled or dismissed.
* **Notification Permission State:** Fixed notification toggle to only register notification listeners when browser permissions are explicitly approved by the user.
