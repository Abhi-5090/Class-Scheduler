import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { answerScheduleQuery } from '../lib/assistantEngine.js';
import '../styles/assistant.css';

const INITIAL_MESSAGE = {
  id: 'welcome',
  sender: 'bot',
  text: "Hello! 👋 I'm the **Schedule Assistant** for **Class Scheduler**.\n\nI'm trained live on our entire schedule database. Ask me about trainers, batches, venue occupancy, subjects, or daily timetables!",
  time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
};

const SUGGESTIONS = [
  "📅 Today's schedule",
  "🗓️ September schedule",
  "🗓️ October schedule",
  "👨‍🏫 Who are the trainers?",
  "🏢 Which halls are free?",
  "🍱 Lunch break timing",
  "📊 Schedule summary",
  "🎓 Show all batches",
];

export default function AssistantBot() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([INITIAL_MESSAGE]);
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState(false);
  const [scheduleData, setScheduleData] = useState(null);

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  // Fetch live schedule data on mount and keep updated
  useEffect(() => {
    let mounted = true;
    api.schedule()
      .then(data => { if (mounted) setScheduleData(data); })
      .catch(err => console.warn('Assistant: Failed to fetch live schedule', err));

    return () => { mounted = false; };
  }, []);

  // Auto-scroll to bottom when messages update
  useEffect(() => {
    if (open) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, typing, open]);

  // Focus input when window opens
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, [open]);

  // Refresh schedule data when chat opens
  const handleOpen = () => {
    setOpen(true);
    api.schedule()
      .then(data => setScheduleData(data))
      .catch(() => {});
  };

  const handleSend = async queryText => {
    const text = String(queryText || input).trim();
    if (!text || typing) return;

    const userMsg = {
      id: String(Date.now()),
      sender: 'user',
      text,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setTyping(true);

    // Ensure we have fresh schedule data
    let currentData = scheduleData;
    if (!currentData) {
      try {
        currentData = await api.schedule();
        setScheduleData(currentData);
      } catch (err) {
        console.warn('Assistant error loading data', err);
      }
    }

    // Process answer with natural realistic typing delay (300-600ms)
    setTimeout(() => {
      const botResponseText = answerScheduleQuery(text, currentData);
      const botMsg = {
        id: String(Date.now() + 1),
        sender: 'bot',
        text: botResponseText,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      setMessages(prev => [...prev, botMsg]);
      setTyping(false);
    }, 450);
  };

  const handleKeyDown = e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleClear = () => {
    setMessages([INITIAL_MESSAGE]);
  };

  // Helper to render markdown-like formatted text with bold, lists, and code
  const renderFormattedText = content => {
    const lines = String(content || '').split('\n');
    return lines.map((line, idx) => {
      // Process inline bold **text** and `code`
      const parts = line.split(/(\*\*.*?\*\*|`.*?`|\*.*?\*)/g);
      const formattedParts = parts.map((part, pIdx) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={pIdx}>{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith('`') && part.endsWith('`')) {
          return <code key={pIdx}>{part.slice(1, -1)}</code>;
        }
        if (part.startsWith('*') && part.endsWith('*') && !part.startsWith('**')) {
          return <em key={pIdx}>{part.slice(1, -1)}</em>;
        }
        return part;
      });

      return (
        <span key={idx} style={{ display: 'block', minHeight: line.trim() ? 'auto' : '8px' }}>
          {formattedParts}
        </span>
      );
    });
  };

  return (
    <>
      {/* ── Floating Launcher ── */}
      <div className="asst-launcher-wrap">
        <div className="asst-tooltip">
          <span>How can I help you?</span>
          <span style={{ fontSize: '14px' }}>👋</span>
        </div>

        <button
          type="button"
          className="asst-btn"
          onClick={() => (open ? setOpen(false) : handleOpen())}
          aria-label="Open Schedule Assistant"
          title="Chat with the Schedule Assistant"
        >
          <span className="asst-pulse-ring" />
          <span className="asst-pulse-ring" />
          <span className="asst-btn-badge" />

          <svg className="asst-btn-icon" viewBox="0 0 24 24">
            <path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.38-1 1.72V7h2a5 5 0 0 1 5 5v1h1a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-1v1a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5v-1H3a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h1v-1a5 5 0 0 1 5-5h2V5.72A2 2 0 0 1 10 4a2 2 0 0 1 2-2zm-3 8a3 3 0 0 0-3 3v5a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3v-5a3 3 0 0 0-3-3H9zm-1 3.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm8 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z" />
          </svg>
        </button>
      </div>

      {/* ── Chat Window ── */}
      {open && (
        <div className="asst-window" role="dialog" aria-label="Schedule Assistant chat window">
          {/* Header */}
          <div className="asst-header">
            <div className="asst-header-left">
              <div className="asst-avatar">
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.38-1 1.72V7h2a5 5 0 0 1 5 5v1h1a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-1v1a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5v-1H3a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h1v-1a5 5 0 0 1 5-5h2V5.72A2 2 0 0 1 10 4a2 2 0 0 1 2-2zm-3 8a3 3 0 0 0-3 3v5a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3v-5a3 3 0 0 0-3-3H9zm-1 3.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm8 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z" />
                </svg>
                <span className="asst-status-dot" />
              </div>
              <div className="asst-title-group">
                <span className="asst-title">
                  Assistant <span className="asst-sparkle">✦</span>
                </span>
                <span className="asst-subtitle">
                  <span className="asst-live-pill" /> Live Schedule Data
                </span>
              </div>
            </div>

            <div className="asst-header-actions">
              <button
                type="button"
                className="asst-hbtn"
                onClick={handleClear}
                title="Clear conversation"
                aria-label="Clear chat"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                  <path d="M3 3v5h5" />
                </svg>
              </button>
              <button
                type="button"
                className="asst-hbtn"
                onClick={() => setOpen(false)}
                title="Close chat"
                aria-label="Close"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          </div>

          {/* Messages Stream */}
          <div className="asst-messages">
            {messages.map(msg => (
              <div key={msg.id} className={`asst-msg ${msg.sender}`}>
                <div className="asst-msg-bubble">
                  {renderFormattedText(msg.text)}
                  <span className="asst-msg-time">{msg.time}</span>
                </div>
              </div>
            ))}

            {typing && (
              <div className="asst-msg bot">
                <div className="asst-typing">
                  <span className="asst-dot" />
                  <span className="asst-dot" />
                  <span className="asst-dot" />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Suggestion Chips */}
          <div className="asst-suggestions">
            {SUGGESTIONS.map((s, idx) => (
              <button
                key={idx}
                type="button"
                className="asst-chip"
                onClick={() => handleSend(s)}
              >
                {s}
              </button>
            ))}
          </div>

          {/* Input Bar */}
          <form
            className="asst-input-bar"
            onSubmit={e => {
              e.preventDefault();
              handleSend();
            }}
          >
            <input
              ref={inputRef}
              className="asst-input"
              type="text"
              placeholder="Ask about trainers, batches, halls..."
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            <button
              type="submit"
              className="asst-send-btn"
              disabled={!input.trim() || typing}
              aria-label="Send query"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </form>
        </div>
      )}
    </>
  );
}
