# Future Roadmap & Architectural Notes

This document captures planned enhancements, platform-specific optimizations, and scalability considerations for future iterations of LAN Share.

---

## 1. Mobile Direct-to-Disk Streaming (OPFS)

### Context & Problem
* On desktop Chromium browsers (Chrome, Edge), large files stream directly to disk using the File System Access API (`window.showSaveFilePicker`), allowing multi-gigabyte transfers with virtually zero RAM footprint.
* Mobile browsers (Android Chrome, iOS Safari) and Firefox currently do not expose `showSaveFilePicker`. They fall back to in-memory buffering (`ArrayBuffer` chunks assembled into a `Blob`), which is capped at 2 GB and can cause tab memory pressure on devices with limited RAM.

### Proposed Architecture
* **Target API:** Origin Private File System (OPFS) via `navigator.storage.getDirectory()`, supported in Android Chrome 102+, iOS Safari 15.2+, and desktop Firefox.
* **Implementation Plan:**
  1. Detect OPFS capability when `canStreamSave()` is false.
  2. Create a temporary draft file in OPFS:
     ```javascript
     const root = await navigator.storage.getDirectory();
     const draftHandle = await root.getFileHandle(`transfer-${fileId}.tmp`, { create: true });
     const writable = await draftHandle.createWritable();
     ```
  3. Stream incoming WebRTC data chunks directly to the OPFS file stream, keeping heap memory constant (< 10 MB).
  4. Once `FILE_END` is received and SHA-256 integrity is verified, export the completed file to the user's Downloads via an object URL or the Web Share API (`navigator.share`), then delete the temporary OPFS handle.

---

## 2. Signaling Server Scalability (IP Hash Bucketing)

### Context & Problem
* The current signaling server coalesces user updates and runs `getVisibleUsersFor(users, user)` across all connected sockets in `emitUsersUpdateForAllUsers()`.
* This comparison is $O(N^2)$ where $N$ is total concurrent connections. While trivial for dozens of users (< 2 ms in Node.js), it could become CPU-intensive if concurrent connections reach hundreds or thousands on a free-tier hosting instance (e.g., Render's shared 0.1 vCPU).

### Proposed Architecture
* **Bucket Partitioning:** Instead of a flat `users = {}` dictionary, partition users by public IP:
  ```javascript
  // ip -> Set of socketIds
  const ipBuckets = new Map();
  ```
* **Targeted Lookups:**
  1. When a user connects or updates, look up only the sockets in the same public IP bucket.
  2. Reduces comparisons from global $O(N^2)$ to $O(M^2)$ where $M$ is the number of devices on the exact same network (typically 2–5 devices).
  3. When an update occurs, emit only to affected sockets in that bucket rather than broadcasting to all global connections.

---

## 3. 100% Offline / Local Companion Mode

### Context & Problem
* Web browsers are sandboxed by design and cannot listen to raw UDP broadcasts, multicast (`224.0.0.251`), or mDNS on the local subnet without native OS privileges.
* As a result, the initial ~2 KB WebRTC handshake requires an accessible signaling server (e.g., hosted on Render). Once connected, transfers are 100% direct LAN speed.

### Proposed Architecture (Zero-Internet Environments)
* **Local Companion Server:** A lightweight, standalone CLI executable (Node.js single-file executable, Go binary, or Tauri desktop wrapper).
* **Workflow:**
  1. Running the companion on any laptop or PC starts the local signaling server and serves the static client on port 3001.
  2. Devices on the local Wi-Fi / offline travel router open `http://<laptop-local-ip>:3001` or scan a terminal QR code.
  3. Discovery and transfers run 100% offline with zero internet access required.

---

## 4. TURN Relay for AP / Client Isolation Networks

### Context & Problem
* On strict public Wi-Fi networks (hotels, airports, university dorms), routers often enable **Client / AP Isolation**, preventing devices on the same Wi-Fi from opening direct private IP-to-IP UDP sockets.

### Proposed Architecture
* LAN Share already supports standard TURN environment variables (`VITE_TURN_URL`, `VITE_TURN_USERNAME`, `VITE_TURN_CREDENTIAL`).
* **Future Work:**
  1. Document easy self-hosted Coturn setup instructions or free-tier TURN providers (e.g. Metered, OpenRelay) for users deploying on isolated networks.
  2. Implement an automatic network test warning when AP isolation is detected (ICE connection state fails to reach `connected` within 10 seconds despite matching network fingerprints).
