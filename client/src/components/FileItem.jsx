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
        if (type.startsWith('image/')) return '🖼️';
        if (type.startsWith('video/')) return '🎥';
        if (type.startsWith('audio/')) return '🎵';
        return '📄';
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
