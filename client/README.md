# LAN Share — client

React 19 + Vite SPA. See the [root README](../README.md) for architecture,
deployment, and the full feature list.

## Commands

```bash
npm run dev      # vite --host (LAN-accessible dev server)
npm run build    # production build to dist/
npm run preview  # serve the production build locally
npm run lint     # eslint
npm test         # vitest (includes live-server integration tests)
```

## Structure

```
src/
  App.jsx                  # app shell: header, radar, history, popups, panels
  components/              # DeviceList (radar), FileItem, HistoryPanel, ChatPanel, QrPopup
  hooks/
    useSignaling.js        # socket.io connection, discovery, device identity
    useWebRTC.js           # thin React binding for the transfer engine
  lib/
    transferEngine.js      # per-peer connections, streaming transfers, chat
    protocol.js            # wire protocol constants and negotiation helpers
    clipboard.js           # clipboard with insecure-origin fallback
    notifications.js       # browser notification helpers
    sound.js               # WebAudio notification blip
    __tests__/             # vitest suites (mock WebRTC + real-server integration)
```
