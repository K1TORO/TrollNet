import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { api, type ChatMsg } from '../api';
import { pick, useLang } from '../i18n';
import { useAssistantEnabled } from '../assistant';
import { TypingText } from './TypingText';

/** Floating AI security-tutor chat. Only shown when the ai-service is configured. */
export function AiTutor() {
  const enabled = useAssistantEnabled();
  const { lang } = useLang();
  const L = (pl: string, en: string) => pick(lang, pl, en);
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);

  const scrollToBottom = useCallback(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, []);

  useEffect(scrollToBottom, [messages, busy, scrollToBottom]);

  if (!enabled) return null;

  async function send(e: FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    const next = [...messages, { role: 'user', content: text } as ChatMsg];
    setMessages(next);
    setInput('');
    setBusy(true);
    try {
      const res = await api.assistantChat(next, lang);
      setMessages((m) => [...m, { role: 'assistant', content: res.text }]);
    } catch {
      setMessages((m) => [...m, { role: 'assistant', content: L('Asystent jest chwilowo niedostępny.', 'The assistant is unavailable right now.') }]);
    } finally {
      setBusy(false);
    }
  }

  // Keep the panel mounted (just hidden) when closed, so messages — and the last reply's finished typing
  // animation — persist instead of replaying every time the Oracle is reopened.
  return (
    <>
      {!open && (
        <button className="ai-toggle" onClick={() => setOpen(true)}>
          🔮 {L('Wyrocznia', 'Oracle')}
        </button>
      )}
      <aside className="ai-panel" aria-label={L('Wyrocznia', 'Oracle')} style={{ display: open ? undefined : 'none' }}>
      <div className="ai-header">
        <span className="ai-title">🔮 {L('Wyrocznia — bezpieczeństwo', 'The Oracle — security')}</span>
        <button className="link small" onClick={() => setOpen(false)} aria-label={L('Ukryj', 'Hide')}>
          {L('Ukryj', 'Hide')}
        </button>
      </div>
      <div className="ai-messages" ref={listRef}>
        {messages.length === 0 && (
          <p className="muted small">
            {L('Zapytaj o dowolną podatność, pojęcie lub technikę (XSS, SQLi, alg:none, CSP, CWE…). Nie podam gotowych flag.',
              'Ask about any vulnerability, concept or technique (XSS, SQLi, alg:none, CSP, CWE…). I will not hand out flags.')}
          </p>
        )}
        {messages.map((m, i) => {
          // Only the newest assistant reply types out; earlier messages render instantly.
          const animate = m.role === 'assistant' && i === messages.length - 1;
          return (
            <div key={i} className={m.role === 'user' ? 'ai-msg user' : 'ai-msg assistant'}>
              <span className="ai-role">{m.role === 'user' ? L('Ty', 'You') : L('Wyrocznia', 'Oracle')}</span>
              <div className="ai-text">
                {animate ? <TypingText text={m.content} speed={8} onUpdate={scrollToBottom} /> : m.content}
              </div>
            </div>
          );
        })}
        {busy && <p className="muted small">🔮 {L('Wyrocznia myśli…', 'The Oracle is thinking…')}</p>}
      </div>
      <form className="ai-input-row" onSubmit={send}>
        <input
          className="ai-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={L('Zapytaj o bezpieczeństwo…', 'Ask about security…')}
          aria-label={L('Wiadomość do AI', 'Message to AI')}
          disabled={busy}
        />
        <button className="primary" type="submit" disabled={busy || !input.trim()}>
          {L('Wyślij', 'Send')}
        </button>
      </form>
      </aside>
    </>
  );
}
