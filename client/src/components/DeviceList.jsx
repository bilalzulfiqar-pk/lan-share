import React, { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import '../App.css';

// Deterministic pseudo-random number generator based on string seed
const seededRandom = (seed) => {
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
        hash = seed.charCodeAt(i) + ((hash << 5) - hash);
    }
    const x = Math.sin(hash) * 10000;
    return x - Math.floor(x);
};

export const DeviceList = ({ devices, onToogle, selectedDevice }) => {
    // Generate positions for devices
    const devicePositions = useMemo(() => {
        return devices.map(device => {
            const seed = device.id;
            // Angle between 0 and 360
            const angle = seededRandom(seed + 'angle') * 360;
            // Radius between 30% and 130px (approx 3rd circle)
            // Max radius of container is about 150-200px based on circles
            // Let's use % relative to center
            const radius = 60 + seededRandom(seed + 'dist') * 140; // 60px to 200px

            return {
                ...device,
                angle,
                radius
            };
        });
    }, [devices]);

    return (
        <div className="radar-container">
            {/* Concentric Circles */}
            <div className="radar-circle"></div>
            <div className="radar-circle"></div>
            <div className="radar-circle"></div>
            <div className="radar-circle"></div>

            {/* Scanning Beam */}
            <div className="radar-beam-sector"></div>

            {/* Center (Self) */}
            <div className="radar-center" title="You are here"></div>

            {/* Devices */}
            <AnimatePresence>
                {devicePositions.map((device) => {
                    const x = Math.cos(device.angle * Math.PI / 180) * device.radius;
                    const y = Math.sin(device.angle * Math.PI / 180) * device.radius;

                    return (
                        <motion.div
                            key={device.id}
                            className={`radar-blip ${selectedDevice === device.id ? 'selected' : ''}`}
                            style={{
                                top: `calc(50% + ${y}px)`,
                                left: `calc(50% + ${x}px)`,
                            }}
                            onClick={() => onToogle(device.id)}
                            initial={{ scale: 0, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0, opacity: 0 }}
                            transition={{ type: 'spring', stiffness: 200, damping: 15 }}
                        >
                            <div className="radar-blip-icon">
                                {selectedDevice === device.id ? (
                                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <polyline points="20 6 9 17 4 12"></polyline>
                                    </svg>
                                ) : (
                                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                         <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
                                         <line x1="8" y1="21" x2="16" y2="21"></line>
                                         <line x1="12" y1="17" x2="12" y2="21"></line>
                                    </svg>
                                )}
                            </div>
                            <div className="radar-blip-label">
                                {device.name || 'Unknown'}
                            </div>
                        </motion.div>
                    );
                })}
            </AnimatePresence>
            
            {devices.length === 0 && (
                <div style={{
                    position: 'absolute', 
                    bottom: '20px', 
                    color: 'var(--text-tertiary)',
                    fontSize: '0.85rem',
                    textAlign: 'center',
                    animation: 'pulse 2s infinite'
                }}>
                    Scanning Local Network...
                </div>
            )}
        </div>
    );
};
