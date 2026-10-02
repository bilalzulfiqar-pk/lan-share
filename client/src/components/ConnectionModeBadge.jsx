import React, { useState, useRef, useEffect, useCallback } from 'react';
import { MODE_CONFIG } from '../lib/connectionModes';

export function ConnectionModeBadge({ mode = 'direct-lan', className = '', showInfo = true, defaultPinned = false }) {
    const [isPinned, setIsPinned] = useState(defaultPinned);
    const [isHovered, setIsHovered] = useState(false);
    const containerRef = useRef(null);
    const leaveTimerRef = useRef(null);

    const isOpen = isPinned || isHovered;

    // Normalize mode fallback
    const resolvedMode = MODE_CONFIG[mode] ? mode : 'direct-lan';
    const config = MODE_CONFIG[resolvedMode];

    const clearLeaveTimer = useCallback(() => {
        if (leaveTimerRef.current) {
            clearTimeout(leaveTimerRef.current);
            leaveTimerRef.current = null;
        }
    }, []);

    const handleMouseEnter = useCallback(() => {
        clearLeaveTimer();
        setIsHovered(true);
    }, [clearLeaveTimer]);

    const handleMouseLeave = useCallback(() => {
        clearLeaveTimer();
        leaveTimerRef.current = setTimeout(() => {
            setIsHovered(false);
        }, 70);
    }, [clearLeaveTimer]);

    const handleTogglePin = useCallback((e) => {
        e.stopPropagation();
        clearLeaveTimer();
        setIsPinned((prev) => !prev);
    }, [clearLeaveTimer]);

    const handleClose = useCallback(() => {
        clearLeaveTimer();
        setIsPinned(false);
        setIsHovered(false);
    }, [clearLeaveTimer]);

    useEffect(() => {
        return () => clearLeaveTimer();
    }, [clearLeaveTimer]);

    useEffect(() => {
        if (!isOpen) return;

        const onDocClick = (e) => {
            if (containerRef.current && !containerRef.current.contains(e.target)) {
                handleClose();
            }
        };

        const onKeyDown = (e) => {
            if (e.key === 'Escape') {
                handleClose();
            }
        };

        document.addEventListener('pointerdown', onDocClick);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('pointerdown', onDocClick);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [isOpen, handleClose]);

    return (
        <span
            ref={containerRef}
            className={`conn-mode-badge-wrapper ${className}`}
            onClick={(e) => e.stopPropagation()}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
        >
            <span
                className={`conn-mode-badge ${config.badgeClass} ${isPinned ? 'is-pinned' : ''}`}
                title={`Transfer mode: ${config.label}${isPinned ? ' (Pinned open)' : ''}`}
                onClick={handleTogglePin}
            >
                <span className={`conn-mode-dot ${config.dotColor}`} aria-hidden="true" />
                <span className="conn-mode-label">{config.label}</span>
                {showInfo && (
                    <button
                        type="button"
                        className={`conn-mode-info-btn ${isPinned ? 'is-pinned' : ''}`}
                        onClick={handleTogglePin}
                        aria-expanded={isOpen}
                        aria-label={`Transfer mode info for ${config.label}${isPinned ? ' (Pinned open)' : ''}`}
                        title={isPinned ? 'Click to unpin details' : 'Click to lock transfer mode details'}
                    >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <circle cx="12" cy="12" r="10" />
                            <line x1="12" y1="16" x2="12" y2="12" />
                            <line x1="12" y1="8" x2="12.01" y2="8" />
                        </svg>
                    </button>
                )}
            </span>

            {showInfo && (
                <div
                    className={`conn-mode-popover ${isOpen ? 'is-open' : ''}`}
                    role="dialog"
                    aria-modal="false"
                    aria-label={`${config.title} details`}
                    onClick={(e) => e.stopPropagation()}
                    onMouseEnter={handleMouseEnter}
                    onMouseLeave={handleMouseLeave}
                >
                    <div className="conn-mode-popover-header">
                        <div className="conn-mode-popover-title-row">
                            <span className={`conn-mode-dot ${config.dotColor}`} aria-hidden="true" />
                            <h4 className="conn-mode-popover-title">{config.title}</h4>
                        </div>
                        <div className="conn-mode-popover-actions">
                            {isPinned && (
                                <button
                                    type="button"
                                    className="conn-mode-pinned-chip"
                                    onClick={handleTogglePin}
                                    title="Pinned open. Click to unpin"
                                    aria-label="Unpin transfer mode details"
                                    data-testid="conn-mode-pinned-indicator"
                                >
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                        <line x1="12" y1="17" x2="12" y2="22" />
                                        <path d="M5 17h14v-2l-2-2V5h1V3H6v2h1v8l-2 2v2z" />
                                    </svg>
                                    <span>Pinned</span>
                                </button>
                            )}
                            <button
                                type="button"
                                className="conn-mode-popover-close"
                                onClick={handleClose}
                                aria-label="Close transfer details"
                                title="Close"
                            >
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    <path d="M18 6 6 18" />
                                    <path d="m6 6 12 12" />
                                </svg>
                            </button>
                        </div>
                    </div>

                    <p className="conn-mode-popover-desc">{config.description}</p>

                    <div className={`conn-mode-popover-why-block ${config.badgeClass}`}>
                        <span className="conn-mode-why-label">Why this mode is active:</span>
                        <p className="conn-mode-why-text">{config.why}</p>
                    </div>

                    {config.tip && (
                        <div className="conn-mode-popover-tip-block">
                            <p className="conn-mode-tip-text">{config.tip}</p>
                        </div>
                    )}
                </div>
            )}
        </span>
    );
}

export default ConnectionModeBadge;
