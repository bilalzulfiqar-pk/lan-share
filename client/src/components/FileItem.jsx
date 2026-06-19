import React from 'react';

const CancelIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </svg>
);

const DownloadIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

const SaveIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
    <polyline points="17 21 17 13 7 13 7 21" />
    <polyline points="7 3 7 8 15 8" />
  </svg>
);

export function FileItem({ item, onRequest, onSave, onCancel, getPeerName }) {
  const isSender = item.direction === 'out';
  const peerName = getPeerName ? getPeerName(item.peerId) : 'Unknown';

  const statusKey = (() => {
    switch (item.status) {
      case 'completed': return isSender ? 'sent' : (item.saved ? 'saved' : 'ready');
      case 'error':
      case 'failed': return 'failed';
      case 'cancelled':
      case 'deleted': return 'cancelled';
      case 'waiting': return 'waiting';
      case 'uploading': return 'sending';
      case 'downloading': return 'receiving';
      case 'idle': return isSender ? 'waiting-accept' : 'available';
      default: return 'idle';
    }
  })();

  const STATUS_COPY = {
    'waiting-accept': 'Waiting for accept',
    available: 'Available',
    waiting: 'Requesting…',
    sending: 'Sending…',
    receiving: 'Receiving…',
    sent: 'Sent',
    ready: 'Ready to save',
    saved: 'Saved',
    failed: item.error || 'Transfer failed',
    cancelled: 'Cancelled',
    idle: 'Idle',
  };

  const formatSize = (bytes) => {
    if (!bytes && bytes !== 0) return '';
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  };

  const getIcon = (type) => {
    if (typeof type !== 'string') return <DefaultFileIcon />;
    if (type.startsWith('image/')) return <ImageIcon />;
    if (type.startsWith('video/')) return <VideoIcon />;
    if (type.startsWith('audio/')) return <AudioIcon />;
    return <DefaultFileIcon />;
  };

  const statusClass = (() => {
    switch (item.status) {
      case 'completed': return 'completed';
      case 'error':
      case 'failed': return 'error';
      case 'cancelled':
      case 'deleted': return 'cancelled';
      case 'waiting': return 'waiting';
      case 'uploading':
      case 'downloading': return 'uploading';
      case 'idle': return 'waiting';
      default: return 'waiting';
    }
  })();

  const isActive = item.status === 'uploading' || item.status === 'downloading';

  return (
    <div className={`file-item ${isActive ? 'is-active' : ''}`}>
      <div className="file-icon" aria-hidden="true">
        {getIcon(item.fileType)}
      </div>

      <div className="file-details">
        <span className="file-name" title={item.fileName}>{item.fileName}</span>
        <div className="file-meta">
          <span className="file-size">{formatSize(item.fileSize)}</span>
          <span className="meta-sep" aria-hidden="true">·</span>
          <span className={`transfer-status ${statusClass}`}>
            <span className="status-pill-dot" aria-hidden="true" />
            {STATUS_COPY[statusKey]}
          </span>
          <span className="file-peer-info">
            {isSender ? `To: ${peerName}` : `From: ${peerName}`}
          </span>
        </div>

        {isActive && (
          <div className="progress-bar-container" aria-hidden="true">
            <div
              className="progress-bar-fill"
              style={{ width: `${item.progress ?? 0}%` }}
            />
          </div>
        )}
      </div>

      <div className="file-actions">
        {!isSender && item.status === 'idle' && (
          <button
            type="button"
            className="btn btn-sm btn-primary btn-auto"
            onClick={() => onRequest(item.id)}
          >
            <DownloadIcon />
            Download
          </button>
        )}

        {!isSender && item.status === 'completed' && item.downloadUrl && (
          <button
            type="button"
            className="btn btn-sm btn-primary btn-auto"
            onClick={() => onSave(item.id)}
          >
            <SaveIcon />
            Save
          </button>
        )}

        {(item.status === 'idle' ||
          item.status === 'waiting' ||
          item.status === 'uploading' ||
          item.status === 'downloading') && (
          <button
            type="button"
            className="btn-icon icon-btn-danger"
            onClick={() => onCancel(item.id)}
            title="Cancel transfer"
            aria-label="Cancel transfer"
          >
            <CancelIcon />
          </button>
        )}
      </div>
    </div>
  );
}

const ImageIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <polyline points="21 15 16 10 5 21" />
  </svg>
);

const VideoIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="2" y="6" width="14" height="12" rx="2" />
    <polygon points="22 8 16 12 22 16 22 8" />
  </svg>
);

const AudioIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 18V5l12-2v13" />
    <circle cx="6" cy="18" r="3" />
    <circle cx="18" cy="16" r="3" />
  </svg>
);

const DefaultFileIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
    <polyline points="13 2 13 9 20 9" />
  </svg>
);
