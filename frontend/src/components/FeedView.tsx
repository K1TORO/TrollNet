import { useCallback, useState, type FormEvent } from 'react';
import { api, errorMessage, PAGE_SIZE, type Post } from '../api';
import { useAuth } from '../auth';
import { usePolling } from '../utils';
import { pick, useLang } from '../i18n';
import { PostCard } from './PostCard';

const MAX_POST_LENGTH = 2000;

/** Merge a freshly fetched first page into the list without losing already-loaded older pages. */
function mergeFirstPage(fresh: Post[], existing: Post[]): Post[] {
  const freshIds = new Set(fresh.map((p) => p.id));
  const oldestFreshId = fresh.at(-1)?.id ?? 0;
  return [...fresh, ...existing.filter((p) => !freshIds.has(p.id) && p.id < oldestFreshId)];
}

export function FeedView() {
  const { lang } = useLang();
  const L = (pl: string, en: string) => pick(lang, pl, en);
  const [posts, setPosts] = useState<Post[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    api
      .feed(1)
      .then((items) => {
        setPosts((existing) => mergeFirstPage(items, existing));
        setHasMore((more) => more || items.length === PAGE_SIZE);
        setError(null);
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoaded(true));
  }, []);

  usePolling(refresh, 30_000);

  async function loadMore() {
    try {
      const next = page + 1;
      const items = await api.feed(next);
      setPosts((existing) => {
        const ids = new Set(existing.map((p) => p.id));
        return [...existing, ...items.filter((p) => !ids.has(p.id))];
      });
      setPage(next);
      setHasMore(items.length === PAGE_SIZE);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const removePost = (id: number) => setPosts((list) => list.filter((p) => p.id !== id));

  return (
    <div className="stack">
      <Composer onCreated={(post) => setPosts((list) => [post, ...list])} />

      {error && <p className="error">{error}</p>}
      {loaded && posts.length === 0 && !error && <p className="muted center">{L('Na feedzie cicho... na razie.', 'The feed is quiet... for now.')}</p>}

      <div className="list">
        {posts.map((post) => (
          <PostCard key={post.id} post={post} onDeleted={removePost} />
        ))}
      </div>

      {hasMore && (
        <button className="ghost" onClick={loadMore}>
          {L('Załaduj więcej', 'Load more')}
        </button>
      )}
    </div>
  );
}

function Composer({ onCreated }: { onCreated: (post: Post) => void }) {
  const { user } = useAuth();
  const { lang } = useLang();
  const L = (pl: string, en: string) => pick(lang, pl, en);
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    setBusy(true);
    try {
      onCreated(await api.createPost(content.trim()));
      setContent('');
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card composer" onSubmit={submit}>
      <textarea
        placeholder={L('Co się kotłuje pod mostem?', "What's stirring under the bridge?")}
        value={content}
        maxLength={MAX_POST_LENGTH}
        rows={3}
        onChange={(e) => setContent(e.target.value)}
      />
      <div className="composer-footer">
        <span className="muted small">
          {content.length}/{MAX_POST_LENGTH}
        </span>
        {error && <span className="error small">{error}</span>}
        <button className="primary" type="submit" disabled={busy || !user || !content.trim()}>
          {L('Opublikuj', 'Post')}
        </button>
      </div>
    </form>
  );
}
