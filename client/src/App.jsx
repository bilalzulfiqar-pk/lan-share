import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
// eslint-disable-next-line no-unused-vars
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import './App.css';
import { useSignaling } from './hooks/useSignaling';
import { useWebRTC } from './hooks/useWebRTC';
import { DeviceList } from './components/DeviceList';
import { HistoryPanel } from './components/HistoryPanel';
import { ChatPanel } from './components/ChatPanel';
import { QrPopup } from './components/QrPopup';
import { copyText } from './lib/clipboard';
import { playNotificationBlip } from './lib/sound';
import {
  requestNotificationPermission,
  showNotification,
  areNotificationsSupported,
  getNotificationPermission,
} from './lib/notifications';

const THEMES = [
  {
    id: 'ocean',
    name: 'Ocean',
    light: { primary: '#2454d6', accent: '#3b82f6', strong: '#2454d6' },
    dark:  { primary: '#60a5fa', accent: '#3b82f6', strong: '#1d47b8' },
  },
  {
    id: 'forest',
    name: 'Forest',
    light: { primary: '#059669', accent: '#10b981', strong: '#059669' },
    dark:  { primary: '#34d399', accent: '#10b981', strong: '#047a56' },
  },
  {
    id: 'rose',
    name: 'Rose',
    light: { primary: '#e11d48', accent: '#f43f5e', strong: '#e11d48' },
    dark:  { primary: '#fb7185', accent: '#f43f5e', strong: '#be123c' },
  },
  {
    id: 'neon',
    name: 'Neon',
    light: { primary: '#c026d3', accent: '#e879f9', strong: '#c026d3' },
    dark:  { primary: '#e879f9', accent: '#e879f9', strong: '#a21caf' },
  },
];

const DEFAULT_THEME = 'ocean-light';
const STORAGE_KEY = 'lan-share-theme';
const CHAT_STORAGE_KEY = 'lan-share-chat';
const CHAT_HISTORY_LIMIT = 200;
const NOTIFY_STORAGE_KEY = 'lan-share-notify-enabled';

