import React, { useEffect } from 'react';

export function TransferModal({ status, progress, fileMeta, isSender, error, onCancel, receivedBlob, onReset }) {

    // Auto download on completion if receiver
    useEffect(() => {
        if (status === 'COMPLETED' && !isSender && receivedBlob) {
            // Optional: Auto download or just wait for user
            // const url = URL.createObjectURL(receivedBlob);
            // const a = document.createElement('a');
            // a.href = url;
            // a.download = fileMeta.name;
            // a.click();
        }
    }, [status, isSender, receivedBlob, fileMeta]);

    const handleDownload = () => {
        if (receivedBlob) {
            const url = URL.createObjectURL(receivedBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fileMeta.name;
            document.body.appendChild(a); // append for firefox
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }
    };

    if (status === 'IDLE') return null;

    return (
        <div className="modal-overlay">
            <div className="modal-content">
                {status === 'ERROR' && (
                    <div className="error">
                        <h3>Error</h3>
                        <p>{error}</p>
                        <button className="action-btn" onClick={onReset}>Close</button>
                    </div>
                )}

                {(status === 'CONNECTING' || status === 'TRANSFERRING') && (
                    <div className="transferring">
                        <h3>{status === 'CONNECTING' ? 'Connecting...' : (isSender ? 'Sending...' : 'Receiving...')}</h3>
                        {fileMeta && <p>{fileMeta.name} ({(fileMeta.size / 1024 / 1024).toFixed(2)} MB)</p>}

                        <div className="progress-bar">
                            <div className="progress-fill" style={{ width: `${progress}%` }}></div>
                        </div>
                        <p>{progress}%</p>
                    </div>
                )}

                {status === 'COMPLETED' && (
                    <div className="completed">
                        <h3>Transfer Completed!</h3>
                        {fileMeta && <p>{fileMeta.name}</p>}
                        {!isSender && (
                            <button className="action-btn" onClick={handleDownload}>
                                Download File
                            </button>
                        )}
                        {isSender && <p>File sent successfully.</p>}

                        <br /><br />
                        <button className="action-btn cancel" onClick={onReset}>Done</button>
                    </div>
                )}
            </div>
        </div>
    );
}
