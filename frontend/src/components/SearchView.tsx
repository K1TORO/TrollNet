import { useState, type FormEvent } from 'react';
import { api, errorMessage, type Post } from '../api';
import { pick, useLang } from '../i18n';
import { PostCard } from './PostCard';

export function SearchView() {
  const { lang } = useLang();
  const L = (pl: string, en: string) => pick(lang, pl, en);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Post[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const term = query.trim();
    if (!term) return;
    setBusy(true);
    try {
      setResults(await api.search(term));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <form className="search-form" onSubmit={submit} role="search">
        <input
          type="search"
          placeholder={L('Szukaj postów...', 'Search posts...')}
          value={query}
          maxLength={100}
          onChange={(e) => setQuery(e.target.value)}
          aria-label={L('Szukaj postów', 'Search posts')}
        />
        <button className="primary" type="submit" disabled={busy || !query.trim()}>
          {L('Szukaj', 'Search')}
        </button>
      </form>

      {error && <p className="error">{error}</p>}
      {results !== null && results.length === 0 && <p className="muted center">{L('Brak postów pasujących do wyszukiwania.', 'No posts match your search.')}</p>}
      <div className="list">
        {results?.map((post) => (
          <PostCard
            key={post.id}
            post={post}
            onDeleted={(id) => setResults((list) => list?.filter((p) => p.id !== id) ?? null)}
          />
        ))}
      </div>
    </div>
  );
}
