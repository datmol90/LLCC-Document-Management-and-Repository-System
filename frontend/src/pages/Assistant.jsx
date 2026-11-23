import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bot, Search, Send, ShieldCheck, Sparkles } from 'lucide-react';
import api, { errorMessage } from '../api/client.js';
import { Card, FileIcon, useToast } from '../components/ui.jsx';
import '../styles/advanced.css';

const SUGGESTIONS = [
  'Find the latest faculty handbook',
  'Show approved documents from the IT Department',
  'Which documents are expiring soon?',
  'Find documents related to student enrollment',
  'Summarize overall repository statistics',
];

const INTRO = {
  id: 'intro',
  role: 'assistant',
  text: 'Hello! I can search and summarize the documents you have access to. Ask a question or try one of the suggestions below.',
  meta: null,
};

function nextId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function messageMeta(meta) {
  if (!meta) return null;
  const elapsed = Number(meta.elapsedMs);
  const total = Number(meta.total);
  const source = String(meta.source || 'fallback').toLowerCase();
  const sourceTone = ['ai', 'fallback'].includes(source) ? source : 'error';
  return (
    <div className="adv-chat-meta">
      <span className={`adv-source-badge adv-source-badge--${sourceTone}`}>{source}</span>
      {Number.isFinite(elapsed) && <span>{(elapsed / 1000).toFixed(2)}s</span>}
      {Number.isFinite(total) && <span>{total} result{total === 1 ? '' : 's'}</span>}
      {typeof meta.scope === 'string' && meta.scope && <span>{meta.scope}</span>}
    </div>
  );
}

export default function Assistant() {
  const toast = useToast();
  const [messages, setMessages] = useState([INTRO]);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const logRef = useRef(null);

  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [messages, busy]);

  const ask = useCallback(async (text) => {
    const trimmed = String(text || '').trim();
    if (!trimmed || busy) return;
    setMessages((current) => [...current, { id: nextId('user'), role: 'user', text: trimmed, meta: null }]);
    setQuestion('');
    setBusy(true);
    try {
      const { data } = await api.post('/assistant/ask', { question: trimmed });
      setMessages((current) => [...current, {
        id: nextId('assistant'),
        role: 'assistant',
        text: data?.answer || 'The assistant did not return an answer for that question.',
        meta: {
          source: data?.source || 'fallback',
          elapsedMs: data?.elapsedMs,
          total: data?.total ?? (Array.isArray(data?.results) ? data.results.length : undefined),
          scope: data?.scope,
          results: Array.isArray(data?.results) ? data.results : [],
        },
      }]);
    } catch (err) {
      const message = errorMessage(err, 'Unable to reach the assistant.');
      setMessages((current) => [...current, {
        id: nextId('error'),
        role: 'assistant',
        text: `I couldn't complete that request. ${message}`,
        meta: { source: 'error' },
      }]);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }, [busy, toast]);

  const submit = (event) => {
    event.preventDefault();
    ask(question);
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>AI Assistant</h1>
          <p>Ask natural-language questions about the documents in the repository.</p>
        </div>
      </div>

      <div className="adv-notice adv-notice--info">
        <ShieldCheck size={18} />
        <div>
          <strong>Answers respect your permissions</strong>
          <p>Results are limited to documents you can access. When AI is not configured, ordinary search is used to answer your question instead.</p>
        </div>
      </div>

      <Card title="Ask the repository" subtitle="Powered by document metadata and your access rights" className="adv-no-print">
        <div className="chat-shell">
          <div className="chat-log" ref={logRef} aria-live="polite">
            {messages.map((message) => (
              <div key={message.id} className={`chat-msg ${message.role === 'user' ? 'chat-msg--user' : ''}`}>
                <span className="chat-msg__avatar">{message.role === 'user' ? 'You' : <Bot size={17} />}</span>
                <div className="chat-msg__bubble">
                  <div style={{ whiteSpace: 'pre-wrap' }}>{message.text}</div>
                  {messageMeta(message.meta)}
                  {message.meta?.results?.length > 0 && (
                    <div className="adv-chat-results">
                      {message.meta.results.slice(0, 6).map((result, index) => (
                        result?.id ? (
                          <Link key={result.id || index} to={`/documents/${result.id}`} title={result.title || 'Open document'}>
                            <FileIcon name={result.latestFileName || result.title} size={13} />
                            {(result.title || result.referenceNumber || 'Document').slice(0, 42)}
                          </Link>
                        ) : null
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {busy && (
              <div className="chat-msg">
                <span className="chat-msg__avatar"><Bot size={17} /></span>
                <div className="chat-msg__bubble"><span className="adv-typing"><span /><span /><span /></span></div>
              </div>
            )}
          </div>

          <div className="adv-suggestions">
            {SUGGESTIONS.map((suggestion) => (
              <button key={suggestion} type="button" className="adv-suggestion" disabled={busy} onClick={() => ask(suggestion)}>
                <Sparkles size={12} style={{ verticalAlign: '-2px', marginRight: 5 }} />
                {suggestion}
              </button>
            ))}
          </div>

          <form className="chat-composer" onSubmit={submit}>
            <input
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Ask about a document, department, status or expiry…"
              aria-label="Your question"
            />
            <button type="submit" className="btn btn--primary" disabled={busy || !question.trim()}>
              <Send size={15} /> {busy ? 'Thinking…' : 'Send'}
            </button>
          </form>
        </div>
      </Card>

      <p className="adv-subtle" style={{ marginTop: 12 }}>
        <Search size={12} /> You can also use the search bar above to find documents by title, reference number or keyword.
      </p>
    </>
  );
}
