# LAN Share

Share files and messages directly between devices on the same network — no
uploads, no accounts, no file size limits in the browser you already have.

LAN Share uses a lightweight handshake (~2 KB) to discover devices on your
Wi-Fi automatically, then transfers everything directly peer-to-peer over
WebRTC at full local network speed. Your files never touch a server.

## Features

- **Automatic discovery** — devices on the same network appear on the radar;
  no pairing codes needed to connect
- **Large file transfers** — files stream in chunks straight from disk and
  (on Chrome/Edge desktop) straight to disk on the receiver, so multi-gigabyte files
  work without loading them into memory. Every transfer is verified with a
  SHA-256 digest
- **Parallel & multi-device** — download several files at once, stay
  connected to several devices at once
- **Chat** — send links, API keys or passwords to your other devices; tap any
  message to copy it
- **QR join code** — let a phone hop on by scanning a code
- **Drag & drop** — drop files on a device, or anywhere on the page
- **Installable (PWA)** — installs to your phone's home screen
- **Notifications** — get a blip when files or messages arrive in a
  background tab
- **8 themes**, responsive layout, reduced-motion support

## How it works

```
┌─────────┐  signaling (socket.io)  ┌─────────┐
│ Browser │ ◄─────────────────────► │ Server  │   discovery + WebRTC
│   (A)   │                         │ (tiny)  │   handshake relay only
└────┬────┘                         └─────┬───┘
     │                                  │
     │           WebRTC                 │
     │        ┌──────────────┐          │
     └───────►│  direct P2P  │◄─────────┘
              │ files + chat │
              └──────▲───────┘
                     │
                ┌────┴────┐
                │ Browser │
                │   (B)   │
                └─────────┘
```

- **Client** (`client/`) — React 19 + Vite SPA. Device identity lives in
  `localStorage`; each browser derives network fingerprints (local subnet,
  public IP) via ICE/STUN so the server can group devices on the same network.
- **Server** (`server/`) — Express + Socket.IO. It never sees file data. It
  registers devices, tells each device which peers are on its network, and
  relays WebRTC offers/answers/candidates. Signaling senders are
  authenticated by socket (spoofed `sender` fields are overridden), relays
  are rate-limited, and payloads are validated and size-capped.
- **Transfers** — one `RTCPeerConnection` per peer with a control channel
  plus a dedicated reliable data channel per file. Chunks are sized for
  universal cross-browser reliability (up to 64 KiB) with `bufferedamountlow` backpressure,
  so uploads continue even in background tabs. Transient disconnects get a
  grace period and an ICE restart before failing.

## Getting started (local development)

```bash
# 1. Start the signaling server
cd server
npm install
npm run dev          # listens on :3001

# 2. Start the client (in a second terminal)
cd client
npm install
npm run dev          # vite --host, prints your LAN URL
```

Open the printed LAN URL (e.g. `http://192.168.x.x:5173`) on any device on
the same Wi-Fi. With `VITE_SERVER_URL` unset, the client automatically
connects to the same hostname on port 3001.

## Tests

```bash
cd client && npm test    # protocol, engine, and live-server integration tests
cd server && npm test    # sanitization, visibility, rate limiter tests
```

The engine tests run two real transfer engines against each other (WebRTC
mocked, signaling live) — covering concurrent transfers, cancellation,
glare, teardown, and integrity verification.

## Deployment

The app is designed for a static host plus a small WebSocket service:

1. **Client → Vercel** (or any static host): root directory `client/`, build
   command `npm run build`, output `dist/`. Set the environment variable
   `VITE_SERVER_URL` to your server URL at build time.
2. **Server → Render** (or similar): root directory `server/`, start command
   `npm start`. Render's `PORT` is used automatically; `GET /health` is
   provided for health checks.

### Environment variables (client, build time)

| Variable | Purpose |
| --- | --- |
| `VITE_SERVER_URL` | Signaling server URL. Empty = same-hostname port 3001 (LAN dev). |
| `VITE_TURN_URL` | Optional TURN relay (comma-separated URLs) for networks where direct P2P fails (AP isolation, strict NAT). |
| `VITE_TURN_USERNAME` / `VITE_TURN_CREDENTIAL` | TURN credentials, if your provider requires them. |

## Security & privacy

- Files and chat travel **only** between the two browsers, encrypted with
  WebRTC's built-in DTLS. The server cannot read them.
- Discovery is restricted to devices that share a local subnet, public IP,
  or matching ICE fingerprint — random internet users never see each other.
- The signaling server overrides client-supplied sender identities with the
  authenticated socket id, drops relays to unknown targets, and disconnects
  abusive sockets.

## Browser support

| Capability | Chrome / Edge (Desktop) | Mobile / Safari / Firefox |
| --- | --- | --- |
| Core sharing + chat | ✅ | ✅ |
| File transfer | Unlimited (streams straight to disk via File System Access) | In-memory buffering (ideal for photos, videos, and documents) |
| Installable PWA | ✅ | Varies |

See [`docs/QA-CHECKLIST.md`](docs/QA-CHECKLIST.md) for the full manual test
plan, and [`docs/ROADMAP.md`](docs/ROADMAP.md) for future architectural notes
and planned enhancements.

## License

Hobby project — use it, fork it, have fun.
