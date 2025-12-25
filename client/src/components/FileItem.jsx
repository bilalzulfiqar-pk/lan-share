import React from 'react';

export function FileItem({ item, onRequest, onCancel, getPeerName }) {
    const isSender = item.direction === 'out';
    const peerName = getPeerName ? getPeerName(item.peerId) : 'Unknown';

    const getStatusColor = (status) => {
        switch (status) {
            case 'completed': return 'success';
            case 'error': return 'error';
            case 'cancelled':
            case 'deleted': return 'cancelled';
            case 'waiting': return 'waiting';
            default: return 'waiting';
        }
    };

    const formatSize = (bytes) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const getIcon = (type) => {
        const strokeColor = "currentColor";
        const strokeWidth = 1.5;

        // Image Icon
        if (type.startsWith('image/')) {
            return (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                    <circle cx="8.5" cy="8.5" r="1.5"></circle>
                    <polyline points="21 15 16 10 5 21"></polyline>
                </svg>
            );
        }

        // Video Icon
        if (type.startsWith('video/')) {
            return (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect>
                    <line x1="7" y1="2" x2="7" y2="22"></line>
                    <line x1="17" y1="2" x2="17" y2="22"></line>
                    <line x1="2" y1="12" x2="22" y2="12"></line>
                    <line x1="2" y1="7" x2="7" y2="7"></line>
                    <line x1="2" y1="17" x2="7" y2="17"></line>
                    <line x1="17" y1="17" x2="22" y2="17"></line>
                    <line x1="17" y1="7" x2="22" y2="7"></line>
                </svg>
            );
        }

        // Audio Icon
        if (type.startsWith('audio/')) {
            return (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 18V5l12-2v13"></path>
                    <circle cx="6" cy="18" r="3"></circle>
                    <circle cx="18" cy="16" r="3"></circle>
                </svg>
            );
        }

        // Search/Code/Other (Default to File)
        return (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
                <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path>
                <polyline points="13 2 13 9 20 9"></polyline>
            </svg>
        );
    };

    const getStatusIcon = (status) => {
        if (status === 'completed') return '✅';
        if (status === 'error') return '⚠️';
        return null;
    };

    const getStatusText = (status, isSender) => {
        if (status === 'idle') {
            return isSender ? 'Waiting for Accept...' : 'Available for Download';
        }
        if (status === 'waiting') return 'Requesting...';
        return status;
    };

    return (
        <div className="file-item">
            <div className="file-icon">
                {getIcon(item.fileType)}
            </div>

            <div className="file-details">
                <span className="file-name" title={item.fileName}>{item.fileName}</span>
                <div className="file-meta">
                    <span>{formatSize(item.fileSize)}</span>
                    <span>•</span>
                    <span className={`transfer-status ${getStatusColor(item.status)}`}>
                        {getStatusText(item.status, isSender)}
                    </span>
                    <span className="file-peer-info">
                        {isSender ? `To: ${peerName}` : `From: ${peerName}`}
                    </span>
                </div>

                {(item.status === 'uploading' || item.status === 'downloading') && (
                    <div className="progress-bar-container">
                        <div
                            className="progress-bar-fill"
                            style={{ width: `${item.progress}%` }}
                        />
                    </div>
                )}
            </div>

            <div className="file-actions">
                {/* Receiver Actions */}
                {!isSender && item.status === 'idle' && (
                    <button className="btn btn-sm btn-primary" onClick={() => onRequest(item.id)}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '4px' }}>
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                            <polyline points="7 10 12 15 17 10"></polyline>
                            <line x1="12" y1="15" x2="12" y2="3"></line>
                        </svg>
                        Download
                    </button>
                )}

                {!isSender && item.status === 'completed' && item.downloadUrl && (
                    <a
                        href={item.downloadUrl}
                        download={item.fileName}
                        className="btn btn-sm btn-primary"
                        style={{ textDecoration: 'none', display: 'flex', alignItems: 'center' }}
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '4px' }}>
                            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
                            <polyline points="17 21 17 13 7 13 7 21"></polyline>
                            <polyline points="7 3 7 8 15 8"></polyline>
                        </svg>
                        Save
                    </a>
                )}

                {/* Cancel Action */}
                {(item.status === 'idle' || item.status === 'waiting' || item.status === 'uploading' || item.status === 'downloading') && (
                    <button
                        className="btn btn-icon btn-danger"
                        onClick={() => onCancel(item.id)}
                        title="Cancel / Delete"
                    >
                        ✕
                    </button>
                )}
            </div>
        </div>
    );
}
