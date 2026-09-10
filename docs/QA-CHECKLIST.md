# Manual QA Checklist

Run through this after deploying (or before a release) with at least two
devices on the same Wi-Fi — ideally one laptop (Chrome or Edge) and one phone.

## Setup

- [ ] Server: `cd server && npm start` (or the deployed Render URL)
- [ ] Client: `cd client && npm run dev` (or the deployed Vercel URL)
- [ ] Both devices open the app and appear on each other's radar within ~5 s

## Discovery & identity

- [ ] Renaming your device updates on the peer's radar after a short delay (~0.5 s debounce)
- [ ] Refreshing the page keeps your display name, device ID, theme and chat history
- [ ] Opening the app in a second tab replaces (not duplicates) your radar presence
- [ ] A phone shows the phone icon on the other device's radar (desktop shows a monitor)

## File transfer — core

- [ ] Small file (< 10 MB): offer → Download → completes with a "Verified" badge → Save works
- [ ] Completed download URL remains functional for at least 60 seconds (grace period) and cleans up cleanly without memory leaks
- [ ] Progress shows live % and speed/ETA on both sides
- [ ] Two files requested at the same time from the same sender both complete, both verified
- [ ] Cancel during an active transfer stops it on both sides
- [ ] Transferring to device B does not interrupt an ongoing session with device A

## File transfer — large files

- [ ] Chrome/Edge, > 512 MB: clicking Download opens a save dialog up front and streams
      straight to disk (RAM usage stays low in Task Manager)
- [ ] A multi-GB file (e.g. 5 GB) completes on Chrome/Edge without the tab crashing
- [ ] Safari/Firefox: files up to 2 GB work via the memory path; larger shows a clear error
- [ ] SHA-256 digest mismatch is detected (hard to trigger manually — trust the unit tests)

## Robustness

- [ ] Minimize/switch away from the sender's tab mid-upload — the upload continues
- [ ] Brief Wi-Fi interruption (< 8 s) does not kill an established session
- [ ] Signaling reconnect resilience: Temporarily disconnecting/reconnecting the signaling server mid-transfer does not abort active P2P transfers
- [ ] Closing the sender's tab mid-transfer marks the transfer as errored on the receiver
- [ ] AP / Client Isolation detection: A device that never answers times out (~20 s) with:
      "Device did not respond. If you are on hotel, university, or public Wi-Fi, the router may have Client Isolation enabled."
      (surfaces in both the transfer history status badge and the top global error banner)

## Chat

- [ ] Chat opens from the device popup; messages deliver both ways
- [ ] Tap a message to copy it; URLs are clickable; long keys render in monospace
- [ ] Unread badge appears on the radar blip when a message arrives while chat is closed
- [ ] Chat history survives a page refresh
- [ ] Chatting with one peer while transferring files with another works simultaneously

## QR & drag & drop

- [ ] Header QR button shows a scannable code; scanning it on a phone opens the app
- [ ] Dragging files onto a radar blip highlights it and sends on drop
- [ ] Dragging files anywhere shows the overlay; drop sends to the selected device

## Notifications & PWA

- [ ] Bell toggle asks for permission once; blip + notification arrive for files/messages
      while the tab is hidden
- [ ] "Install app" appears in browser menu; installed app opens standalone with themed
      status bar color

## Server / security

- [ ] `GET /health` on the server returns `{"ok":true}`
- [ ] Relaying an offer with a spoofed `sender` field has no effect (sender is overridden
      by the socket id)
- [ ] Rapid-fire signaling from a script gets rate-limited (watch server logs)

## Themes & a11y

- [ ] All 8 themes render; theme-color meta and favicon update on switch
- [ ] Keyboard: file actions, chat input, menus are reachable; focus rings visible
- [ ] `prefers-reduced-motion` disables spring animations
