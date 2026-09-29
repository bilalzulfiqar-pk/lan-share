import React from 'react';

export function Header({
  isConnected,
  displayName,
  onNameChange,
  deviceId,
  themePickerRef,
  themeButtonRef,
  showThemeMenu,
  setShowThemeMenu,
  currentTheme,
  currentMode,
  currentSwatch,
  showQrPopup,
  setShowQrPopup,
  notifyEnabled,
  handleNotifyToggle,
  showDebugSidebar,
  toggleDebugSidebar,
  roomCode,
  onOpenRoomModal
}) {
  return (
    <header className="app-header">
      <div className="logo-section">
        <div className="logo-wrapper" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12.55a11 11 0 0 1 14.08 0"></path>
            <path d="M1.42 9a16 16 0 0 1 21.16 0"></path>
            <path d="M8.59 16.11a6 6 0 0 1 6.82 0"></path>
          </svg>
        </div>
        <div className="title-group">
          <h1>LAN Share</h1>
          <span className="mini-heading">Fast · Local · Secure</span>
        </div>
      </div>

      <div className="server-indicator" title={isConnected ? 'Server reachable' : 'Server unreachable'}>
        <div className={`status-dot ${isConnected ? 'online' : 'offline'}`} />
        <span>{isConnected ? 'Online' : 'Offline'}</span>
      </div>

      <div className="status-section">
        {/* Cyberpunk-styled Room button / badge */}
        <button
          type="button"
          className={`room-header-btn ${roomCode ? 'is-in-room' : ''}`}
          onClick={onOpenRoomModal}
          title={roomCode ? `In Room ${roomCode} — click to manage or view QR` : 'Join or create a private room to pair across networks'}
          aria-label={roomCode ? `Current room: ${roomCode}` : 'Room pairing'}
          aria-haspopup="dialog"
          data-testid="header-room-btn"
        >
          {roomCode ? (
            <>
              <span className="room-pulse-dot" aria-hidden="true" />
              <span className="room-header-hash">#</span>
              <span className="room-header-code">{roomCode}</span>
            </>
          ) : (
            <>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="4" y1="9" x2="20" y2="9" />
                <line x1="4" y1="15" x2="20" y2="15" />
                <line x1="10" y1="3" x2="8" y2="21" />
                <line x1="16" y1="3" x2="14" y2="21" />
              </svg>
              <span className="room-header-text">Room</span>
            </>
          )}
        </button>

        <div className="icon-button-group" role="group" aria-label="App controls">
          <div className="theme-picker" ref={themePickerRef}>
            <button
              className="btn-icon"
              ref={themeButtonRef}
              onClick={() => setShowThemeMenu((prev) => !prev)}
              title={`Theme: ${currentTheme?.name || 'Theme'} (${currentMode})`}
              aria-label="Change theme"
              aria-haspopup="menu"
              aria-expanded={showThemeMenu}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="13.5" cy="6.5" r="1.5" />
                <circle cx="17.5" cy="10.5" r="1.5" />
                <circle cx="8.5" cy="7.5" r="1.5" />
                <circle cx="6.5" cy="12.5" r="1.5" />
                <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
              </svg>
              {currentSwatch && (
                <span className="theme-swatch-dot" style={{ background: currentSwatch.primary }} aria-hidden="true" />
              )}
            </button>
          </div>

          <button
            className="btn-icon"
            onClick={() => setShowQrPopup((prev) => !prev)}
            title="Show QR code for this app"
            aria-label="Show QR code for this app"
            aria-pressed={showQrPopup}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <path d="M14 14h3v3h-3z" />
              <path d="M21 14v.01" />
              <path d="M17 21h.01" />
              <path d="M21 21h.01" />
              <path d="M14 17.5v.01" />
              <path d="M18.5 17.5v.01" />
            </svg>
          </button>

          <button
            className={`btn-icon ${notifyEnabled ? 'is-active-icon' : ''}`}
            onClick={handleNotifyToggle}
            title={notifyEnabled ? 'Notifications on - click to mute' : 'Get notified about files and messages'}
            aria-label={notifyEnabled ? 'Disable notifications' : 'Enable notifications'}
            aria-pressed={notifyEnabled}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
              <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
              {!notifyEnabled && <line x1="4" y1="4" x2="20" y2="20" />}
            </svg>
          </button>

          <button
            className="btn-icon"
            onClick={toggleDebugSidebar}
            title={showDebugSidebar ? 'Hide debug details' : 'Show debug details'}
            aria-label={showDebugSidebar ? 'Hide debug details' : 'Show debug details'}
            aria-pressed={showDebugSidebar}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
            </svg>
          </button>
        </div>

        <div
          className="user-badge"
          onClick={() => document.querySelector('.user-name-input')?.focus()}
          role="group"
          aria-label="Your display name and device ID"
        >
          <div className="user-badge-meta">
            <input
              className="user-name-input"
              value={displayName}
              onChange={onNameChange}
              maxLength={20}
              size={1}
              placeholder="Your name"
              aria-label="Your display name"
            />
            <span className="user-id-chip" title={deviceId || ''}>
              {deviceId ? deviceId.slice(0, 12) : '-'}
            </span>
          </div>
          <span className="user-badge-edit" aria-hidden="true">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
          </span>
        </div>
      </div>
    </header>
  );
}
