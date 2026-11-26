import { useCallback, useState } from 'react';
import { api, errorMessage, type ScoreEntry } from '../api';
import { useAuth } from '../auth';
import { usePolling } from '../utils';
import { pick, useLang } from '../i18n';

export function LeaderboardView() {
  const { user } = useAuth();
  const { lang } = useLang();
  const L = (pl: string, en: string) => pick(lang, pl, en);
  const [entries, setEntries] = useState<ScoreEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    api
      .leaderboard()
      .then((items) => {
        setEntries(items);
        setError(null);
      })
      .catch((err) => setError(errorMessage(err)));
  }, []);

  usePolling(refresh, 20_000);

  return (
    <section className="leaderboard-panel">
      <h2>{L('Ranking', 'Leaderboard')}</h2>
      {error && <p className="error">{error}</p>}
      {entries !== null && entries.length === 0 && <p className="muted">{L('Jeszcze nie przechwycono żadnej flagi. Bądź pierwszy!', 'No flags captured yet. Be the first!')}</p>}
      {entries !== null && entries.length > 0 && (
        <table className="leaderboard">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">{L('Troll', 'Troll')}</th>
              <th scope="col" className="num">
                {L('Punkty', 'Points')}
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e, i) => (
              <tr key={e.userId} className={user?.id === e.userId ? 'me' : undefined}>
                <td>{i + 1}</td>
                <td>@{e.username}</td>
                <td className="num">{e.points}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
