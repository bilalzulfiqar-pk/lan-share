import { useState, useRef, useEffect } from 'react';
import './App.css';
import { useSignaling } from './hooks/useSignaling';
import { useWebRTC } from './hooks/useWebRTC';
import { DeviceList } from './components/DeviceList';
import { HistoryPanel } from './components/HistoryPanel';

function App() {
  const [displayName, setDisplayName] = useState(() => localStorage.getItem('lan-share-name') || 'Device ' + Math.floor(Math.random() * 1000));

  // Theme State
  const [theme, setTheme] = useState(() => localStorage.getItem('lan-share-theme') || 'light');

  const { socket, peers, isConnected, myId } = useSignaling(displayName);
  const { history, sendFilesOffer, requestFile, cancelTransfer, error } = useWebRTC(socket, myId);

  // We store ID of selected device
  const [selectedDevice, setSelectedDevice] = useState(null);

  // Guide State
  const [showGuide, setShowGuide] = useState(true);

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
    const peer = peers.find(p => p.id === peerId); // Fix: peers is Array
    return peer?.name || peerId.slice(0, 8) + '...';
  };

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo-section">
          <h1>LAN Share</h1>
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

          <div className="server-indicator">
            <div className={`status-dot ${isConnected ? 'online' : 'offline'}`} />
            <span>{isConnected ? 'Online' : 'Offline'}</span>
          </div>

          <div className="user-badge" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
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

      <div className="main-layout">

        {/* Radar Section - Hero */}
        <div className="radar-section">

          {/* Overlay Guide Text */}
          <div style={{
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


          {selectedDevice && (
            <div style={{
              position: 'absolute',
              bottom: '2rem',
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 20,
              background: 'var(--bg-surface)',
              padding: '1rem 2rem',
              borderRadius: 'var(--radius-xl)',
              boxShadow: 'var(--shadow-lg)',
              border: '1px solid var(--primary)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '0.5rem',
              minWidth: '300px'
            }}>
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
                Select Files to Send
              </label>
              <button
                onClick={() => setSelectedDevice(null)}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-tertiary)', fontSize: '0.8rem', cursor: 'pointer', textDecoration: 'underline' }}
              >
                Cancel Selection
              </button>
            </div>
          )}
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
            onCancel={cancelTransfer}
            getPeerName={getPeerName}
          />
        </div>
      </div>
    </div>
  );
}

export default App;
