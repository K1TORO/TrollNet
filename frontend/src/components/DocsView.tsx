import { API_CATALOG, API_TYPES, DATABASES } from '../apiCatalog';

/** "API & DB" page: a ready-made reconnaissance map of TrollNet. */
export function DocsView() {
  return (
    <div className="stack">
      <div className="intro">
        <h2>API &amp; database map</h2>
        <p className="muted small">
          Mapping an application's endpoints and data model usually takes hours of exploring. In TrollNet you get it
          for free. All requests go through <code>http://localhost:8080</code>. Authenticated endpoints expect{' '}
          <code>Authorization: Bearer &lt;token&gt;</code>.
        </p>
      </div>

      {API_CATALOG.map((svc) => (
        <section key={svc.service} className="docs-panel">
          <header className="docs-title">
            <h3>{svc.service}</h3>
            <span className="small">{svc.description}</span>
          </header>
          <div className="table-scroll">
            <table className="docs-table">
              <thead>
                <tr>
                  <th scope="col">Method</th>
                  <th scope="col">Path</th>
                  <th scope="col">Auth</th>
                  <th scope="col">Body</th>
                  <th scope="col">Returns</th>
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
          <h3>Response types</h3>
          <span className="small">JSON uses camelCase; dates are ISO 8601 in UTC.</span>
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

      {DATABASES.map((db) => (
        <section key={db.name} className="docs-panel">
          <header className="docs-title">
            <h3>
              <span className="db-icon" aria-hidden="true">
                [DB]
              </span>{' '}
              {db.name}
            </h3>
            <span className="small">PostgreSQL · owned by {db.owner}</span>
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
                      <th scope="col">Column</th>
                      <th scope="col">Type</th>
                      <th scope="col">Key</th>
                      <th scope="col">Notes</th>
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
                  Indexes: <code>{table.indexes.join(', ')}</code>
                </p>
              )}
            </div>
          ))}
        </section>
      ))}

      <p className="muted small center">
        Each service owns its own database, so there are no foreign keys between databases. Cross-service ids like{' '}
        <code>AuthorId</code> are plain integers.
      </p>
    </div>
  );
}
