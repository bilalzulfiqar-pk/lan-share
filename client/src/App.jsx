import { useState, useEffect, useRef } from 'react';
// eslint-disable-next-line no-unused-vars
import { AnimatePresence, motion } from 'framer-motion';
import './App.css';
import { useSignaling } from './hooks/useSignaling';
import { useWebRTC } from './hooks/useWebRTC';
import { DeviceList } from './components/DeviceList';
import { HistoryPanel } from './components/HistoryPanel';

const THEMES = [
  {
    id: 'ocean',
    name: 'Ocean',
    light: { primary: '#2454d6', accent: '#3b82f6' },
    dark:  { primary: '#60a5fa', accent: '#3b82f6' },
  },
  {
    id: 'forest',
    name: 'Forest',
    light: { primary: '#059669', accent: '#10b981' },
    dark:  { primary: '#34d399', accent: '#10b981' },
  },
  {
    id: 'rose',
    name: 'Rose',
    light: { primary: '#e11d48', accent: '#f43f5e' },
    dark:  { primary: '#fb7185', accent: '#f43f5e' },
  },
  {
    id: 'neon',
    name: 'Neon',
    light: { primary: '#c026d3', accent: '#e879f9' },
    dark:  { primary: '#e879f9', accent: '#e879f9' },
  },
];

const DEFAULT_THEME = 'ocean-light';
const STORAGE_KEY = 'lan-share-theme';

