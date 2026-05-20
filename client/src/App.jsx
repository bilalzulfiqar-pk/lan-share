import { useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import './App.css';
import { useSignaling } from './hooks/useSignaling';
import { useWebRTC } from './hooks/useWebRTC';
import { DeviceList } from './components/DeviceList';
import { HistoryPanel } from './components/HistoryPanel';

function App() {
  const [displayName, setDisplayName] = useState(() => localStorage.getItem('lan-share-name') || 'Device ' + Math.floor(Math.random() * 1000));
  const MotionDiv = motion.div;

  // Theme State
  const [theme, setTheme] = useState(() => localStorage.getItem('lan-share-theme') || 'light');

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
      title: "Server is starting up…",
      description: "This app uses a free-tier server, which may sleep when inactive. Startup usually takes up to a minute.",
      type: 'warning'
    };
  } else if (!isConnected && disconnectElapsed >= 60000) {
    serverStatusMessage = {
      title: "Connection Issue",
      description: "The server may be offline or unavailable. Please try again later.",
      type: 'error'
    };
  }

  // We store ID of selected device
  const [selectedDevice, setSelectedDevice] = useState(null);

  // Guide State
  const [showGuide, setShowGuide] = useState(true);
  const [showDebugSidebar, setShowDebugSidebar] = useState(false);

  // Persistence
  useEffect(() => {
    localStorage.setItem('lan-share-name', displayName);
  }, [displayName]);

  // Apply Theme
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('lan-share-theme', theme);
  }, [theme]);

  // Fade out guide text
  useEffect(() => {
    const timer = setTimeout(() => {
      setShowGuide(false);
    }, 4000);
    return () => clearTimeout(timer);
  }, []);

  const toggleTheme = () => {
    setTheme(prev => prev === 'light' ? 'dark' : 'light');
  };

  const handleNameChange = (e) => {
    setDisplayName(e.target.value);
  };

  const handleDeviceToggle = (id) => {
    setSelectedDevice(prev => prev === id ? null : id);
  };

  const toggleDebugSidebar = () => {
    setShowDebugSidebar(prev => !prev);
  };

  const onFileSelected = (e) => {
    const files = e.target.files;
    if (files && files.length > 0 && selectedDevice) {
      sendFilesOffer(selectedDevice, files); // selectedDevice is ID string now
      // Reset input?
      e.target.value = '';
    }
  };

  const getPeerName = (peerId) => {
    if (!peerId) return 'Unknown';
    if (peerId === myId) return 'Me';
    const peer = peers.find(p => p.id === peerId); // peers is Array
    return peer?.name || peerId.slice(0, 8) + '...';
  };

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo-section">
          <div className="logo-wrapper">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12.55a11 11 0 0 1 14.08 0"></path>
              <path d="M1.42 9a16 16 0 0 1 21.16 0"></path>
              <path d="M8.59 16.11a6 6 0 0 1 6.82 0"></path>
              <line x1="12" y1="20" x2="12" y2="20"></line>
            </svg>
          </div>
          <div className="title-group">
            <h1>LAN Share</h1>
            <span className="mini-heading">Fast • Local • Secure</span>
          </div>
        </div>

        <div className="status-section">
          {/* Theme Toggle */}
          <button
            className="btn-icon"
            onClick={toggleTheme}
            title={`Switch to ${theme === 'light' ? 'Dark' : 'Light'} Mode`}
            style={{ width: '40px', height: '40px', background: 'var(--bg-surface)', border: '1px solid var(--glass-border)' }}
          >
            {theme === 'light' ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" /></svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2" /><path d="M12 20v2" /><path d="m4.93 4.93 1.41 1.41" /><path d="m17.66 17.66 1.41 1.41" /><path d="M2 12h2" /><path d="M20 12h2" /><path d="m6.34 17.66-1.41 1.41" /><path d="m19.07 4.93-1.41 1.41" /></svg>
            )}
          </button>

          <button
            className="btn-icon"
            onClick={toggleDebugSidebar}
            title={showDebugSidebar ? 'Hide debug details' : 'Show debug details'}
            style={{ width: '40px', height: '40px', background: 'var(--bg-surface)', border: '1px solid var(--glass-border)' }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <path d="M12 16v-4"></path>
              <path d="M12 8h.01"></path>
            </svg>
          </button>

          <div className="server-indicator">
            <div className={`status-dot ${isConnected ? 'online' : 'offline'}`} />
            <span>{isConnected ? 'Online' : 'Offline'}</span>
          </div>

          <div className="user-badge" style={{ display: 'flex', alignItems: 'right', gap: '8px' }}>
            {/* Name Input with Edit Icon */}
            <div className="name-edit-wrapper" style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <input
                className="user-name-input"
                value={displayName}
                onChange={handleNameChange}
                maxLength={20}
                placeholder="Your Name"
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-primary)',
                  textAlign: 'right',
                  fontSize: '1rem',
                  fontWeight: '600',
                  outline: 'none',
                  borderBottom: '1px solid transparent',
                  transition: 'border-color 0.2s',
                  width: '140px'
                }}
                onFocus={(e) => e.target.style.borderBottom = '1px solid var(--primary)'}
                onBlur={(e) => e.target.style.borderBottom = '1px solid transparent'}
              />
              <button
                className="btn-icon"
                style={{
                  width: '24px',
                  height: '24px',
                  background: 'transparent',
                  color: 'var(--text-tertiary)',
                  cursor: 'text'
                }}
                onClick={() => document.querySelector('.user-name-input').focus()}
                title="Edit Name"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
              </button>
            </div>
            <span className="user-id">ID: {myId ? myId.slice(0, 12) : '...'}</span>
          </div>
        </div>
      </header>

      <AnimatePresence>
        {showDebugSidebar && (
          <>
            <MotionDiv
              className="debug-sidebar-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowDebugSidebar(false)}
            />
            <MotionDiv
              className="debug-sidebar"
              initial={{ opacity: 0, x: 320 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 320 }}
              transition={{ type: 'spring', stiffness: 260, damping: 28 }}
            >
              <div className="debug-sidebar-header">
                <div>
                  <h3>Debug Details</h3>
                  <p>Temporary diagnostics for discovery and WebRTC.</p>
                </div>
                <button
                  className="btn-icon"
                  onClick={() => setShowDebugSidebar(false)}
                  title="Close debug panel"
                  style={{ width: '36px', height: '36px', background: 'var(--bg-surface-hover)', border: '1px solid var(--glass-border)' }}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 6 6 18"></path>
                    <path d="m6 6 12 12"></path>
                  </svg>
                </button>
              </div>

              <div className="debug-sidebar-section">
                <h4>Network</h4>
                <div className="debug-grid">
                  <div className="debug-label">Server URL</div>
                  <div className="debug-value">{debugInfo.serverUrl || 'Unavailable'}</div>
                  <div className="debug-label">Server Public IP</div>
                  <div className="debug-value">{debugInfo.serverDebug.publicIp || 'Unavailable'}</div>
                  <div className="debug-label">Detected Fingerprints</div>
                  <div className="debug-value">{debugInfo.localNetworkFingerprints.length > 0 ? debugInfo.localNetworkFingerprints.join(', ') : 'None detected'}</div>
                  <div className="debug-label">Server Stored Fingerprints</div>
                  <div className="debug-value">{debugInfo.serverDebug.networkFingerprints.length > 0 ? debugInfo.serverDebug.networkFingerprints.join(', ') : 'None reported'}</div>
                </div>
              </div>

              <div className="debug-sidebar-section">
                <h4>Session</h4>
                <div className="debug-grid">
                  <div className="debug-label">Socket ID</div>
                  <div className="debug-value">{myId || 'Pending'}</div>
                  <div className="debug-label">Device ID</div>
                  <div className="debug-value">{debugInfo.deviceId || 'Unavailable'}</div>
                  <div className="debug-label">Transport</div>
                  <div className="debug-value">{debugInfo.transportName}</div>
                  <div className="debug-label">WebRTC</div>
                  <div className="debug-value">{connectionStatus} / {channelReady ? 'ready' : 'not-ready'}</div>
                  <div className="debug-label">Selected Device</div>
                  <div className="debug-value">{selectedDevice ? getPeerName(selectedDevice) : 'None selected'}</div>
                </div>
              </div>

              <div className="debug-sidebar-section">
                <h4>Visible Peers</h4>
                {debugInfo.serverDebug.visiblePeers.length === 0 ? (
                  <p className="debug-empty">No peers visible from the server perspective.</p>
                ) : (
                  <div className="debug-list">
                    {debugInfo.serverDebug.visiblePeers.map((peer) => (
                      <div key={peer.id} className="debug-list-item">
                        <strong>{peer.name || 'Unnamed Device'}</strong>
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
            </MotionDiv>
          </>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {/* Server Cold Start / Status Message */}
        {serverStatusMessage && !isConnected && (
          <MotionDiv
            className={`server-status-popup ${serverStatusMessage.type}`}
            initial={{ opacity: 0, y: -20, x: "-50%" }}
            animate={{ opacity: 1, y: 0, x: "-50%" }}
            exit={{ opacity: 0, y: -20, x: "-50%" }}
            transition={{ duration: 0.4, type: "spring", stiffness: 500, damping: 30 }}
          >
            <div className="server-status-icon">
              {serverStatusMessage.type === 'warning' ? (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'spin 3s linear infinite' }}>
                  <path d="M12 2v4"></path>
                  <path d="m16.2 7.8 2.9-2.9"></path>
                  <path d="M18 12h4"></path>
                  <path d="m16.2 16.2 2.9 2.9"></path>
                  <path d="M12 18v4"></path>
                  <path d="m4.9 19.1 2.9-2.9"></path>
                  <path d="M2 12h4"></path>
                  <path d="m4.9 4.9 2.9 2.9"></path>
                </svg>
              ) : (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="12" y1="8" x2="12" y2="12"></line>
                  <line x1="12" y1="16" x2="12.01" y2="16"></line>
                </svg>
              )}
            </div>
            <div className="server-status-content">
              <h3>{serverStatusMessage.title}</h3>
              <p>{serverStatusMessage.description}</p>
            </div>
          </MotionDiv>
        )}
      </AnimatePresence>

      {/* Global Error Banner */}
      {error && (
        <div style={{
          backgroundColor: 'var(--danger)',
          color: 'white',
          padding: '0.75rem',
          borderRadius: 'var(--radius-md)',
          margin: '0 auto 1rem auto',
          maxWidth: '800px',
          textAlign: 'center',
          boxShadow: 'var(--shadow-lg)'
        }}>
          ⚠️ {error}
        </div>
      )}

      <div className="main-layout">

        {/* Radar Section - Hero */}
        <div className="radar-section">


          {/* Overlay Guide Text */}
          <div className='guide-text' style={{
            position: 'absolute',
            top: '1%',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 10,
            textAlign: 'center',
            width: '100%',
            pointerEvents: 'none'
          }}>
            <h2 style={{
              fontSize: '1.5rem',
              fontWeight: '800',
              marginBottom: '0.25rem',
              opacity: showGuide ? 1 : 0,
              transition: 'opacity 1s ease',
              textShadow: '0 2px 10px var(--glass-border)'
            }}>
              Look for devices nearby
            </h2>
            <p style={{
              color: 'var(--text-secondary)',
              opacity: showGuide ? 1 : 0,
              transition: 'opacity 1s ease',
              margin: 0
            }}>
              Devices on your local network will pop up on the radar.
            </p>
          </div>

          <DeviceList
            devices={peers}
            onToogle={handleDeviceToggle}
            selectedDevice={selectedDevice}
          />


          <AnimatePresence>
            {selectedDevice && (
              <MotionDiv
                className="file-selection-popup"
                initial={{ opacity: 0, y: 10, x: "-50%" }}
                animate={{ opacity: 1, y: 0, x: "-50%" }}
                exit={{ opacity: 0, y: 10, x: "-50%" }}
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
              >
                <p style={{ margin: 0, fontSize: '0.95rem', color: 'var(--text-secondary)' }}>
                  Send files to <strong style={{ color: 'var(--text-primary)' }}>{getPeerName(selectedDevice)}</strong>
                </p>
                <input
                  type="file"
                  id="fileInput"
                  multiple
                  onChange={onFileSelected}
                  style={{ display: 'none' }}
                />
                <label htmlFor="fileInput" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
                  Select Files (Max 150MB)
                </label>
                <button
                  onClick={() => setSelectedDevice(null)}
                  className='hover-btn'
                  style={{ background: 'transparent', border: 'none', fontSize: '0.8rem', cursor: 'pointer' }}
                >
                  Cancel Selection
                </button>
              </MotionDiv>
            )}
          </AnimatePresence>
        </div>

        {/* History Section - Below */}
        <div className="history-section">
          <div className="section-header">
            <h2 className="section-title">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--accent)' }}>
                <circle cx="12" cy="12" r="10"></circle>
                <polyline points="12 6 12 12 16 14"></polyline>
              </svg>
              Transfer History
            </h2>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-tertiary)' }}>
              {history.length} items
            </div>
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
