import { useEffect, useCallback } from 'react';
// eslint-disable-next-line no-unused-vars
import { AnimatePresence, motion } from 'framer-motion';

export function HotspotGuideModal({
  open,
  onClose,
  reduceMotion = false
}) {
  const handleClose = useCallback(() => {
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

  const openTransition = reduceMotion ? { duration: 0 } : { duration: 0.24, ease: 'easeOut' };
  const closeTransition = reduceMotion ? { duration: 0 } : { duration: 0.14, ease: 'easeIn' };

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
            className="room-card hotspot-card"
            role="dialog"
            aria-label="Mobile Hotspot Guide"
            aria-modal="true"
            data-testid="hotspot-modal"
            initial={reduceMotion ? false : { opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1, transition: openTransition }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.96, transition: closeTransition }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="room-card-header">
              <div className="room-header-title-group">
                <div className="room-header-badge-row">
                  <h3>Mobile Hotspot Direct Link</h3>
                  <span className="room-status-badge in-room">
                    <span className="room-pulse-dot" aria-hidden="true" />
                    50+ MB/s Local Speed
                  </span>
                </div>
                <p className="room-header-sub">
                  Bypass campus/hotel AP Isolation and cloud relay caps (150 MB). Transfer unlimited files directly with zero mobile data!
                </p>
              </div>

              <button
                type="button"
                className="btn-icon"
                onClick={handleClose}
                title="Close guide"
                aria-label="Close guide"
                data-testid="close-hotspot-btn"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div className="hotspot-steps-list">
              <div className="hotspot-step-card" data-testid="hotspot-step-1">
                <div className="hotspot-step-num" aria-hidden="true">1</div>
                <div className="hotspot-step-content">
                  <div className="hotspot-step-title-row">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <rect x="5" y="2" width="14" height="20" rx="3" />
                      <line x1="12" y1="18" x2="12" y2="18" />
                    </svg>
                    <h4>Turn On Phone Hotspot</h4>
                  </div>
                  <p>
                    Enable <strong>Personal Hotspot</strong> / <strong>Mobile Hotspot</strong> on your phone.
                    <span className="hotspot-highlight"> Cellular data can even be turned OFF</span> — only the phone&apos;s local Wi-Fi router chip is needed!
                  </p>
                </div>
              </div>

              <div className="hotspot-step-card" data-testid="hotspot-step-2">
                <div className="hotspot-step-num" aria-hidden="true">2</div>
                <div className="hotspot-step-content">
                  <div className="hotspot-step-title-row">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <rect x="2" y="3" width="20" height="14" rx="2" />
                      <line x1="8" y1="21" x2="16" y2="21" />
                      <line x1="12" y1="17" x2="12" y2="21" />
                    </svg>
                    <h4>Connect Your Other Device</h4>
                  </div>
                  <p>
                    Connect your laptop, tablet, or secondary phone to your phone&apos;s Wi-Fi hotspot. Both devices are now on an unrestricted local LAN.
                  </p>
                </div>
              </div>

              <div className="hotspot-step-card" data-testid="hotspot-step-3">
                <div className="hotspot-step-num" aria-hidden="true">3</div>
                <div className="hotspot-step-content">
                  <div className="hotspot-step-title-row">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                    </svg>
                    <h4>Transfer Unlimited at 50+ MB/s</h4>
                  </div>
                  <p>
                    Open LAN Share on both devices! Transfers stream directly peer-to-peer at maximum Wi-Fi speed (50+ MB/s) with <strong>zero internet data usage</strong>.
                  </p>
                </div>
              </div>
            </div>

            <div className="room-tip hotspot-explanation">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
              <span>
                <strong>Why is this needed?</strong> University, hotel, and public Wi-Fi networks block direct device-to-device traffic via AP / Client Isolation, forcing traffic onto slow cloud relays with 150 MB caps. A personal mobile hotspot creates an instant unblocked private network.
              </span>
            </div>

            <div className="room-actions-row">
              <button
                type="button"
                className="btn btn-primary room-create-btn"
                onClick={handleClose}
              >
                Got It
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
