import { useEffect, useState } from 'react';
import { api, SCORE_CHANGED_EVENT } from './api';
import { useAuth } from './auth';
import { FeedView } from './components/FeedView';
import { LeaderboardView } from './components/LeaderboardView';
import { ObjectivesView } from './components/ObjectivesView';
import { SearchView } from './components/SearchView';
import { TipsView } from './components/TipsView';

type Tab = 'feed' | 'search' | 'objectives' | 'tips' | 'leaderboard';

const TABS: { id: Tab; label: string }[] = [
  { id: 'feed', label: 'Feed' },
  { id: 'search', label: 'Search' },
  { id: 'objectives', label: 'Objectives' },
  { id: 'tips', label: 'Tips' },
  { id: 'leaderboard', label: 'Leaderboard' },
];

export default function App() {
  const { user, error, retry } = useAuth();
  const [tab, setTab] = useState<Tab>('feed');
  const [focusedTipId, setFocusedTipId] = useState<string | null>(null);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">TrollNet</div>

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
            <ScoreBadge key={user.id} />
            <span>@{user.username}</span>
          </div>
        )}
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
        {tab === 'leaderboard' && <LeaderboardView />}
      </main>
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

  return points === null ? null : <span className="muted">{points} pts</span>;
}
