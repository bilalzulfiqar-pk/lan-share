# Manual QA Checklist

A practical 5-minute checklist to verify LAN Share on two devices (e.g., laptop and smartphone) before a release.

---

## 1. Discovery & Room Pairing

- [ ] **LAN Radar:** Both devices on the same Wi-Fi appear on each other's radar within ~3–5 seconds.
- [ ] **Room Code Creation:** Click **Room** in the header, generate a 6-digit code (e.g., `492810`), and verify the room status badge shows `In Room`.
- [ ] **QR Code Scanning:** Scan the room QR code with a phone camera; the phone opens the app and auto-joins the room (`#room=492810`).
- [ ] **Peer Isolation:** Devices in the room see each other; devices outside the room are hidden.
- [ ] **Leave Room:** Click **Leave Room** on either device; verify both return to the default local radar.

---

## 2. File Transfer & Status Accuracy

- [ ] **Honest Pre-Connection Status:** Pick a file on the sender. Verify the status displays **"Connecting to device…"** (never "Waiting for accept") while WebRTC establishes.
- [ ] **Offered State:** Once connected, verify the sender shows **"Offered to peer (ready to download)"**.
- [ ] **Passive Receiver Queue:** The file appears in the receiver's history with a **"Download"** button.
- [ ] **Live Telemetry:** Click **Download**. Verify both sides show live progress (%), speed (MB/s), and ETA.
- [ ] **SHA-256 Verification:** On completion, verify the green **"Sent & verified (SHA-256)"** badge appears and a completion chime plays.

---

## 3. Large Files & Mobile Storage (OPFS)

- [ ] **Desktop Chrome / Edge (> 512 MB):** Clicking Download triggers `showSaveFilePicker()` and streams straight to disk with low RAM usage (< 25 MB).
- [ ] **Mobile (iOS Safari / Android Chrome):** Transfer a 500 MB–1 GB+ file to a phone. Verify the mobile tab does not crash (streams into OPFS) and opens the native Share sheet to save to Photos or Files.
- [ ] **Screen Wake Lock:** Mobile screen stays on during active transfer without sleeping after 30 seconds.

---

## 4. Network Interruptions & Resumption

- [ ] **Brief Wi-Fi Blip (< 8s):** Turn Wi-Fi off and on during an active transfer. Verify the transfer pauses and resumes automatically without restarting from 0%.
- [ ] **Restart Transfer:** If a connection is completely lost, verify the receiver shows **"Restart Transfer"**, and clicking it restarts without the sender needing to pick the file again.

---

## 5. AP Isolation & Cloud Relay Fallback

- [ ] **150 MB Relay Cap:** On a connection using cloud relay (`relay-turn`), verify files > 150 MB are blocked with a clear warning explaining the free-tier relay cap.
- [ ] **Hotspot Guide:** Click **"View Mobile Hotspot Guide"** and verify the 3-step guide displays clearly.
- [ ] **Strict Local Mode:** Toggle "Strict Local Mode" in settings; verify all cloud relays are disabled for 100% private LAN transfers.

---

## 6. Peer-to-Peer Chat

- [ ] **Messaging:** Send a message from the peer popup; verify instant delivery over the DataChannel.
- [ ] **Links & Formatting:** Send a URL and a code snippet; verify clickable links and monospace code blocks.
- [ ] **Unread Badge:** An unread count badge appears on the peer's radar node when chat is closed.
