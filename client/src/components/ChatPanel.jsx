import { useEffect, useRef, useState } from 'react';
import { copyText } from '../lib/clipboard';

const URL_SPLIT_PATTERN = /(https?:\/\/[^\s<>"']+)/g;
const URL_MATCH_PATTERN = /^https?:\/\/[^\s<>"']+$/;

// Long, space-free strings (API keys, passwords, tokens) render in monospace.
function looksLikeSecret(text) {
  const trimmed = text.trim();
  return trimmed.length >= 16 && !/\s/.test(trimmed);
}

function MessageBody({ text }) {
  const parts = text.split(URL_SPLIT_PATTERN);

  return (
    <>
      {parts.map((part, index) => {
        if (URL_MATCH_PATTERN.test(part)) {
          return (
            <a
              key={index}
              href={part}
              target="_blank"
              rel="noopener noreferrer"
              className="chat-message-link"
            >
              {part}
            </a>
          );
        }
        return looksLikeSecret(part) ? (
          <code key={index} className="chat-message-code">{part}</code>
        ) : (
          <span key={index}>{part}</span>
        );
      })}
    </>
  );
}

function formatTimestamp(ts) {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function CopyIcon({ className = '' }) {
  return (
    <svg width="12" height="12" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect width="13" height="13" x="9" y="9" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon({ className = '' }) {
  return (
    <svg width="12" height="12" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function ChatBubble({ message, copiedId, onCopy, onResetCopy, onCancelReset, isNew }) {
  const isOutgoing = message.direction === 'out';
  const copied = copiedId === message.id;

  return (
    <div
      className={`chat-message-row ${isOutgoing ? 'is-outgoing' : 'is-incoming'}${isNew ? ' is-new' : ''}`}
    >
      <div
        className={`chat-bubble ${isOutgoing ? 'chat-bubble-out' : 'chat-bubble-in'} ${looksLikeSecret(message.text) ? 'is-secret' : ''}`}
        onMouseEnter={copied ? onCancelReset : undefined}
        onMouseLeave={copied ? () => onResetCopy(false) : undefined}
      >
        <span className="chat-bubble-text">
          <MessageBody text={message.text} />
        </span>
        <span className="chat-bubble-meta">
          <span className="chat-bubble-time">{formatTimestamp(message.ts)}</span>
          <button
            type="button"
            className={`chat-bubble-copy ${copied ? 'is-copied' : ''}`}
            onClick={(event) => onCopy(message, event)}
            onBlur={copied ? () => onResetCopy(true) : undefined}
            title={copied ? 'Copied' : 'Copy message text'}
            aria-label={copied ? 'Copied' : `Copy message: ${message.text.slice(0, 60)}`}
          >
            <CopyIcon className="copy-icon-idle" />
            <CheckIcon className="copy-icon-done" />
          </button>
        </span>
      </div>
    </div>
  );
}

export function ChatPanel({ open, peerName, connectionLabel, messages = [], onSend, onClose, reduceMotion, isPeerOnline = true }) {
  const [draft, setDraft] = useState('');
  const [copiedId, setCopiedId] = useState(null);
  const [activePeer, setActivePeer] = useState(null);
  const [initialIds, setInitialIds] = useState(() => new Set());
  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const resetCopyTimerRef = useRef(null);

  const currentPeerKey = open ? peerName : null;
  if (currentPeerKey !== activePeer) {
    setActivePeer(currentPeerKey);
    setInitialIds(open ? new Set((messages || []).map((m) => m.id)) : new Set());
  }

  useEffect(() => {
    return () => {
      if (resetCopyTimerRef.current) {
        window.clearTimeout(resetCopyTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, open]);

  useEffect(() => {
    if (open && isPeerOnline) {
      inputRef.current?.focus();
    }
  }, [open, peerName, isPeerOnline]);

  const handleCopy = async (message, event) => {
    event?.currentTarget?.blur();
    if (resetCopyTimerRef.current) {
      window.clearTimeout(resetCopyTimerRef.current);
      resetCopyTimerRef.current = null;
    }
    const succeeded = await copyText(message.text);
    if (succeeded) {
      setCopiedId(message.id);
      // Auto-revert checkmark back to copy icon after 1.4s, or upon mouse leave
      resetCopyTimerRef.current = window.setTimeout(() => {
        setCopiedId((current) => (current === message.id ? null : current));
        resetCopyTimerRef.current = null;
      }, 1400);
    }
  };

  const handleResetCopy = (immediate = false) => {
    if (resetCopyTimerRef.current) {
      window.clearTimeout(resetCopyTimerRef.current);
      resetCopyTimerRef.current = null;
    }
    if (immediate) {
      setCopiedId(null);
    } else {
      // Allow CSS fade-out transition (--dur-fast: 140ms) to complete before resetting
      // text back to "Copy" so the button stays "Copied" while fading away.
      resetCopyTimerRef.current = window.setTimeout(() => {
        setCopiedId(null);
        resetCopyTimerRef.current = null;
      }, 180);
    }
  };

  const handleCancelReset = () => {
    if (resetCopyTimerRef.current) {
      window.clearTimeout(resetCopyTimerRef.current);
      resetCopyTimerRef.current = null;
    }
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    if (!isPeerOnline) return;
    const text = draft.trim();
    if (!text) return;
    onSend(text);
    setDraft('');
  };

  return (
    <>
      <div
        className={`chat-backdrop ${open ? 'is-visible' : ''}`}
        aria-hidden={!open}
        onClick={open ? onClose : undefined}
      />
      <section
        className={`chat-panel ${open ? 'is-open' : ''}`}
        role="dialog"
        aria-label={`Chat with ${peerName}`}
        aria-hidden={!open}
      >
        <header className="chat-header">
              <div className="chat-header-meta">
                <h3>{peerName}</h3>
                <p className={`chat-status-text ${!isPeerOnline ? 'is-offline' : ''}`}>
                  {!isPeerOnline && <span className="peer-offline-dot" aria-hidden="true" />}
                  {connectionLabel}
                </p>
              </div>
              <button
                type="button"
                className="btn-icon"
                onClick={onClose}
                title="Close chat"
                aria-label="Close chat"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            </header>

            <div className="chat-messages" ref={scrollRef}>
              {messages.length === 0 ? (
                <p className="chat-empty">
                  Messages are sent directly to this device over an encrypted
                  peer-to-peer channel. Use the copy button or select text freely.
                </p>
              ) : (
                messages.map((message) => (
                  <ChatBubble
                    key={message.id}
                    message={message}
                    copiedId={copiedId}
                    onCopy={handleCopy}
                    onResetCopy={handleResetCopy}
                    onCancelReset={handleCancelReset}
                    isNew={!reduceMotion && !initialIds.has(message.id)}
                  />
                ))
              )}
            </div>

            <form className="chat-input-row" onSubmit={handleSubmit}>
              <input
                ref={inputRef}
                className="chat-input"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={isPeerOnline ? 'Type a message, link or key…' : 'Peer has disconnected'}
                maxLength={4000}
                aria-label="Message text"
                disabled={!isPeerOnline}
              />
              <button
                type="submit"
                className="btn btn-primary chat-send-button no-glow"
                disabled={!isPeerOnline || draft.trim() === ''}
                aria-label="Send message"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="m22 2-7 20-4-9-9-4Z" />
                  <path d="M22 2 11 13" />
                </svg>
                Send
              </button>
            </form>
      </section>
    </>
  );
}
