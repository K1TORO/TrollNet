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
import { pick, useLang, type Lang } from './i18n';
import { useMode } from './mode';
import { useConfirm } from './components/Confirm';
import type { GameMode } from './api';

type Tab = 'feed' | 'search' | 'objectives' | 'tips' | 'docs' | 'leaderboard' | 'dev';

const TAB_IDS: Tab[] = ['feed', 'search', 'objectives', 'tips', 'docs', 'leaderboard'];

function tabLabel(id: Tab, lang: Lang): string {
  switch (id) {
    case 'feed':
      return pick(lang, 'Feed', 'Feed');
    case 'search':
      return pick(lang, 'Szukaj', 'Search');
    case 'objectives':
      return pick(lang, 'Zadania', 'Objectives');
    case 'tips':
      return pick(lang, 'Wskazówki', 'Tips');
    case 'docs':
      return pick(lang, 'API i DB', 'API & DB');
    case 'leaderboard':
      return pick(lang, 'Ranking', 'Leaderboard');
    case 'dev':
      return pick(lang, 'Dev', 'Dev');
  }
}

export default function App() {
  const { user, error, retry } = useAuth();
  const { lang } = useLang();
  const L = (pl: string, en: string) => pick(lang, pl, en);
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

  const tabs: Tab[] = devEnabled ? [...TAB_IDS, 'dev'] : TAB_IDS;

  useEffect(() => {
    try {
      localStorage.setItem(TERMINAL_OPEN_KEY, terminalOpen ? '1' : '0');
    } catch {
      /* storage unavailable */
    }
  }, [terminalOpen]);

  // Loading a tip's command into the terminal also opens the panel.
  useEffect(() => onTerminalLoad(() => setTerminalOpen(true)), []);

  // VULN-SPOT #02: the beacon a stored XSS payload calls. Registered app-wide (not per objective card) so it
  // works when the payload actually executes — in the rendered feed, on whatever tab the player is viewing.
  // It self-fetches the hidden notice and beacons the flag; the server still requires a stored payload to
  // exist, so the capture only works for the player who planted it.
  useEffect(() => {
    const w = window as unknown as { __trollnetXss?: (objectiveId: number) => Promise<boolean> };
    w.__trollnetXss = async (objectiveId: number) => {
      try {
        const notice = await api.objectiveNotice(objectiveId);
        const res = await api.xssProof(objectiveId, notice.flag);
        if (res.correct) window.dispatchEvent(new Event(SCORE_CHANGED_EVENT));
        return res.correct;
      } catch {
        return false;
      }
    };
    return () => {
      try {
        delete (window as unknown as { __trollnetXss?: unknown }).__trollnetXss;
      } catch {
        /* ignore */
      }
    };
  }, []);

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
          {tabs.map((id) => (
            <button
              key={id}
              className={id === tab ? 'tab active' : 'tab'}
              aria-current={id === tab ? 'page' : undefined}
              onClick={() => {
                if (id === 'tips') setFocusedTipId(null);
                setTab(id);
              }}
            >
              {tabLabel(id, lang)}
            </button>
          ))}
        </nav>

        <div className="account">
          <ModeToggle />
          <LangToggle />
          {user && (
            <>
              <span>
                {L('Zalogowany jako', 'Logged in as')} <strong>{user.username}</strong>
                {user.role !== 'User' && <span className="role-badge">{user.role}</span>}
              </span>
              <ScoreBadge key={user.id} />
              <SignIn />
            </>
          )}
        </div>
        </div>
      </header>

      <main className="content">
        {error && (
          <p className="error notice">
            {L('Nie udało się połączyć:', 'Could not connect:')} {error}{' '}
            <button className="link" onClick={retry}>
              {L('Ponów', 'Retry')}
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

/** Educational / Challenge switch + the fail counter, in the top bar. */
function ModeToggle() {
  const { lang } = useLang();
  const L = (pl: string, en: string) => pick(lang, pl, en);
  const { state, mode, setMode } = useMode();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);

  async function choose(next: GameMode) {
    if (next === mode || busy) return;
    const message =
      next === 'Challenge'
        ? L('Znikają szablony i wyjaśnienia, punkty są pełne, a 4 oblane zadania kończą wyzwanie. Licznik startuje od zera.', 'Templates and explanations disappear, points are full, and 4 failed objectives end the challenge. The counter resets.')
        : L('Wracają szablony i wyjaśnienia, punkty są o połowę mniejsze. Licznik oblań startuje od zera.', 'Templates and explanations return, points are halved. The fail counter resets.');
    const ok = await confirm({
      title: next === 'Challenge' ? L('Przejść w tryb Wyzwanie?', 'Switch to Challenge mode?') : L('Przejść w tryb Edukacja?', 'Switch to Educational mode?'),
      message,
      confirmLabel: L('Przełącz', 'Switch'),
      cancelLabel: L('Anuluj', 'Cancel'),
    });
    if (!ok) return;
    setBusy(true);
    try {
      await setMode(next);
    } catch {
      /* ignore; next poll will reconcile */
    } finally {
      setBusy(false);
    }
  }

  const fails = state?.fails ?? 0;
  const maxFails = state?.maxFails ?? 4;
  const ended = state?.challengeStatus === 'Ended';

  return (
    <div className="mode-toggle" role="group" aria-label={L('Tryb gry', 'Game mode')}>
      <button
        className={mode === 'Educational' ? 'mode-option active' : 'mode-option'}
        aria-pressed={mode === 'Educational'}
        disabled={busy}
        onClick={() => choose('Educational')}
        title={L('Szablony i wyjaśnienia; punkty ÷2', 'Templates & explanations; points ÷2')}
      >
        {L('Edukacja', 'Educational')}
      </button>
      <button
        className={mode === 'Challenge' ? 'mode-option active' : 'mode-option'}
        aria-pressed={mode === 'Challenge'}
        disabled={busy}
        onClick={() => choose('Challenge')}
        title={L('Bez podpowiedzi; pełne punkty; 4 oblane = koniec', 'No hints; full points; 4 fails = over')}
      >
        {L('Wyzwanie', 'Challenge')}
      </button>
      <span className={ended ? 'mode-fails ended' : 'mode-fails'} title={L('Oblane zadania', 'Failed objectives')}>
        {mode === 'Challenge' ? `✗ ${fails}/${maxFails}` : `✗ ${fails}`}
      </span>
    </div>
  );
}

/** PL/EN switch in the top bar. */
function LangToggle() {
  const { lang, setLang } = useLang();
  return (
    <div className="lang-toggle" role="group" aria-label="Language">
      <button
        className={lang === 'pl' ? 'lang-option active' : 'lang-option'}
        aria-pressed={lang === 'pl'}
        onClick={() => setLang('pl')}
      >
        PL
      </button>
      <button
        className={lang === 'en' ? 'lang-option active' : 'lang-option'}
        aria-pressed={lang === 'en'}
        onClick={() => setLang('en')}
      >
        EN
      </button>
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
  const { lang } = useLang();
  const L = (pl: string, en: string) => pick(lang, pl, en);
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
      setError(err instanceof Error ? err.message : L('Logowanie nie powiodło się.', 'Sign in failed.'));
    } finally {
      setBusy(false);
    }
  }

  if (!isGuest) {
    return (
      <button className="link small" onClick={signOut}>
        {L('Wyloguj', 'Sign out')}
      </button>
    );
  }

  if (!open) {
    return (
      <button className="link small" onClick={() => setOpen(true)}>
        {L('Zaloguj', 'Sign in')}
      </button>
    );
  }

  return (
    <form className="signin-form" onSubmit={submit}>
      <input
        aria-label={L('Nazwa użytkownika', 'Username')}
        placeholder={L('nazwa użytkownika', 'username')}
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        autoComplete="username"
        autoFocus
      />
      <input
        aria-label={L('Hasło', 'Password')}
        type="password"
        placeholder={L('hasło', 'password')}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="current-password"
      />
      <button type="submit" className="link small" disabled={busy}>
        {busy ? '...' : L('Dalej', 'Go')}
      </button>
      <button type="button" className="link small" onClick={() => setOpen(false)}>
        {L('Anuluj', 'Cancel')}
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