function updateFavicon(themeKey) {
  const [themeId, mode] = themeKey.split('-');
  const theme = THEMES.find((t) => t.id === themeId);
  if (!theme) return;
  // Per-mode "strong" brand color (--primary-strong): deep in light, a deeper
  // shade in dark, so the favicon matches the header tile/buttons in each mode.
  const color = theme[mode]?.strong || theme.light.primary;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.59 16.11a6 6 0 0 1 6.82 0"/></svg>`;
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  let link = document.querySelector("link[rel='icon']");
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    link.type = 'image/svg+xml';
    document.head.appendChild(link);
  }
  if (link.href && link.href.startsWith('blob:')) {
    URL.revokeObjectURL(link.href);
  }
  link.href = url;
}

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

  const getPeerName = useCallback((peerId) => {
    if (!peerId) return 'Unknown';
    if (peerId === myId) return 'Me';
    const peer = peers.find((p) => p.id === peerId);
    return peer?.name || peerId.slice(0, 8) + '…';
  }, [peers, myId]);

  const [notifyEnabled, setNotifyEnabled] = useState(() => localStorage.getItem(NOTIFY_STORAGE_KEY) === 'true');

  useEffect(() => {
    localStorage.setItem(NOTIFY_STORAGE_KEY, notifyEnabled ? 'true' : 'false');
  }, [notifyEnabled]);

  const announceEvent = useCallback((title, body) => {
    if (!notifyEnabled) return;

    playNotificationBlip();
    if (document.hidden) {
      showNotification(title, { body, tag: 'lan-share' });
    }
  }, [notifyEnabled]);

  const handleNotifyToggle = useCallback(async () => {
    if (!notifyEnabled) {
      if (!areNotificationsSupported()) {
        // Sound-only mode for browsers with no Notification API.
        setNotifyEnabled(true);
        return;
      }

      let permission = getNotificationPermission();
      if (permission === 'default') {
        permission = await requestNotificationPermission();
      }

      // Only flip the bell on when notifications can actually be delivered.
      // Dismissing the prompt leaves permission 'default' — the bell stays
      // off and will ask again next time; a blocked browser stays off too.
      setNotifyEnabled(permission === 'granted');
      return;
    }
    setNotifyEnabled(false);
  }, [notifyEnabled]);

  // { peerId, key } — the history key is pinned when the chat opens so the
  // panel keeps its history even if the peer list momentarily empties during
  // a signaling reconnect.
  const [chatSession, setChatSession] = useState({ peerId: null, key: null });
  const [chatByDevice, setChatByDevice] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(CHAT_STORAGE_KEY)) || {};
    } catch {
      return {};
    }
  });
  const [unreadByDevice, setUnreadByDevice] = useState({});

  const deviceKeyForPeer = useCallback((peerId) => {
    const peer = peers.find((p) => p.id === peerId);
    return peer?.deviceId || peerId;
  }, [peers]);

  const appendChatMessage = useCallback((key, message) => {
    setChatByDevice((prev) => ({
      ...prev,
      [key]: [...(prev[key] || []), message].slice(-CHAT_HISTORY_LIMIT)
    }));
  }, []);

  const handleIncomingChat = useCallback((peerId, message) => {
    const key = deviceKeyForPeer(peerId);
    appendChatMessage(key, {
      id: message.id,
      text: message.text,
      ts: message.ts,
      direction: 'in'
    });

    if (chatSession.peerId !== peerId) {
      setUnreadByDevice((prev) => ({ ...prev, [key]: (prev[key] || 0) + 1 }));
      announceEvent(`Message from ${getPeerName(peerId)}`, message.text.length > 80 ? `${message.text.slice(0, 80)}…` : message.text);
    } else {
      // Refresh the pinned key in case the peer reconnected with a new
      // socket id but the same device.
      setChatSession((current) => (current.peerId === peerId ? { ...current, key } : current));
    }
  }, [announceEvent, appendChatMessage, chatSession.peerId, deviceKeyForPeer, getPeerName]);

  const { history, peerStatus, error, sendFilesOffer, requestFile, saveReceivedFile, cancelTransfer, sendChat } =
    useWebRTC(socket, myId, {
      getPeerName,
      onChat: handleIncomingChat,
      onNotify: (event) => announceEvent(event.title, event.body)
    });

  const openChatWithPeer = useCallback((peerId) => {
    setChatSession({ peerId, key: deviceKeyForPeer(peerId) });
    setUnreadByDevice((prev) => ({ ...prev, [deviceKeyForPeer(peerId)]: 0 }));
  }, [deviceKeyForPeer]);

  const closeChat = useCallback(() => {
    setChatSession({ peerId: null, key: null });
  }, []);

  const handleSendChat = useCallback((text) => {
    if (!chatSession.peerId || !chatSession.key) return;

    appendChatMessage(chatSession.key, {
      id: (crypto.randomUUID ? crypto.randomUUID() : `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
      text,
      ts: Date.now(),
      direction: 'out'
    });
    sendChat(chatSession.peerId, text);
  }, [appendChatMessage, chatSession, sendChat]);

  useEffect(() => {
    try {
      localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(chatByDevice));
    } catch {
      // storage full or unavailable — chat history stays in memory
    }
  }, [chatByDevice]);

  const unreadBySocketId = useMemo(() => {
    const map = {};
    peers.forEach((peer) => {
      const count = unreadByDevice[peer.deviceId];
      if (count > 0) {
        map[peer.id] = count;
      }
    });
    return map;
  }, [peers, unreadByDevice]);

  const chatMessages = chatSession.key ? (chatByDevice[chatSession.key] || []) : [];
  const chatStatusLabel = peerStatus[chatSession.peerId] === 'CONNECTED'
    ? 'Connected · peer-to-peer'
    : peerStatus[chatSession.peerId] === 'CONNECTING'
      ? 'Connecting…'
      : 'Not connected';

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
  const [dismissedStatusEpisode, setDismissedStatusEpisode] = useState(0);
  const [dismissedError, setDismissedError] = useState(null);
  const [showQrPopup, setShowQrPopup] = useState(false);
  const [isWindowDragActive, setIsWindowDragActive] = useState(false);
  const reduceMotion = useReducedMotion();

  const themePickerRef = useRef(null);
  const themeButtonRef = useRef(null);
  const [menuStyle, setMenuStyle] = useState({ top: 0, right: 0 });

  useEffect(() => {
    localStorage.setItem('lan-share-name', displayName);
  }, [displayName]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(STORAGE_KEY, theme);
    updateFavicon(theme);

    const bgColor = getComputedStyle(document.documentElement).getPropertyValue('--bg-app').trim();
    if (bgColor) {
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bgColor);
    }
  }, [theme]);

  useEffect(() => {
    if (!showThemeMenu) return;
    const updatePos = () => {
      if (!themeButtonRef.current) return;
      const rect = themeButtonRef.current.getBoundingClientRect();
      const menuMaxWidth = 320;
      const menuMaxHeight = Math.min(window.innerHeight * 0.7, 420);
      const gap = 8;
      const spaceRight = window.innerWidth - rect.right;
      const spaceBelow = window.innerHeight - rect.bottom;
      const fitsLeftward = rect.right >= menuMaxWidth + gap;
      const openUp = spaceBelow < menuMaxHeight + gap && rect.top > spaceBelow;
      const style = { top: openUp ? rect.top - gap : rect.bottom + gap };
      if (fitsLeftward) {
        style.right = spaceRight;
        style.transformOrigin = openUp ? 'bottom right' : 'top right';
      } else {
        style.left = rect.left;
        style.transformOrigin = openUp ? 'bottom left' : 'top left';
      }
      setMenuStyle(style);
    };
    updatePos();
    const onDown = (e) => {
      if (themePickerRef.current && !themePickerRef.current.contains(e.target)) {
        setShowThemeMenu(false);
      }
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setShowThemeMenu(false);
    };
    const onScroll = () => setShowThemeMenu(false);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', updatePos);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', updatePos);
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

  // Page-level drag & drop: dropping files anywhere sends them to the
  // selected device (or the only visible peer).
  const dragDropTarget = selectedDevice || (peers.length === 1 ? peers[0].id : null);

  useEffect(() => {
    let dragDepth = 0;

    const hasFiles = (event) => Array.from(event.dataTransfer?.types || []).includes('Files');

    const onDragEnter = (event) => {
      if (!hasFiles(event)) return;
      dragDepth += 1;
      setIsWindowDragActive(true);
    };

    const onDragOver = (event) => {
      if (hasFiles(event)) {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      }
    };

    const onDragLeave = (event) => {
      if (!hasFiles(event)) return;
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) {
        setIsWindowDragActive(false);
      }
    };

    const onDrop = (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dragDepth = 0;
      setIsWindowDragActive(false);

      const files = Array.from(event.dataTransfer?.files || []);
      if (files.length > 0 && dragDropTarget) {
        sendFilesOffer(dragDropTarget, files);
      }
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [dragDropTarget, sendFilesOffer]);

  const handleCopyId = async () => {
    if (!debugInfo.deviceId) return;
    const succeeded = await copyText(debugInfo.deviceId);
    if (succeeded) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    }
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

        <div className="server-indicator" title={isConnected ? 'Server reachable' : 'Server unreachable'}>
          <div className={`status-dot ${isConnected ? 'online' : 'offline'}`} />
          <span>{isConnected ? 'Online' : 'Offline'}</span>
        </div>

        <div className="status-section">
          <div className="icon-button-group" role="group" aria-label="App controls">
            <div className="theme-picker" ref={themePickerRef}>
              <button
                className="btn-icon"
                ref={themeButtonRef}
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
                onChange={handleNameChange}
                maxLength={20}
                size={1}
                placeholder="Your name"
                aria-label="Your display name"
              />
              <span className="user-id-chip" title={debugInfo.deviceId || ''}>
                {debugInfo.deviceId ? debugInfo.deviceId.slice(0, 12) : '-'}
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
        {showThemeMenu && (
          <motion.div
            className="theme-menu"
            style={menuStyle}
            role="menu"
            initial={{ opacity: 0, scale: 0.95, y: -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -6 }}
            transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 32 }}
          >
            <div className="theme-menu-header">
              <span>Theme</span>
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
              transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 280, damping: 30 }}
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
                    {selectedDevice
                      ? `${peerStatus[selectedDevice] || 'IDLE'} · ${getPeerName(selectedDevice)}`
                      : `${Object.values(peerStatus).filter((s) => s !== 'DISCONNECTED').length} active session(s)`}
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
        {serverStatusMessage && !isConnected && dismissedStatusEpisode !== connectionStartTime && (
          <motion.div
            className={`server-status-popup ${serverStatusMessage.type}`}
            initial={{ opacity: 0, y: -10, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: -10, x: '-50%' }}
            transition={reduceMotion ? { duration: 0 } : { duration: 0.3, type: 'spring', stiffness: 400, damping: 32 }}
            role="status"
            aria-live="polite"
          >
            <div className="server-status-icon">
              {serverStatusMessage.type === 'warning' ? (
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
              ) : (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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
            <button
              className="server-status-dismiss"
              onClick={() => setDismissedStatusEpisode(connectionStartTime)}
              title="Dismiss"
              aria-label="Dismiss server status message"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <QrPopup
        open={showQrPopup}
        url={typeof window !== 'undefined' ? window.location.href : ''}
        onClose={() => setShowQrPopup(false)}
        reduceMotion={reduceMotion}
      />

      {isWindowDragActive && (
        <div className="drop-overlay" role="status" aria-live="polite">
          <div className="drop-overlay-card">
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <h3>{dragDropTarget ? `Drop to send to ${getPeerName(dragDropTarget)}` : 'Pick a device first'}</h3>
            <p>
              {dragDropTarget
                ? 'Files stream directly between devices.'
                : 'Click a device on the radar, then drop the files.'}
            </p>
          </div>
        </div>
      )}

      <ChatPanel
        open={Boolean(chatSession.peerId)}
        peerName={chatSession.peerId ? getPeerName(chatSession.peerId) : ''}
        connectionLabel={chatStatusLabel}
        messages={chatMessages}
        onSend={handleSendChat}
        onClose={closeChat}
        reduceMotion={reduceMotion}
      />

      {error && error !== dismissedError && (
        <div className="global-error-banner" role="alert">
          {error}
          <button
            className="error-banner-dismiss"
            onClick={() => setDismissedError(error)}
            title="Dismiss"
            aria-label="Dismiss error message"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
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
            unreadCounts={unreadBySocketId}
            onDropFiles={(peerId, files) => sendFilesOffer(peerId, files)}
          />

          <AnimatePresence>
            {selectedDevice && (
              <motion.div
                className="file-selection-popup"
                initial={{ opacity: 0, y: 10, x: '-50%' }}
                animate={{ opacity: 1, y: 0, x: '-50%' }}
                exit={{ opacity: 0, y: 10, x: '-50%' }}
                transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 320, damping: 30 }}
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
                <div className="file-selection-actions">
                  <label htmlFor="fileInput" className="btn btn-primary no-glow">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="17 8 12 3 7 8" />
                      <line x1="12" y1="3" x2="12" y2="15" />
                    </svg>
                    Select files
                  </label>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => openChatWithPeer(selectedDevice)}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    </svg>
                    Chat
                  </button>
                </div>
              {/* <span className="file-selection-hint">Any size · streamed directly between devices</span> */}
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
            onSave={(fileId) => {
              const item = history.find((entry) => entry.id === fileId);
              saveReceivedFile(fileId, item?.fileName);
            }}
            onCancel={cancelTransfer}
            getPeerName={getPeerName}
          />
        </div>
      </div>
    </div>
  );
}

export default App;
