import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import '../App.css';

export const DeviceList = ({ devices, onToogle, selectedDevice }) => {

    return (
        <div className="device-list">
            {devices.length === 0 ? (
                <div className="empty-state" style={{ minHeight: '200px', flex: 1 }}>
                    <div className="empty-icon">🔭</div>
                    <p>Scanning for devices...</p>
                </div>
            ) : (
                <AnimatePresence>
                    {devices.map((device) => (
                        <motion.div
                            key={device.id}
                            className={`device-item ${selectedDevice === device.id ? 'selected' : ''}`}
                            onClick={() => onToogle(device.id)}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.3 }}
                            layout
                        >
                            <div className="device-avatar">
                                {/* User Icon SVG */}
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                                    <circle cx="12" cy="7" r="4"></circle>
                                </svg>
                            </div>
                            <div className="device-info">
                                <span className="device-name">{device.name || 'Unknown Device'}</span>
                                <span className="device-id">{device.id}</span>
                            </div>
                            {selectedDevice === device.id && (
                                <div style={{ color: 'var(--primary)', fontWeight: 'bold' }}>
                                    ✓
                                </div>
                            )}
                        </motion.div>
                    ))}
                </AnimatePresence>
            )}
        </div>
    );
};
