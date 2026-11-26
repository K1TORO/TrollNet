import { getApiCatalog, getDatabases, API_TYPES } from '../apiCatalog';
import { pick, useLang } from '../i18n';

/** "API & DB" page: a ready-made reconnaissance map of TrollNet. */
export function DocsView() {
  const { lang } = useLang();
  const L = (pl: string, en: string) => pick(lang, pl, en);
  const catalog = getApiCatalog(lang);
  const databases = getDatabases(lang);
  return (
    <div className="stack">
      <div className="intro">
        <h2>{L('Mapa API i bazy danych', 'API & database map')}</h2>
        <p className="muted small">
          {L('Zmapowanie endpointów i modelu danych aplikacji zwykle zajmuje godziny eksploracji. W TrollNet dostajesz to za darmo. Wszystkie żądania idą przez ', "Mapping an application's endpoints and data model usually takes hours of exploring. In TrollNet you get it for free. All requests go through ")}
          <code>http://localhost:8080</code>
          {L('. Uwierzytelnione endpointy oczekują ', '. Authenticated endpoints expect ')}
          <code>Authorization: Bearer &lt;token&gt;</code>.
        </p>
      </div>

      {catalog.map((svc) => (
        <section key={svc.service} className="docs-panel">
          <header className="docs-title">
            <h3>{svc.service}</h3>
            <span className="small">{svc.description}</span>
          </header>
          <div className="table-scroll">
            <table className="docs-table">
              <thead>
                <tr>
                  <th scope="col">{L('Metoda', 'Method')}</th>
                  <th scope="col">{L('Ścieżka', 'Path')}</th>
                  <th scope="col">{L('Uwierz.', 'Auth')}</th>
                  <th scope="col">{L('Body', 'Body')}</th>
                  <th scope="col">{L('Zwraca', 'Returns')}</th>
                </tr>
              </thead>
              <tbody>
                {svc.endpoints.map((e) => (
                  <tr key={`${e.method} ${e.path}`}>
                    <td>
                      <span className={`method method-${e.method.toLowerCase()}`}>{e.method}</span>
                    </td>
                    <td>
                      <code>{e.path}</code>
                      {e.note && <div className="muted small">{e.note}</div>}
                    </td>
                    <td className="small">{e.auth}</td>
                    <td>{e.request ? <code>{e.request}</code> : <span className="muted">—</span>}</td>
                    <td>
                      <code>{e.response}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      <section className="docs-panel">
        <header className="docs-title">
          <h3>{L('Typy odpowiedzi', 'Response types')}</h3>
          <span className="small">{L('JSON używa camelCase; daty to ISO 8601 w UTC.', 'JSON uses camelCase; dates are ISO 8601 in UTC.')}</span>
        </header>
        <dl className="type-list">
          {API_TYPES.map((t) => (
            <div key={t.name}>
              <dt>
                <code>{t.name}</code>
              </dt>
              <dd>
                <code>{t.shape}</code>
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {databases.map((db) => (
        <section key={db.name} className="docs-panel">
          <header className="docs-title">
            <h3>
              <span className="db-icon" aria-hidden="true">
                [DB]
              </span>{' '}
              {db.name}
            </h3>
            <span className="small">{L('PostgreSQL · właściciel ', 'PostgreSQL · owned by ')}{db.owner}</span>
          </header>

          {db.tables.map((table) => (
            <div key={table.name} className="db-table">
              <h4>
                <code>"{table.name}"</code>
              </h4>
              <div className="table-scroll">
                <table className="docs-table">
                  <thead>
                    <tr>
                      <th scope="col">{L('Kolumna', 'Column')}</th>
                      <th scope="col">{L('Typ', 'Type')}</th>
                      <th scope="col">{L('Klucz', 'Key')}</th>
                      <th scope="col">{L('Uwagi', 'Notes')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {table.columns.map((c) => (
                      <tr key={c.name}>
                        <td>
                          <code>{c.name}</code>
                        </td>
                        <td>
                          <code>
                            {c.type}
                            {c.nullable ? ' NULL' : ' NOT NULL'}
                          </code>
                        </td>
                        <td>{c.key && <span className={`key key-${c.key.toLowerCase()}`}>{c.key}</span>}</td>
                        <td className="small">{c.note ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {table.indexes && (
                <p className="muted small">
                  {L('Indeksy: ', 'Indexes: ')}<code>{table.indexes.join(', ')}</code>
                </p>
              )}
            </div>
          ))}
        </section>
      ))}

      <p className="muted small center">
        {L(
          'Każda usługa ma własną bazę danych, więc między bazami nie ma kluczy obcych. Międzyusługowe id, takie jak ',
          'Each service owns its own database, so there are no foreign keys between databases. Cross-service ids like ',
        )}
        <code>AuthorId</code>{L(', to zwykłe liczby całkowite.', ' are plain integers.')}
      </p>
    </div>
  );
}
