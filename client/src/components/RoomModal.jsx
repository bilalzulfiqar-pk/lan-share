import { useEffect, useRef, useState, useCallback } from 'react';
// eslint-disable-next-line no-unused-vars
import { AnimatePresence, motion } from 'framer-motion';
import QRCode from 'qrcode';
import { copyText } from '../lib/clipboard';

const COPIED_FEEDBACK_MS = 1400;

export function RoomModal({
  open,
  onClose,
  roomCode,
  onJoinRoom,
  onLeaveRoom,
  reduceMotion
}) {
  const canvasElementRef = useRef(null);
  const inputRef = useRef(null);
  const [inputCode, setInputCode] = useState('');
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [showSwitchForm, setShowSwitchForm] = useState(false);
  const [prevRoomCode, setPrevRoomCode] = useState(roomCode);
  if (roomCode !== prevRoomCode) {
    setPrevRoomCode(roomCode);
    setShowSwitchForm(false);
  }

  const basePath = typeof window !== 'undefined' && window.location.pathname !== '/'
    ? window.location.pathname.replace(/\/$/, '')
    : '';
  const shareableUrl = roomCode && typeof window !== 'undefined'
    ? `${window.location.origin}${basePath}/#room=${roomCode}`
    : '';

  const renderQr = useCallback((canvas) => {
    if (!canvas || !shareableUrl) return;
    QRCode.toCanvas(canvas, shareableUrl, {
      width: 200,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#0b1220ff', light: '#ffffffff' }
    }).catch((error) => console.error('QR rendering failed:', error));
  }, [shareableUrl]);

  const canvasRef = useCallback((node) => {
    canvasElementRef.current = node;
    if (node) {
      renderQr(node);
    }
  }, [renderQr]);

  useEffect(() => {
    if (open && roomCode && canvasElementRef.current) {
      renderQr(canvasElementRef.current);
    }
  }, [open, roomCode, renderQr]);


  const handleClose = useCallback(() => {
    setInputCode('');
    setCopiedLink(false);
    setCopiedCode(false);
    setShowSwitchForm(false);
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) return;

    const onKey = (event) => {
      if (event.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, handleClose]);

  const handleCopyLink = async () => {
    if (!shareableUrl) return;
    const succeeded = await copyText(shareableUrl);
    if (succeeded) {
      setCopiedLink(true);
      window.setTimeout(() => setCopiedLink(false), COPIED_FEEDBACK_MS);
    }
  };

  const handleCopyCode = async () => {
    if (!roomCode) return;
    const succeeded = await copyText(roomCode);
    if (succeeded) {
      setCopiedCode(true);
      window.setTimeout(() => setCopiedCode(false), COPIED_FEEDBACK_MS);
    }
  };

  const handleCreateRandom = () => {
    let randomCode;
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      const arr = new Uint32Array(1);
      crypto.getRandomValues(arr);
      randomCode = (100000 + (arr[0] % 900000)).toString();
    } else {
      randomCode = Math.floor(100000 + Math.random() * 900000).toString();
    }
    onJoinRoom(randomCode);
  };

  const handleJoinSubmit = (e) => {
    e.preventDefault();
    const sanitized = inputCode.replace(/\s+/g, '').toUpperCase().slice(0, 16);
    if (sanitized && /^[A-Z0-9_-]+$/.test(sanitized)) {
      onJoinRoom(sanitized);
      setInputCode('');
    }
  };

  const handleLeave = () => {
    onLeaveRoom();
  };

  const openTransition = reduceMotion ? { duration: 0 } : { duration: 0.26, ease: [0.25, 1, 0.5, 1] };
  const closeTransition = reduceMotion ? { duration: 0 } : { duration: 0.18, ease: [0.4, 0, 1, 1] };
  const layoutTransition = reduceMotion ? { duration: 0 } : { duration: 0.28, ease: [0.25, 1, 0.5, 1] };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="qr-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: openTransition }}
          exit={{ opacity: 0, transition: closeTransition }}
          onClick={handleClose}
        >
          <motion.div
            className="room-card"
            role="dialog"
            aria-label="Room Pairing Modal"
            aria-modal="true"
            layout={!reduceMotion}
            transition={layoutTransition}
            initial={reduceMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0, transition: openTransition }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 6, transition: closeTransition }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="room-card-header">
              <div className="room-header-title-group">
                <div className="room-header-badge-row">
                  <h3>Room Pairing</h3>
                  <AnimatePresence mode="wait" initial={false}>
                    {roomCode ? (
                      <motion.span
                        key="in-room-badge"
                        className="room-status-badge in-room"
                        data-testid="in-room-badge"
                        initial={reduceMotion ? false : { opacity: 0 }}
                        animate={{ opacity: 1, transition: { duration: 0.22, ease: [0.25, 1, 0.5, 1] } }}
                        exit={reduceMotion ? { opacity: 0 } : { opacity: 0, transition: { duration: 0.14, ease: [0.4, 0, 1, 1] } }}
                      >
                        <span className="room-pulse-dot" aria-hidden="true" />
                        In Room: {roomCode}
                      </motion.span>
                    ) : (
                      <motion.span
                        key="radar-badge"
                        className="room-status-badge radar"
                        initial={reduceMotion ? false : { opacity: 0 }}
                        animate={{ opacity: 1, transition: { duration: 0.22, ease: [0.25, 1, 0.5, 1] } }}
                        exit={reduceMotion ? { opacity: 0 } : { opacity: 0, transition: { duration: 0.14, ease: [0.4, 0, 1, 1] } }}
                      >
                        Better Discovery
                      </motion.span>
                    )}
                  </AnimatePresence>
                </div>
                <AnimatePresence mode="wait" initial={false}>
                  <motion.p
                    key={roomCode ? 'active-desc' : 'idle-desc'}
                    className="room-header-sub"
                    initial={reduceMotion ? false : { opacity: 0 }}
                    animate={{ opacity: 1, transition: { duration: 0.24, ease: [0.25, 1, 0.5, 1] } }}
                    exit={reduceMotion ? { opacity: 0 } : { opacity: 0, transition: { duration: 0.16, ease: [0.4, 0, 1, 1] } }}
                  >
                    {roomCode
                      ? 'Cross-network direct pairing is active. Only devices with this code can see you.'
                      : "Can't see a device nearby? Use a 6-digit room code or QR scan to pair across different Wi-Fi bands, university subnets, or mobile hotspots."}
                  </motion.p>
                </AnimatePresence>
              </div>

              <button
                type="button"
                className="btn-icon"
                onClick={handleClose}
                title="Close"
                aria-label="Close room modal"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            </div>

            <AnimatePresence mode="wait" initial={false}>
              {roomCode ? (
                <motion.div
                  key="room-active-section"
                  className="room-active-section"
                  initial={reduceMotion ? false : { opacity: 0 }}
                  animate={{ opacity: 1, transition: { duration: 0.24, ease: [0.25, 1, 0.5, 1] } }}
                  exit={reduceMotion ? { opacity: 0 } : { opacity: 0, transition: { duration: 0.16, ease: [0.4, 0, 1, 1] } }}
                >
                  <div className="room-code-showcase">
                    <span className="room-code-tag">ACTIVE ROOM CODE</span>
                    <div className="room-code-digits-row">
                      <span className="room-code-digits" data-testid="active-room-code">{roomCode}</span>
                      <button
                        type="button"
                        className="btn btn-sm btn-secondary room-copy-code-btn"
                        onClick={handleCopyCode}
                        title="Copy room code"
                      >
                        {copiedCode ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                  </div>

                  <div className="qr-canvas-frame">
                    <canvas ref={canvasRef} width={200} height={200} aria-label={`QR code for room ${roomCode}`} />
                  </div>

                  <p className="qr-hint">
                    Scan with your phone camera to pair instantly without needing to be on the same Wi-Fi subnet.
                  </p>

                  <div className="qr-url-row">
                    <span className="qr-url" title={shareableUrl}>{shareableUrl}</span>
                    <button
                      type="button"
                      className="btn btn-sm btn-secondary"
                      onClick={handleCopyLink}
                      data-testid="copy-link-btn"
                    >
                      {copiedLink ? 'Copied Link' : 'Copy Link'}
                    </button>
                  </div>

                  <div className="room-actions-row">
                    <button
                      type="button"
                      className="btn btn-secondary room-leave-btn"
                      onClick={handleLeave}
                      data-testid="leave-room-btn"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                        <polyline points="16 17 21 12 16 7" />
                        <line x1="21" y1="12" x2="9" y2="12" />
                      </svg>
                      Leave Room
                    </button>
                  </div>

                {showSwitchForm ? (
                  <div className="room-switch-box">
                    <form className="room-input-form" onSubmit={handleJoinSubmit}>
                      <div className="room-input-wrapper">
                        <input
                          ref={inputRef}
                          type="text"
                          className="room-code-input"
                          placeholder="e.g. 492810"
                          value={inputCode}
                          onChange={(e) => setInputCode(e.target.value.toUpperCase().slice(0, 16))}
                          maxLength={16}
                          autoFocus
                          aria-label="New room code"
                          data-testid="room-switch-input"
                        />
                        <button
                          type="submit"
                          className="btn btn-primary btn-auto room-join-btn"
                          disabled={!inputCode.trim()}
                        >
                          Switch
                        </button>
                      </div>
                    </form>
                    <button
                      type="button"
                      className="room-cancel-switch-btn"
                      onClick={() => setShowSwitchForm(false)}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="room-switch-btn"
                    onClick={() => setShowSwitchForm(true)}
                  >
                    Switch to a different room
                  </button>
                )}
              </motion.div>
            ) : (
              <motion.div
                key="room-join-section"
                className="room-join-section"
                initial={reduceMotion ? false : { opacity: 0 }}
                animate={{ opacity: 1, transition: { duration: 0.24, ease: [0.25, 1, 0.5, 1] } }}
                exit={reduceMotion ? { opacity: 0 } : { opacity: 0, transition: { duration: 0.16, ease: [0.4, 0, 1, 1] } }}
              >
                <button
                  type="button"
                  className="btn btn-primary room-create-btn"
                  onClick={handleCreateRandom}
                  data-testid="create-room-btn"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <circle cx="15.5" cy="8.5" r="1.5" />
                    <circle cx="15.5" cy="15.5" r="1.5" />
                    <circle cx="8.5" cy="15.5" r="1.5" />
                  </svg>
                  Create Random 6-Digit Room
                </button>

                <div className="room-divider">
                  <span>or enter an existing code</span>
                </div>

                <form className="room-input-form" onSubmit={handleJoinSubmit}>
                  <div className="room-input-wrapper">
                    <input
                      ref={inputRef}
                      type="text"
                      className="room-code-input"
                      placeholder="e.g. 492810"
                      value={inputCode}
                      onChange={(e) => setInputCode(e.target.value.toUpperCase().slice(0, 16))}
                      maxLength={16}
                      autoFocus
                      aria-label="Room code"
                      data-testid="room-code-input"
                    />
                    <button
                      type="submit"
                      className="btn btn-primary btn-auto room-join-btn"
                      disabled={!inputCode.trim()}
                      data-testid="join-room-submit-btn"
                    >
                      Join Room
                    </button>
                  </div>
                </form>

                <div className="room-tip">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="16" x2="12" y2="12" />
                    <line x1="12" y1="8" x2="12.01" y2="8" />
                  </svg>
                  <span>Anyone with this code can share files with you, even across different Wi-Fi networks or mobile hotspots.</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </motion.div>
      )}
    </AnimatePresence>
  );
}
