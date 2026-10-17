import { useEffect, useRef, useState, useCallback } from 'react';
import { extractRoomCode } from '../lib/qrScanner';

export function QrScanner({ onScan, onCancel }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const animFrameRef = useRef(null);
  const canvasRef = useRef(null);
  const jsQrRef = useRef(null);

  // Keep latest callbacks in refs to prevent parent re-renders from triggering camera restarts
  const onScanRef = useRef(onScan);
  const onCancelRef = useRef(onCancel);
  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);
  useEffect(() => {
    onCancelRef.current = onCancel;
  }, [onCancel]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [facingMode, setFacingMode] = useState('environment');
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);
  const [scanLocked, setScanLocked] = useState(false);

  // Check if multiple camera devices exist
  useEffect(() => {
    let mounted = true;
    if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
      navigator.mediaDevices.enumerateDevices().then((devices) => {
        if (!mounted) return;
        const videoInputs = devices.filter((d) => d.kind === 'videoinput');
        if (videoInputs.length > 1) {
          setHasMultipleCameras(true);
        }
      }).catch(() => {
        // Device enumeration unsupported or restricted
      });
    }
    return () => {
      mounted = false;
    };
  }, []);

  const stopStream = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopStream();
    };
  }, [stopStream]);

  // Start scanning frame loop - stable reference using refs
  const startScanningLoop = useCallback(async () => {
    // Dynamically load jsQR if not already cached
    if (!jsQrRef.current) {
      try {
        const mod = await import('jsqr');
        jsQrRef.current = mod.default || mod;
      } catch (err) {
        console.warn('Failed to load jsQR module:', err);
      }
    }

    if (!canvasRef.current) {
      canvasRef.current = document.createElement('canvas');
    }
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    let barcodeDetector = null;
    if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
      try {
        barcodeDetector = new window.BarcodeDetector({ formats: ['qr_code'] });
      } catch {
        barcodeDetector = null;
      }
    }

    const scanFrame = async () => {
      const video = videoRef.current;
      if (!video || video.readyState < 2) {
        animFrameRef.current = requestAnimationFrame(scanFrame);
        return;
      }

      let detectedText = null;

      // Fast-path: Native BarcodeDetector (Chrome/Edge/Android)
      if (barcodeDetector) {
        try {
          const barcodes = await barcodeDetector.detect(video);
          if (barcodes && barcodes.length > 0 && barcodes[0].rawValue) {
            detectedText = barcodes[0].rawValue;
          }
        } catch {
          // Native detector frame failed, continue to jsQR fallback
        }
      }

      // Fallback: jsQR decoder
      if (!detectedText && jsQrRef.current && ctx) {
        if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
          canvas.width = video.videoWidth || 640;
          canvas.height = video.videoHeight || 480;
        }

        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const qrCode = jsQrRef.current(imgData.data, imgData.width, imgData.height, {
          inversionAttempts: 'dontInvert'
        });

        if (qrCode && qrCode.data) {
          detectedText = qrCode.data;
        }
      }

      if (detectedText) {
        const roomCode = extractRoomCode(detectedText);
        if (roomCode) {
          setScanLocked(true);
          // Haptic feedback if supported
          if (typeof navigator !== 'undefined' && navigator.vibrate) {
            try {
              navigator.vibrate(100);
            } catch {
              // Ignore vibration errors
            }
          }
          stopStream();
          onScanRef.current?.(roomCode);
          return;
        }
      }

      animFrameRef.current = requestAnimationFrame(scanFrame);
    };

    animFrameRef.current = requestAnimationFrame(scanFrame);
  }, [stopStream]);

  // Request camera and setup video - ONLY depends on facingMode, immune to parent re-renders
  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setLoading(false);
      setError('Camera access is not supported on this browser or connection.');
      return;
    }

    const startCamera = async () => {
      stopStream();

      let stream = null;
      // 1. Try with preferred facingMode
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: facingMode },
            width: { ideal: 640 },
            height: { ideal: 480 }
          },
          audio: false
        });
      } catch (firstErr) {
        // 2. Fallback to any available video track (e.g. laptop webcam without environment camera)
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        } catch (fallbackErr) {
          if (!mounted) return;
          setLoading(false);
          const errName = fallbackErr.name || firstErr.name;
          if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError') {
            setError('Camera permission denied. Please allow camera access in your browser settings.');
          } else if (errName === 'NotFoundError' || errName === 'DevicesNotFoundError') {
            setError('No camera detected on this device.');
          } else if (errName === 'NotReadableError' || errName === 'TrackStartError') {
            setError('Camera is in use by another application.');
          } else {
            setError('Could not access camera. Please enter the room code manually.');
          }
          return;
        }
      }

      if (!mounted) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          if (!mounted) return;
          setLoading(false);
          videoRef.current.play().catch(() => {
            // Autoplay might require user interaction in some contexts
          });
          startScanningLoop();
        };
      }
    };

    startCamera();

    return () => {
      mounted = false;
      stopStream();
    };
  }, [facingMode, startScanningLoop, stopStream]);

  const handleFlip = () => {
    setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'));
  };

  return (
    <div className="room-scanner-container" role="region" aria-label="Room QR Scanner">
      <div className={`room-scanner-viewfinder${scanLocked ? ' scan-locked' : ''}`}>
        {loading && (
          <div className="room-scanner-loading">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="server-status-loader" aria-hidden="true">
              <path d="M12 2v4" />
              <path d="m16.2 7.8 2.9-2.9" />
              <path d="M18 12h4" />
              <path d="m16.2 16.2 2.9 2.9" />
              <path d="M12 18v4" />
              <path d="m4.9 19.1 2.9-2.9" />
              <path d="M2 12h4" />
              <path d="m4.9 4.9 2.9 2.9" />
            </svg>
            <span>Starting camera...</span>
          </div>
        )}

        {error ? (
          <div className="room-scanner-error" role="alert">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="1" y1="1" x2="23" y2="23" />
              <path d="M21 21H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3m3-3h6l2 3h4a2 2 0 0 1 2 2v9.34m-7.72-2.06a4 4 0 1 1-5.56-5.56" />
            </svg>
            <p>{error}</p>
          </div>
        ) : (
          <>
            <video
              ref={videoRef}
              className="room-scanner-video"
              playsInline
              autoPlay
              muted
              aria-label="Camera preview for QR code scanning"
            />
            {!loading && (
              <div className="room-scanner-reticle" aria-hidden="true">
                <span className="reticle-corner top-left" />
                <span className="reticle-corner top-right" />
                <span className="reticle-corner bottom-left" />
                <span className="reticle-corner bottom-right" />
                <div className="reticle-laser" />
              </div>
            )}
          </>
        )}
      </div>

      <div className="room-scanner-controls">
        <button
          type="button"
          className="btn btn-secondary room-scanner-cancel-btn"
          onClick={() => {
            stopStream();
            onCancelRef.current?.();
          }}
        >
          Cancel & Enter Code
        </button>

        {hasMultipleCameras && !error && !loading && (
          <button
            type="button"
            className="btn btn-secondary room-scanner-flip-btn"
            onClick={handleFlip}
            title="Switch front / rear camera"
            aria-label="Switch front / rear camera"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M20 10c0-4.418-3.582-8-8-8s-8 3.582-8 8c0 2.21 1.05 4.17 2.7 5.5" />
              <path d="M4 14c0 4.418 3.582 8 8 8s8-3.582 8-8c0-2.21-1.05-4.17-2.7-5.5" />
              <polyline points="1 10 5 10 5 6" />
              <polyline points="23 14 19 14 19 18" />
            </svg>
            <span>Flip</span>
          </button>
        )}
      </div>
    </div>
  );
}
