import React, { useMemo } from 'react';
// eslint-disable-next-line no-unused-vars
import { motion, AnimatePresence } from 'framer-motion';

const seededRandom = (seed) => {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }
  const x = Math.sin(hash) * 10000;
  return x - Math.floor(x);
};

const MonitorIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="2" y="3" width="20" height="14" rx="2" />
    <line x1="8" y1="21" x2="16" y2="21" />
    <line x1="12" y1="17" x2="12" y2="21" />
  </svg>
);

const PhoneIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="5" y="2" width="14" height="20" rx="3" />
    <line x1="12" y1="18" x2="12" y2="18" />
  </svg>
);

const RadarCenter = () => (
  <span className="radar-center" role="img" aria-label="Your device" title="You are here">
    <svg className="radar-center-rings" viewBox="0 0 48 48" aria-hidden="true">
      <circle className="radar-center-ring" cx="24" cy="24" r="7">
        <animate attributeName="r" from="7" to="20" dur="3.8s" calcMode="spline" keyTimes="0;1" keySplines="0 0 0.2 1" repeatCount="indefinite" />
        <animate attributeName="opacity" from="0.5" to="0" dur="3.8s" calcMode="spline" keyTimes="0;1" keySplines="0 0 0.2 1" repeatCount="indefinite" />
      </circle>
      <circle className="radar-center-ring" cx="24" cy="24" r="7" opacity="0">
        <animate attributeName="r" from="7" to="20" dur="3.8s" begin="1.9s" calcMode="spline" keyTimes="0;1" keySplines="0 0 0.2 1" repeatCount="indefinite" />
        <animate attributeName="opacity" from="0.5" to="0" dur="3.8s" begin="1.9s" calcMode="spline" keyTimes="0;1" keySplines="0 0 0.2 1" repeatCount="indefinite" />
      </circle>
    </svg>
    <span className="radar-center-dot" aria-hidden="true" />
  </span>
);

const detectDeviceShape = (device) => {
  const ua = (device?.userAgent || '').toLowerCase();
  if (/android|iphone|ipad|ipod|mobile/.test(ua)) return 'phone';
  return 'monitor';
};

export const DeviceList = ({ devices, onToogle, selectedDevice }) => {
  const devicePositions = useMemo(() => {
    return devices.map((device) => {
      const seed = device.id;
      const angle = seededRandom(seed + 'angle') * 360;
      const radius = 12 + seededRandom(seed + 'dist') * 32;
      return { ...device, angle, radius };
    });
  }, [devices]);

  return (
    <div className="radar-container">
      <div className="radar-circle" aria-hidden="true" />
      <div className="radar-circle" aria-hidden="true" />
      <div className="radar-circle" aria-hidden="true" />
      <div className="radar-circle" aria-hidden="true" />

      <div className="radar-beam-sector" aria-hidden="true" />
      <RadarCenter />

      <AnimatePresence>
        {devicePositions.map((device) => {
          const x = Math.cos((device.angle * Math.PI) / 180) * device.radius;
          const y = Math.sin((device.angle * Math.PI) / 180) * device.radius;
          const shape = detectDeviceShape(device);

          return (
            <motion.button
              key={device.id}
              type="button"
              className={`radar-blip ${selectedDevice === device.id ? 'selected' : ''}`}
              style={{ top: `${50 + y}%`, left: `${50 + x}%` }}
              onClick={() => onToogle(device.id)}
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 220, damping: 18 }}
              aria-label={`Select ${device.name || 'device'}`}
              aria-pressed={selectedDevice === device.id}
            >
              <div className="radar-blip-icon">
                {shape === 'phone' ? <PhoneIcon /> : <MonitorIcon />}
                <span className="radar-blip-ring" aria-hidden="true" />
              </div>
              <span className="radar-blip-label">{device.name || 'Unknown'}</span>
            </motion.button>
          );
        })}
      </AnimatePresence>

      {devices.length === 0 && (
        <div className="radar-status" role="status" aria-live="polite">
          <span className="radar-status-dot" aria-hidden="true" />
          Scanning local network…
        </div>
      )}
    </div>
  );
};
