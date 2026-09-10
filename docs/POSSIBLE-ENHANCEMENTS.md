# Possible Future Enhancements

> **Note:** These are conceptual notes, architectural ideas, and technical explorations for potential future improvements. They are not committed deliverables or scheduled releases.

---

## 1. Mobile Direct-to-Disk Streaming (OPFS)

### Context & Opportunity
* On desktop Chromium browsers (Chrome, Edge), large files stream directly to disk using the File System Access API (`window.showSaveFilePicker`), allowing multi-gigabyte transfers with virtually zero RAM overhead.
* Mobile browsers (Android Chrome, iOS Safari) and Firefox do not expose `showSaveFilePicker`. They fall back to in-memory buffering (`ArrayBuffer` chunks assembled into a `Blob`), which is capped at ~2 GB and can cause tab memory pressure on devices with limited RAM.

### Exploration Concept
* **Target API:** Origin Private File System (OPFS) via `navigator.storage.getDirectory()`, supported across modern Android Chrome, iOS Safari, and desktop Firefox.
* **Potential Flow:**
  1. Detect OPFS capability when `window.showSaveFilePicker` is not available.
  2. Create a temporary draft file in OPFS:
     ```javascript
     const root = await navigator.storage.getDirectory();
     const draftHandle = await root.getFileHandle(`transfer-${fileId}.tmp`, { create: true });
     const writable = await draftHandle.createWritable();
     ```
  3. Stream incoming WebRTC data chunks directly to the OPFS file stream, keeping memory footprint constant (< 10 MB).
  4. Once `FILE_END` is received and the SHA-256 integrity check passes, export the completed file to the user's device via the Web Share API (`navigator.share`) or an anchor download, then clean up the temporary OPFS file.

---

## 2. 100% Offline / Local Companion Mode

### Context & Opportunity
* Web browsers are sandboxed by design and cannot listen to raw UDP broadcasts, multicast (`224.0.0.251`), or mDNS on the local subnet without native operating system privileges.
* As a result, the initial ~2 KB WebRTC handshake requires an accessible signaling server (e.g., hosted on Render). Once connected, transfers are 100% direct LAN speed.

### Exploration Concept (Zero-Internet Environments)
* **Local Companion Server:** A lightweight, standalone CLI executable (Node.js single-file executable, Go binary, or Tauri desktop wrapper).
* **Potential Flow:**
  1. Running the companion on any laptop or PC starts a local signaling server and serves the static client on a local port (e.g., `3001`).
  2. Devices on the local Wi-Fi or offline travel router open `http://<laptop-local-ip>:3001` or scan a terminal QR code.
  3. Discovery and transfers run 100% offline with zero external internet access required.

---

## 3. TURN Relay Documentation & Setup Guides

### Context & Opportunity
* On strict public Wi-Fi networks (hotels, airports, university dorms), routers frequently enable **Client / AP Isolation**, preventing devices on the same Wi-Fi from opening direct private IP-to-IP UDP sockets.
* LAN Share already supports standard TURN environment variables (`VITE_TURN_URL`, `VITE_TURN_USERNAME`, `VITE_TURN_CREDENTIAL`).

### Exploration Concept
* Document straightforward setup guides for self-hosted Coturn instances or free-tier TURN providers (e.g., Metered, OpenRelay) for users who regularly operate on networks with client isolation.
