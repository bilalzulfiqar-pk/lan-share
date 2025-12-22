import { useState, useRef, useEffect } from 'react';
import './App.css';
import { useSignaling } from './hooks/useSignaling';
import { useWebRTC } from './hooks/useWebRTC';
import { DeviceList } from './components/DeviceList';
import { HistoryPanel } from './components/HistoryPanel';

function App() {
  const [displayName, setDisplayName] = useState(() => localStorage.getItem('lan-share-name') || 'Device ' + Math.floor(Math.random() * 1000));
  const { socket, peers, isConnected, myId } = useSignaling(displayName);
  const { history, sendFilesOffer, requestFile, cancelTransfer, error } = useWebRTC(socket, myId);

  // We store ID of selected device
  const [selectedDevice, setSelectedDevice] = useState(null);

  // Persistence
  useEffect(() => {
    localStorage.setItem('lan-share-name', displayName);
  }, [displayName]);

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
          <div className="server-indicator">
            <div className={`status-dot ${isConnected ? 'online' : 'offline'}`} />
            <span>{isConnected ? 'Server Online' : 'Server Offline'}</span>
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
        <div className="section-card">
          <div className="section-header">
            <h2 className="section-title">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--primary)' }}>
                <path d="M5 12.55a11 11 0 0 1 14.08 0"></path>
                <path d="M1.42 9a16 16 0 0 1 21.16 0"></path>
                <path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path>
                <line x1="12" y1="20" x2="12.01" y2="20"></line>
              </svg>
              Available Devices
            </h2>
          </div>

          <DeviceList
            devices={peers}
            onToogle={handleDeviceToggle}
            selectedDevice={selectedDevice}
          />

          {selectedDevice && (
            <div style={{ marginTop: 'auto', paddingTop: '1rem', borderTop: '1px solid var(--glass-border)' }}>
              <p style={{ marginBottom: '0.5rem', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                Send files to <strong>{getPeerName(selectedDevice)}</strong>
              </p>
              <input
                type="file"
                id="fileInput"
                multiple
                onChange={onFileSelected}
                style={{ display: 'none' }}
              />
              <label htmlFor="fileInput" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}>
                Send Selected Files
              </label>
            </div>
          )}
        </div>

        <div className="section-card">
          <div className="section-header">
            <h2 className="section-title">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--accent)' }}>
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
