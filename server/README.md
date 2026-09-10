# LAN Share — Signaling Server

Lightweight Node.js Express + Socket.IO signaling service for LAN Share. See the [root README](../README.md) for full architecture, security design, and deployment instructions.

## What It Does
* **Peer Discovery & Clustering:** Uses `SimilarityIndex` to partition connected devices into clusters based on public IP, LAN subnet, and STUN WAN hash without global $O(N^2)$ broadcasts.
* **WebRTC Handshake Relay:** Relays lightweight (~2 KB) SDP offers, answers, and ICE candidates between authenticated peers.
* **Privacy & Isolation:** Does not inspect, proxy, or store any file transfers or chat messages. All transfers flow directly peer-to-peer via WebRTC DataChannels.
* **Security & Hardening:** Enforces authenticated socket sender identities (spoofed sender IDs are overwritten), rate-limits signaling traffic, validates payload schemas, and auto-disconnects abusive sockets.

## Commands

```bash
npm install     # Install dependencies
npm run dev     # Start development server with file watching on :3001
npm start       # Start production server (listens on PORT or 3001)
npm test        # Run Vitest test suite (similarity index, clustering, rate limiting)
```

## Structure

```
server/
├── index.js      # Express app, Socket.IO handlers, connection rate limiting
├── lib.js        # SimilarityIndex, subnet extraction, candidate clustering
└── lib.test.js   # Automated Vitest unit test suite (28 tests)
```
