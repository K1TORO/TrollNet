import { useEffect, useState } from 'react';
import { api, errorMessage, type DevObjective, type DevTemplate } from '../api';
import { pick, useLang } from '../i18n';

/**
 * Testing console. Only reachable when the game service is started with DevTools enabled
 * (DEV_TOOLS=true in compose). Lets you spawn a specific objective on demand instead of waiting
 * for the random engine, and clear the board.
 */
export function DevView() {
  const { lang } = useLang();
  const L = (pl: string, en: string) => pick(lang, pl, en);
  const [templates, setTemplates] = useState<DevTemplate[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<DevObjective[]>([]);

  useEffect(() => {
    api
      .devStatus()
      .then((s) => setTemplates(s.templates))
      .catch((err) => setError(errorMessage(err)));
  }, []);

  async function spawn(template?: number) {
    setBusy(true);
    setError(null);
    try {
      const obj = await api.devSpawn(template === undefined ? {} : { template });
      setLog((l) => [obj, ...l].slice(0, 20));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.devClear();
      setLog((l) => [{ id: 0, title: L(`wyczyszczono ${res.cleared} zadań`, `cleared ${res.cleared} objective(s)`), vector: '', targetPostId: null, flag: '', expiresAt: '' }, ...l]);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="intro">
        <h2>{L('Konsola Dev', 'Dev console')}</h2>
        <p className="muted small">
          {L('Tylko do testów. Zrespawnuj konkretne zadanie od razu, żeby przećwiczyć jego podatność bez czekania na losowy silnik. Te przyciski rozdają flagi — istnieją, bo usługę uruchomiono z ', 'Testing only. Spawn a specific objective immediately so you can practise its vulnerability without waiting for the random engine. These controls hand out flags — they exist because the service was started with ')}
          <code>DEV_TOOLS=true</code>.
        </p>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="objective-actions">
        <button className="primary" onClick={() => spawn()} disabled={busy}>
          {L('Zrespawnuj losowe', 'Spawn random')}
        </button>
        <button className="link small" onClick={clear} disabled={busy}>
          {L('Wyczyść wszystkie zadania', 'Clear all objectives')}
        </button>
      </div>

      <table className="leaderboard">
        <thead>
          <tr>
            <th>#</th>
            <th>{L('Zadanie', 'Objective')}</th>
            <th>{L('Wektor', 'Vector')}</th>
            <th>{L('Wskazówka', 'Tip')}</th>
            <th>{L('Pkt', 'Pts')}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {templates.map((t) => (
            <tr key={t.index}>
              <td>{t.index}</td>
              <td>{t.title}</td>
              <td><code>{t.vector}</code></td>
              <td>#{t.tipId}</td>
              <td>{t.points}</td>
              <td>
                <button className="link small" onClick={() => spawn(t.index)} disabled={busy}>
                  {L('Zrespawnuj', 'Spawn')}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {log.length > 0 && (
        <div className="intro">
          <h3>{L('Zrespawnowane w tej sesji', 'Spawned this session')}</h3>
          <ul className="terminal-flags">
            {log.map((o, i) => (
              <li key={`${o.id}-${i}`}>
                {o.id > 0 ? (
                  <>
                    #{o.id} <strong>{o.title}</strong> · <code>{o.vector}</code> · {L('post', 'post')} {o.targetPostId} ·{' '}
                    <code>{o.flag}</code>
                  </>
                ) : (
                  <em>{o.title}</em>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
