import { useCallback, useState, type FormEvent } from 'react';
import { api, errorMessage, SCORE_CHANGED_EVENT, type Objective, type Post } from '../api';
import { useAuth } from '../auth';
import { formatCountdown, useNow, usePolling } from '../utils';
import { PostCard } from './PostCard';

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
        {o.category} · difficulty {o.difficulty}/3 · {o.points} pts
      </p>
      <p>{o.description}</p>

      {/* VULN-SPOT #15: the anonymous objectives API leaks the secret flag to every player.
          The blur below is only cosmetic: the value is still in the DOM and the API response. */}
      <p className="accent-text small leaked-flag">
        Leaked flag:{' '}
        <span className={revealFlag ? '' : 'blurred'} title={revealFlag ? undefined : 'Blurred in the UI only'}>
          {o.flag}
        </span>{' '}
        <button className="link small" onClick={() => setRevealFlag((v) => !v)} aria-expanded={revealFlag}>
          {revealFlag ? 'Hide' : 'Reveal'}
        </button>
      </p>

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
