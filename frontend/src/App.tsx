import { useEffect, useState } from 'react';
import { api, SCORE_CHANGED_EVENT } from './api';
import { useAuth } from './auth';
import { FeedView } from './components/FeedView';
import { LeaderboardView } from './components/LeaderboardView';
import { ObjectivesView } from './components/ObjectivesView';
import { SearchView } from './components/SearchView';
import { TipsView } from './components/TipsView';
import { DocsView } from './components/DocsView';

type Tab = 'feed' | 'search' | 'objectives' | 'tips' | 'docs' | 'leaderboard';

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

  return (
    <div className="app">
      <header className="topbar">
        <div className="banner">
          <div className="brand">TrollNet</div>
          <div className="tagline">~*~ the friendliest bridge on the information superhighway ~*~</div>
        </div>

        <div className="navbar">
        <nav className="tabs" aria-label="Main">
          {TABS.map((t) => (
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
            </span>
            <ScoreBadge key={user.id} />
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
      </main>

      <footer className="site-footer">
        <div className="construction" aria-hidden="true" />
        <p className="hit-counter">
          You are visitor <span aria-label="number 1337">0001337</span>
        </p>
      </footer>
    </div>
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
