import { useEffect, useRef, useState } from 'react';
// eslint-disable-next-line no-unused-vars
import { motion } from 'framer-motion';
import { copyText } from '../lib/clipboard';

const URL_SPLIT_PATTERN = /(https?:\/\/[^\s<>"']+)/g;
const URL_MATCH_PATTERN = /^https?:\/\/[^\s<>"']+$/;
const COPIED_FEEDBACK_MS = 1200;

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

function ChatBubble({ message, copiedId, onCopy, reduceMotion }) {
  const isOutgoing = message.direction === 'out';
  const copied = copiedId === message.id;

  return (
    <motion.div
      className={`chat-message-row ${isOutgoing ? 'is-outgoing' : 'is-incoming'}`}
      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 30 }}
    >
      <button
        type="button"
        className={`chat-bubble ${isOutgoing ? 'chat-bubble-out' : 'chat-bubble-in'} ${looksLikeSecret(message.text) ? 'is-secret' : ''}`}
        onClick={() => onCopy(message)}
        title="Copy message"
        aria-label={`Copy message from ${isOutgoing ? 'you' : 'peer'}: ${message.text.slice(0, 60)}`}
      >
        <span className="chat-bubble-text">
          <MessageBody text={message.text} />
        </span>
        <span className="chat-bubble-meta">
          <span className="chat-bubble-time">{formatTimestamp(message.ts)}</span>
          <span className="chat-bubble-copy" aria-hidden="true">{copied ? 'Copied' : 'Copy'}</span>
        </span>
      </button>
    </motion.div>
  );
}

export function ChatPanel({ open, peerName, connectionLabel, messages, onSend, onClose, reduceMotion }) {
  const [draft, setDraft] = useState('');
  const [copiedId, setCopiedId] = useState(null);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, open]);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    }
  }, [open, peerName]);

  const handleCopy = async (message) => {
    const succeeded = await copyText(message.text);
    if (succeeded) {
      setCopiedId(message.id);
      window.setTimeout(() => setCopiedId((current) => (current === message.id ? null : current)), COPIED_FEEDBACK_MS);
    }
  };

  const handleSubmit = (event) => {
    event.preventDefault();
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
                <p>{connectionLabel}</p>
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
                  peer-to-peer channel. Tap any message to copy it.
                </p>
              ) : (
                messages.map((message) => (
                  <ChatBubble
                    key={message.id}
                    message={message}
                    copiedId={copiedId}
                    onCopy={handleCopy}
                    reduceMotion={reduceMotion}
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
                placeholder="Type a message, link or key…"
                maxLength={4000}
                aria-label="Message text"
              />
              <button
                type="submit"
                className="btn btn-primary chat-send-button no-glow"
                disabled={draft.trim() === ''}
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
