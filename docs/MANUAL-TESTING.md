# Manual Cross-Device Testing Guide

This guide outlines practical verification scenarios to test LAN Share across physical devices (smartphones, tablets, and computers) and different local network topologies.

While automated test suites (`npm test`) provide comprehensive coverage for the signaling protocol, cryptographic verification, and state machines, real-world manual verification ensures seamless interoperability across operating systems, browser storage engines, and physical Wi-Fi routers.

---

## 1. Discovery & Room Pairing

- [ ] **LAN Radar:** Both devices connected to the same Wi-Fi appear on each other's radar within ~3–5 seconds.
- [ ] **Room Code Creation:** Click **Rooms** in the header, generate a 6-digit code (e.g., `492810`), and verify the room status badge shows `In Room`.
- [ ] **QR Code Scanning:** Scan the room QR code using a smartphone camera; verify the browser opens and auto-joins the room (`#room=492810`).
- [ ] **In-App Camera QR Scanner:** In the Rooms modal, click **"Scan with Camera"** and scan another device's screen; verify instant detection and automatic room join.
- [ ] **Peer Isolation:** Devices in the room see each other; devices outside the room remain hidden.
- [ ] **Leave Room:** Click **Leave Room** on either device; verify both return to the default local radar.

---

## 2. File Transfer & Telemetry

- [ ] **Honest Pre-Connection Status:** Pick a file on the sender. Verify the status displays **"Connecting to device…"** (never "Waiting for accept") while WebRTC establishes.
- [ ] **Offered State:** Once connected, verify the sender displays **"Offered to peer (ready to download)"**.
- [ ] **Connection Mode Badge & Live RTT:** Inspect the transfer mode badge. On direct Wi-Fi, verify it displays **"Local Wi-Fi Transfer"** with live latency (e.g. `~1 ms`), confirming traffic routes directly on local Wi-Fi.
- [ ] **Passive Receiver Queue:** The file appears in the receiver's history with a **"Download"** button.
- [ ] **Live Telemetry:** Click **Download**. Verify both devices show live progress (%), speed (MB/s), and ETA.
- [ ] **SHA-256 Verification:** On completion, verify the green **"Sent & verified (SHA-256)"** badge appears and a completion chime plays.

---

## 3. Large Files & Cross-Platform Storage

- [ ] **Desktop Downloads:** Click Download on a large file on a computer. Verify the file save dialog appears, the transfer completes smoothly, and the file opens properly.
- [ ] **Mobile Uploads:** Send a photo or video from a smartphone to a computer. Verify the upload progress moves steadily without freezing.
- [ ] **Mobile Downloads:** Receive a large file on a smartphone. Verify the download finishes without crashing the mobile browser and opens the system Share/Save menu.
- [ ] **Screen Wake Lock:** During an active transfer on mobile, verify the phone screen stays awake and does not go dark or auto-lock.

---

## 4. Network Interruptions & Resumption

- [ ] **Brief Wi-Fi Interruption (< 8s):** Toggle Wi-Fi off and on during an active transfer. Verify the transfer pauses and resumes automatically without restarting from 0%.
- [ ] **Restart Transfer:** If a connection is completely lost, verify the receiver shows **"Restart Transfer"**, and clicking it restarts without the sender needing to re-select the file.

---

## 5. AP Isolation & Cloud Relay Fallback

- [ ] **150 MB Relay Cap:** On a connection using cloud relay (`relay-turn`), verify files > 150 MB are blocked with a clear message explaining the free-tier relay cap.
- [ ] **Hotspot Guide:** Click **"View Mobile Hotspot Guide"** and verify the 3-step guide displays clearly.
- [ ] **Strict Local Mode:** Toggle "Strict Local Mode" in settings; verify all cloud relays are disabled for 100% private LAN transfers.

---

## 6. Peer-to-Peer Chat

- [ ] **Messaging:** Send a message from the peer popup; verify instant delivery over the DataChannel.
- [ ] **Links & Formatting:** Send a URL and a code snippet; verify clickable links and monospace code blocks.
- [ ] **Unread Badge:** An unread count badge appears on the peer's radar node when the chat panel is closed.
