/**
 * Extracts and normalizes a room code from raw scanned QR code text.
 * Handles full URLs with #room= or ?room=, as well as raw alphanumeric codes.
 *
 * @param {string} raw - The raw text decoded from the QR code.
 * @returns {string|null} The normalized room code, or null if invalid.
 */
export function extractRoomCode(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();

  // 1. Try matching room= in URL query or hash: #room=123456 or ?room=123456
  const match = trimmed.match(/(?:^|[/?&;#])room=([A-Za-z0-9_-]+)(?:[/?&;#]|$)/i);
  if (match && match[1]) {
    return match[1].slice(0, 16).toUpperCase();
  }

  // 2. Direct alphanumeric room code (4 to 16 characters, e.g., 492810, ROOM-42)
  if (/^[A-Za-z0-9_-]{4,16}$/.test(trimmed)) {
    return trimmed.toUpperCase();
  }

  return null;
}