function App() {
  const [displayName, setDisplayName] = useState(
    () => localStorage.getItem('lan-share-name') || 'Device ' + Math.floor(Math.random() * 1000)
  );

  const [theme, setTheme] = useState(
    () => {
      const saved = localStorage.getItem(STORAGE_KEY);
      // Migrate old 'light' / 'dark' values
      if (saved === 'light' || saved === 'dark') return DEFAULT_THEME;
      return saved || DEFAULT_THEME;
    }
  );
  const [showThemeMenu, setShowThemeMenu] = useState(false);

  const { socket, peers, isConnected, isReconnecting, connectionStartTime, myId, debugInfo } = useSignaling(displayName);
  const { history, connectionStatus, channelReady, sendFilesOffer, requestFile, saveReceivedFile, cancelTransfer, error } = useWebRTC(socket, myId);

  const [disconnectElapsed, setDisconnectElapsed] = useState(0);

  useEffect(() => {
    let timer;
    if (!isConnected && connectionStartTime > 0) {
      const updateElapsed = () => {
        setDisconnectElapsed(Date.now() - connectionStartTime);
      };

      updateElapsed();
      timer = setInterval(() => {
        updateElapsed();
      }, 1000);
    }

    return () => clearInterval(timer);
  }, [isConnected, connectionStartTime, isReconnecting]);

  let serverStatusMessage = null;
  if (!isConnected && disconnectElapsed > 3000 && disconnectElapsed < 60000) {
    serverStatusMessage = {
      title: 'Server is starting up…',
      description: 'This app uses a free-tier server, which may sleep when inactive. Startup usually takes up to a minute.',
      type: 'warning',
    };
  } else if (!isConnected && disconnectElapsed >= 60000) {
    serverStatusMessage = {
      title: 'Connection issue',
      description: 'The server may be offline or unavailable. Please try again later.',
      type: 'error',
    };
  }

  const [selectedDevice, setSelectedDevice] = useState(null);
  const [showGuide, setShowGuide] = useState(true);
  const [showDebugSidebar, setShowDebugSidebar] = useState(false);
  const [copied, setCopied] = useState(false);

  const themePickerRef = useRef(null);

  useEffect(() => {
    localStorage.setItem('lan-share-name', displayName);
  }, [displayName]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    if (!showThemeMenu) return;
    const onDown = (e) => {
      if (themePickerRef.current && !themePickerRef.current.contains(e.target)) {
        setShowThemeMenu(false);
      }
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setShowThemeMenu(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [showThemeMenu]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setShowGuide(false);
    }, 4000);
    return () => clearTimeout(timer);
  }, []);

  const currentTheme = THEMES.find((t) => t.id === theme.split('-')[0]) || THEMES[0];
  const currentMode = theme.endsWith('-dark') ? 'dark' : 'light';
  const currentSwatch = currentTheme[currentMode];

  const handleThemeChange = (themeId, mode) => {
    setTheme(`${themeId}-${mode}`);
  };

  const handleNameChange = (e) => {
    setDisplayName(e.target.value);
  };

  const handleDeviceToggle = (id) => {
    setSelectedDevice((prev) => (prev === id ? null : id));
  };

  const toggleDebugSidebar = () => {
    setShowDebugSidebar((prev) => !prev);
  };

  const onFileSelected = (e) => {
    const files = e.target.files;
    if (files && files.length > 0 && selectedDevice) {
      sendFilesOffer(selectedDevice, files);
      e.target.value = '';
    }
  };

  const handleCopyId = async () => {
    if (!debugInfo.deviceId) return;
    try {
      await navigator.clipboard.writeText(debugInfo.deviceId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard unavailable */
    }
  };

  const getPeerName = (peerId) => {
    if (!peerId) return 'Unknown';
    if (peerId === myId) return 'Me';
    const peer = peers.find((p) => p.id === peerId);
    return peer?.name || peerId.slice(0, 8) + '…';
  };

  return (
    <div className="app-container">
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

        <div className="status-section">
          <div className="icon-button-group" role="group" aria-label="App controls">
            <div className="theme-picker" ref={themePickerRef}>
              <button
                className="btn-icon"
                onClick={() => setShowThemeMenu((prev) => !prev)}
                title={`Theme: ${currentTheme.name} (${currentMode})`}
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
                <span className="theme-swatch-dot" style={{ background: currentSwatch.primary }} aria-hidden="true" />
              </button>

              <AnimatePresence>
                {showThemeMenu && (
                  <motion.div
                    className="theme-menu"
                    role="menu"
                    initial={{ opacity: 0, scale: 0.95, y: -6 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: -6 }}
                    transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                  >
                    <div className="theme-menu-header">
                      <span>Theme</span>
                      <span className="theme-menu-count">{THEMES.length}</span>
                    </div>
                    <div className="theme-menu-list">
                      {THEMES.map((t) => {
                        const tLight = t.light;
                        const tDark = t.dark;
                        const isCurrent = t.id === currentTheme.id;
                        return (
                          <div key={t.id} className="theme-menu-item" role="group" aria-label={`${t.name} theme`}>
                            <div
                              className="theme-menu-swatch"
                              style={{ background: currentMode === 'light' ? tLight.primary : tDark.primary }}
                              aria-hidden="true"
                            />
                            <div className="theme-menu-info">
                              <span className="theme-menu-name">{t.name}</span>
                              <span className="theme-menu-tokens">
                                {(currentMode === 'light' ? tLight : tDark).primary}
                              </span>
                            </div>
                            <div className="theme-menu-modes" role="group" aria-label="Mode">
                              <button
                                type="button"
                                className={`theme-menu-mode ${isCurrent && currentMode === 'light' ? 'is-active' : ''}`}
                                onClick={() => handleThemeChange(t.id, 'light')}
                                aria-pressed={isCurrent && currentMode === 'light'}
                                aria-label={`${t.name} light`}
                              >
                                Light
                              </button>
                              <button
                                type="button"
                                className={`theme-menu-mode ${isCurrent && currentMode === 'dark' ? 'is-active' : ''}`}
                                onClick={() => handleThemeChange(t.id, 'dark')}
                                aria-pressed={isCurrent && currentMode === 'dark'}
                                aria-label={`${t.name} dark`}
                              >
                                Dark
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

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

          <div className="server-indicator" title={isConnected ? 'Server reachable' : 'Server unreachable'}>
            <div className={`status-dot ${isConnected ? 'online' : 'offline'}`} />
            <span>{isConnected ? 'Online' : 'Offline'}</span>
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
                onChange={handleNameChange}
                maxLength={20}
                size={1}
                placeholder="Your name"
                aria-label="Your display name"
              />
              <span className="user-id-chip" title={debugInfo.deviceId || ''}>
                {debugInfo.deviceId ? debugInfo.deviceId.slice(0, 12) : '—'}
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

      <AnimatePresence>
        {showDebugSidebar && (
          <>
            <motion.div
              className="debug-sidebar-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowDebugSidebar(false)}
            />
            <motion.aside
              className="debug-sidebar"
              initial={{ opacity: 0, x: 360 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 360 }}
              transition={{ type: 'spring', stiffness: 280, damping: 30 }}
              role="dialog"
              aria-label="Debug details"
            >
              <div className="debug-sidebar-header">
                <div className="debug-sidebar-header-meta">
                  <h3>Debug details</h3>
                  <p>Temporary diagnostics for discovery and WebRTC.</p>
                </div>
                <button
                  className="btn-icon"
                  onClick={() => setShowDebugSidebar(false)}
                  title="Close debug panel"
                  aria-label="Close debug panel"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M18 6 6 18" />
                    <path d="m6 6 12 12" />
                  </svg>
                </button>
              </div>

              <div className="debug-sidebar-section">
                <h4>Network</h4>
                <div className="debug-grid">
                  <div className="debug-label">Server URL</div>
                  <div className="debug-value">{debugInfo.serverUrl || 'Unavailable'}</div>
                  <div className="debug-label">Server public IP</div>
                  <div className="debug-value">{debugInfo.serverDebug.publicIp || 'Unavailable'}</div>
                  <div className="debug-label">Detected fingerprints</div>
                  <div className="debug-value">
                    {debugInfo.localNetworkFingerprints.length > 0
                      ? debugInfo.localNetworkFingerprints.join(', ')
                      : 'None detected'}
                  </div>
                  <div className="debug-label">Server fingerprints</div>
                  <div className="debug-value">
                    {debugInfo.serverDebug.networkFingerprints.length > 0
                      ? debugInfo.serverDebug.networkFingerprints.join(', ')
                      : 'None reported'}
                  </div>
                </div>
              </div>

              <div className="debug-sidebar-section">
                <h4>Session</h4>
                <div className="debug-grid">
                  <div className="debug-label">Socket ID</div>
                  <div className="debug-value">{myId || 'Pending'}</div>
                  <div className="debug-label">Device ID</div>
                  <div className="debug-value">
                    <div className="debug-value-row">
                      <span>{debugInfo.deviceId || 'Unavailable'}</span>
                      {debugInfo.deviceId && (
                        <button className="debug-copy" onClick={handleCopyId}>
                          {copied ? 'Copied' : 'Copy'}
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="debug-label">Transport</div>
                  <div className="debug-value">{debugInfo.transportName}</div>
                  <div className="debug-label">WebRTC</div>
                  <div className="debug-value">
                    {connectionStatus} / {channelReady ? 'ready' : 'not ready'}
                  </div>
                  <div className="debug-label">Selected</div>
                  <div className="debug-value">
                    {selectedDevice ? getPeerName(selectedDevice) : 'None selected'}
                  </div>
                </div>
              </div>

              <div className="debug-sidebar-section">
                <h4>Visible peers</h4>
                {debugInfo.serverDebug.visiblePeers.length === 0 ? (
                  <p className="debug-empty">No peers visible from the server perspective.</p>
                ) : (
                  <div className="debug-list">
                    {debugInfo.serverDebug.visiblePeers.map((peer) => (
                      <div key={peer.id} className="debug-list-item">
                        <strong>{peer.name || 'Unnamed device'}</strong>
                        <span>{peer.id}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="debug-sidebar-section">
                <h4>Browser</h4>
                <p className="debug-user-agent">{debugInfo.userAgent}</p>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {serverStatusMessage && !isConnected && (
          <motion.div
            className={`server-status-popup ${serverStatusMessage.type}`}
            initial={{ opacity: 0, y: -10, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: -10, x: '-50%' }}
            transition={{ duration: 0.3, type: 'spring', stiffness: 400, damping: 32 }}
            role="status"
            aria-live="polite"
          >
            <div className="server-status-icon">
              {serverStatusMessage.type === 'warning' ? (
                <div className="server-status-spinner" aria-hidden="true" />
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              )}
            </div>
            <div className="server-status-content">
              <h3>{serverStatusMessage.title}</h3>
              <p>{serverStatusMessage.description}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {error && (
        <div className="global-error-banner" role="alert">
          {error}
        </div>
      )}

      <div className="main-layout">
        <div className="radar-section">
          <div className={`guide-text ${showGuide ? 'is-visible' : ''}`}>
            <h2>Look for devices nearby</h2>
            <p>Devices on your local network will pop up on the radar.</p>
          </div>

          <DeviceList
            devices={peers}
            onToogle={handleDeviceToggle}
            selectedDevice={selectedDevice}
          />

          <AnimatePresence>
            {selectedDevice && (
              <motion.div
                className="file-selection-popup"
                initial={{ opacity: 0, y: 10, x: '-50%' }}
                animate={{ opacity: 1, y: 0, x: '-50%' }}
                exit={{ opacity: 0, y: 10, x: '-50%' }}
                transition={{ type: 'spring', stiffness: 320, damping: 30 }}
              >
                <div className="file-selection-popup-label">
                  <span>Send to</span>
                  <strong>{getPeerName(selectedDevice)}</strong>
                </div>
                <input
                  type="file"
                  id="fileInput"
                  multiple
                  onChange={onFileSelected}
                  className="visually-hidden-input"
                  aria-label="Select files to send"
                />
                <label htmlFor="fileInput" className="btn btn-primary">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                  Select files
                </label>
                <span className="file-selection-hint">Up to 150 MB per file</span>
                <button
                  onClick={() => setSelectedDevice(null)}
                  className="cancel-selection-link"
                >
                  Cancel selection
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="history-section">
          <div className="section-header">
            <h2 className="section-title">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              Transfer history
            </h2>
            <span className="section-count">{history.length} {history.length === 1 ? 'item' : 'items'}</span>
          </div>
          <HistoryPanel
            history={history}
            onRequest={requestFile}
            onSave={saveReceivedFile}
            onCancel={cancelTransfer}
            getPeerName={getPeerName}
          />
        </div>
      </div>
    </div>
  );
}

export default App;
