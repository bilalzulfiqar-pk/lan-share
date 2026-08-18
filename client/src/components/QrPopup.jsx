import { useEffect, useRef, useState } from 'react';
// eslint-disable-next-line no-unused-vars
import { AnimatePresence, motion } from 'framer-motion';
import QRCode from 'qrcode';
import { copyText } from '../lib/clipboard';

const COPIED_FEEDBACK_MS = 1400;

// Scanners are most reliable with dark modules on a light background, so the
// code itself stays neutral while the surrounding card follows the theme.
export function QrPopup({ open, url, onClose, reduceMotion }) {
  const canvasRef = useRef(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open || !canvasRef.current || !url) return;

    QRCode.toCanvas(canvasRef.current, url, {
      width: 220,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#0b1220ff', light: '#ffffffff' }
    }).catch((error) => console.error('QR rendering failed:', error));
  }, [open, url]);

  useEffect(() => {
    if (!open) return;

    const onKey = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const handleCopy = async () => {
    const succeeded = await copyText(url);
    if (succeeded) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    }
  };

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
          onClick={onClose}
        >
          <motion.div
            className="qr-card"
            role="dialog"
            aria-label="Share this app over the network"
            initial={reduceMotion ? false : { opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1, transition: openTransition }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.96, transition: closeTransition }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="qr-card-header">
              <h3>Join on this network</h3>
              <button
                type="button"
                className="btn-icon"
                onClick={onClose}
                title="Close"
                aria-label="Close QR popup"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            </div>

            <div className="qr-canvas-frame">
              <canvas ref={canvasRef} width={220} height={220} aria-label="QR code linking to this app" />
            </div>

            <p className="qr-hint">
              Open the camera on another device connected to the same Wi-Fi and
              scan this code to start sharing.
            </p>

            <div className="qr-url-row">
              <span className="qr-url" title={url}>{url}</span>
              <button type="button" className="btn btn-sm btn-secondary" onClick={handleCopy}>
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
