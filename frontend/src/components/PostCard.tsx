import { useEffect, useState, type FormEvent } from 'react';
import { api, errorMessage, type Comment, type Post } from '../api';
import { useAuth } from '../auth';
import { formatRelative } from '../utils';
import { pick, useLang, type Lang } from '../i18n';

interface Props {
  post: Post;
  onDeleted?: (id: number) => void;
  initiallyExpanded?: boolean;
}

const SYSTEM_AUTHOR_ID = 0;

/** "N comments" with Polish plural forms (1 komentarz / 2–4 komentarze / 5+ komentarzy). */
function commentsLabel(n: number, lang: Lang): string {
  if (lang !== 'pl') return `${n} comment${n === 1 ? '' : 's'}`;
  const mod10 = n % 10;
  const mod100 = n % 100;
  let word: string;
  if (n === 1) word = 'komentarz';
  else if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) word = 'komentarze';
  else word = 'komentarzy';
  return `${n} ${word}`;
}

export function PostCard({ post, onDeleted, initiallyExpanded = false }: Props) {
  const { user } = useAuth();
  const { lang } = useLang();
  const L = (pl: string, en: string) => pick(lang, pl, en);
  const [expanded, setExpanded] = useState(false);
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [commentCount, setCommentCount] = useState(post.commentCount);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isModerator = user !== null && user.role !== 'User';
  const canModify = (authorId: number) =>
    user !== null && (isModerator || (authorId !== SYSTEM_AUTHOR_ID && authorId === user.id));

  const isOpen = expanded || initiallyExpanded;
  const needsComments = isOpen && comments === null;

  // Lazily load comments the first time the post is expanded.
  useEffect(() => {
    if (!needsComments) return;
    let cancelled = false;
    api
      .post(post.id)
      .then((detail) => {
        if (cancelled) return;
        setComments(detail.comments);
        setCommentCount(detail.comments.length);
        setError(null);
      })
      .catch((err) => !cancelled && setError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [needsComments, post.id]);

  async function deletePost() {
    if (!window.confirm(L('Usunąć ten post?', 'Delete this post?'))) return;
    try {
      await api.deletePost(post.id);
      onDeleted?.(post.id);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function deleteComment(id: number) {
    try {
      await api.deleteComment(id);
      setComments((list) => list?.filter((c) => c.id !== id) ?? null);
      setCommentCount((n) => Math.max(0, n - 1));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function addComment(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    const content = draft.trim();
    if (!content) return;
    setBusy(true);
    try {
      const created = await api.addComment(post.id, content);
      setComments((list) => [...(list ?? []), created]);
      setCommentCount((n) => n + 1);
      setDraft('');
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className={post.isDefaced ? 'post defaced' : 'post'}>
      <header className="post-header">
        <span>
          {L('Opublikował', 'Posted by')} <strong>{post.authorName}</strong>{' '}
          <span className="small">
            · {formatRelative(post.createdAt)} · #{post.id}
          </span>
          {post.isTrending && <span className="hot-tag">HOT</span>}
          {post.isDefaced && (
            <span className="pwned-tag" title={L('Przejęte przez trolla', 'Pwned by a troll')}>
              🔓 {L('PRZEJĘTE', 'PWNED')}
            </span>
          )}
        </span>
        {canModify(post.authorId) && (
          <button className="link danger small" onClick={deletePost} aria-label={L('Usuń post', 'Delete post')}>
            {L('Usuń', 'Delete')}
          </button>
        )}
      </header>

      {/*
        VULN-SPOT #02: Cross-Site Scripting, stored XSS (CWE-79) — INTENTIONAL FOR TRAINING
          User content is injected as raw HTML with dangerouslySetInnerHTML, and nginx's weak CSP allows
          inline handlers. Post e.g. <img src=x onerror="alert(document.domain)"> as a post/comment.
          Fix: render as text ({post.content}) or sanitize with a strict allow-list before rendering.
      */}
      <p className="post-content" dangerouslySetInnerHTML={{ __html: post.content }} />

      {!initiallyExpanded && (
        <button className="link small" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
          {expanded ? L('Ukryj komentarze', 'Hide comments') : commentsLabel(commentCount, lang)}
        </button>
      )}

      {error && <p className="error small">{error}</p>}

      {isOpen && (
        <section className="comments">
          {comments === null ? (
            <p className="muted small">{L('Ładowanie komentarzy...', 'Loading comments...')}</p>
          ) : comments.length === 0 ? (
            <p className="muted small">{L('Jeszcze nie ma komentarzy.', 'No comments yet.')}</p>
          ) : (
            <ul>
              {comments.map((c) => (
                <li key={c.id} className="comment">
                  <div>
                    <strong>@{c.authorName}</strong>{' '}
                    <span className="muted small">{formatRelative(c.createdAt)}</span>
                  </div>
                  {/* VULN-SPOT #02: stored XSS (CWE-79). Comments are also injected as raw HTML. */}
                  <p dangerouslySetInnerHTML={{ __html: c.content }} />
                  {canModify(c.authorId) && (
                    <button className="link danger small" onClick={() => deleteComment(c.id)}>
                      {L('Usuń', 'Delete')}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          <form className="comment-form" onSubmit={addComment}>
            <input
              placeholder={L('Napisz komentarz...', 'Write a comment...')}
              value={draft}
              maxLength={1000}
              onChange={(e) => setDraft(e.target.value)}
            />
            <button className="primary small" type="submit" disabled={busy || !user || !draft.trim()}>
              {L('Odpowiedz', 'Reply')}
            </button>
          </form>
        </section>
      )}
    </article>
  );
}
