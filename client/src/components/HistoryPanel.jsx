import React from 'react';
import { FileItem } from './FileItem';

export function HistoryPanel({ history, onRequest, onSave, onCancel, getPeerName }) {
  if (history.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <line x1="3" y1="13" x2="21" y2="13" />
          </svg>
        </div>
        <p className="empty-state-title">No files shared yet</p>
        <p className="empty-state-hint">Pick a device on the radar and send a file to start transferring.</p>
      </div>
    );
  }

  const reversedHistory = [...history].reverse();

  return (
    <div className="history-list">
      {reversedHistory.map((item) => (
        <FileItem
          key={item.id}
          item={item}
          onRequest={onRequest}
          onSave={onSave}
          onCancel={onCancel}
          getPeerName={getPeerName}
        />
      ))}
    </div>
  );
}
