import React from 'react';
import { FileItem } from './FileItem';

export function HistoryPanel({ history, onRequest, onSave, onCancel, getPeerName }) {
    if (history.length === 0) {
        return (
            <div className="empty-state">
                <div className="empty-icon">📂</div>
                <p>No files shared yet.</p>
                <small>Select a device and send files to start.</small>
            </div>
        );
    }

    // Sort by newest first? Or just list as is?
    // Let's reverse to show newest at top if we append to end.
    const reversedHistory = [...history].reverse();

    return (
        <div className="history-list">
            {reversedHistory.map(item => (
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
