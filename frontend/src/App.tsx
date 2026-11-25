import { useEffect, useState, type FormEvent } from 'react';
import { api, SCORE_CHANGED_EVENT } from './api';
import { useAuth } from './auth';
import { FeedView } from './components/FeedView';
import { LeaderboardView } from './components/LeaderboardView';
import { ObjectivesView } from './components/ObjectivesView';
import { SearchView } from './components/SearchView';
import { TipsView } from './components/TipsView';
import { DocsView } from './components/DocsView';
import { DevView } from './components/DevView';
import { onTerminalLoad, Terminal } from './components/Terminal';

type Tab = 'feed' | 'search' | 'objectives' | 'tips' | 'docs' | 'leaderboard' | 'dev';

const TABS: { id: Tab; label: string }[] = [
  { id: 'feed', label: 'Feed' },
  { id: 'search', label: 'Search' },
  { id: 'objectives', label: 'Objectives' },
  { id: 'tips', label: 'Tips' },
  { id: 'docs', label: 'API & DB' },
  { id: 'leaderboard', label: 'Leaderboard' },
];

export default function App() {
  const { user, error, retry } = useAuth();
  const [tab, setTab] = useState<Tab>('feed');
  const [focusedTipId, setFocusedTipId] = useState<string | null>(null);
  const [terminalOpen, setTerminalOpen] = useState(readTerminalOpen);
  const [devEnabled, setDevEnabled] = useState(false);

  // The Dev console tab only appears when the game service was started with DevTools enabled.
  useEffect(() => {
    api
      .devStatus()
      .then((s) => setDevEnabled(s.enabled))
      .catch(() => setDevEnabled(false));
  }, []);

  const tabs = devEnabled ? [...TABS, { id: 'dev' as Tab, label: 'Dev' }] : TABS;

  useEffect(() => {
    try {
      localStorage.setItem(TERMINAL_OPEN_KEY, terminalOpen ? '1' : '0');
    } catch {
      /* storage unavailable */
    }
  }, [terminalOpen]);

  // Loading a tip's command into the terminal also opens the panel.
  useEffect(() => onTerminalLoad(() => setTerminalOpen(true)), []);

  return (
    <div className={terminalOpen ? 'shell with-terminal' : 'shell'}>
    <div className="app">
      <header className="topbar">
        <div className="banner">
          <div className="brand">TrollNet</div>
          <div className="tagline">~*~ the friendliest bridge on the information superhighway ~*~</div>
        </div>

        <div className="navbar">
        <nav className="tabs" aria-label="Main">
          {tabs.map((t) => (
            <button
              key={t.id}
              className={t.id === tab ? 'tab active' : 'tab'}
              aria-current={t.id === tab ? 'page' : undefined}
              onClick={() => {
                if (t.id === 'tips') setFocusedTipId(null);
                setTab(t.id);
              }}
            >
              {t.label}
            </button>
          ))}
        </nav>

        {user && (
          <div className="account">
            <span>
              Logged in as <strong>{user.username}</strong>
              {user.role !== 'User' && <span className="role-badge">{user.role}</span>}
            </span>
            <ScoreBadge key={user.id} />
            <SignIn />
          </div>
        )}
        </div>
      </header>

      <main className="content">
        {error && (
          <p className="error notice">
            Could not connect: {error}{' '}
            <button className="link" onClick={retry}>
              Retry
            </button>
          </p>
        )}

        {tab === 'feed' && <FeedView />}
        {tab === 'search' && <SearchView />}
        {tab === 'objectives' && (
          <ObjectivesView
            onOpenTips={() => {
              setFocusedTipId(null);
              setTab('tips');
            }}
            onOpenTip={(tipId) => {
              setFocusedTipId(tipId);
              setTab('tips');
            }}
          />
        )}
        {tab === 'tips' && <TipsView focusId={focusedTipId} />}
        {tab === 'docs' && <DocsView />}
        {tab === 'leaderboard' && <LeaderboardView />}
        {tab === 'dev' && <DevView />}
      </main>

      <footer className="site-footer">
        <div className="construction" aria-hidden="true" />
        <p className="hit-counter">
          You are visitor <span aria-label="number 1337">0001337</span>
        </p>
      </footer>
    </div>

      {/* Always mounted so output and history survive tab switches; hidden with CSS. */}
      <aside className="side-terminal" hidden={!terminalOpen} aria-label="Terminal">
        <Terminal onClose={() => setTerminalOpen(false)} />
      </aside>
      {!terminalOpen && (
        <button className="terminal-toggle" onClick={() => setTerminalOpen(true)}>
          &gt;_ Terminal
        </button>
      )}
    </div>
  );
}

const TERMINAL_OPEN_KEY = 'trollnet.terminalOpen';

function readTerminalOpen(): boolean {
  try {
    return localStorage.getItem(TERMINAL_OPEN_KEY) !== '0';
  } catch {
    return true;
  }
}

/**
 * Minimal sign-in control in the top bar. Guests stay anonymous, but objectives that need a real
 * account (e.g. The Admin's Vault: admin / admin1234, VULN-SPOT #16) can be unlocked here.
 */
function SignIn() {
  const { user, signIn, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // A guest username is auto-generated as "troll_#####"; anything else is a real signed-in account.
  const isGuest = !user || /^troll_\d+$/.test(user.username);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(username.trim(), password);
      setOpen(false);
      setUsername('');
      setPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed.');
    } finally {
      setBusy(false);
    }
  }

  if (!isGuest) {
    return (
      <button className="link small" onClick={signOut}>
        Sign out
      </button>
    );
  }

  if (!open) {
    return (
      <button className="link small" onClick={() => setOpen(true)}>
        Sign in
      </button>
    );
  }

  return (
    <form className="signin-form" onSubmit={submit}>
      <input
        aria-label="Username"
        placeholder="username"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        autoComplete="username"
        autoFocus
      />
      <input
        aria-label="Password"
        type="password"
        placeholder="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="current-password"
      />
      <button type="submit" className="link small" disabled={busy}>
        {busy ? '...' : 'Go'}
      </button>
      <button type="button" className="link small" onClick={() => setOpen(false)}>
        Cancel
      </button>
      {error && <span className="error small signin-error">{error}</span>}
    </form>
  );
}

function ScoreBadge() {
  const [points, setPoints] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api
        .myScore()
        .then((s) => !cancelled && setPoints(s.points))
        .catch(() => undefined);
    load();
    window.addEventListener(SCORE_CHANGED_EVENT, load);
    return () => {
      cancelled = true;
      window.removeEventListener(SCORE_CHANGED_EVENT, load);
    };
  }, []);

  return points === null ? null : <span className="score-box">{points} pts</span>;
}
