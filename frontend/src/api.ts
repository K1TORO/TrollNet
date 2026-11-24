export interface User {
  id: number;
  username: string;
  role: 'User' | 'Moderator' | 'Admin';
}

export interface AuthResponse {
  token: string;
  expiresAt: string;
  user: User;
}

export interface Post {
  id: number;
  authorId: number;
  authorName: string;
  content: string;
  isTrending: boolean;
  createdAt: string;
  commentCount: number;
}

export interface Comment {
  id: number;
  postId: number;
  authorId: number;
  authorName: string;
  content: string;
  createdAt: string;
}

export interface PostDetail extends Omit<Post, 'commentCount'> {
  comments: Comment[];
}

export interface Objective {
  id: number;
  title: string;
  description: string;
  category: string;
  difficulty: number;
  points: number;
  targetPostId: number | null;
  createdAt: string;
  expiresAt: string;
  isCompleted: boolean;
  completedByUsername: string | null;
}

export interface SubmitResult {
  correct: boolean;
  pointsAwarded: number;
  message: string;
}

export interface ScoreEntry {
  userId: number;
  username: string;
  points: number;
}

export const PAGE_SIZE = 20;

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** Fired when the server rejects the stored token, so the UI can sign the user out. */
export const UNAUTHORIZED_EVENT = 'trollnet:unauthorized';
/** Fired after a successful flag capture, so score widgets can refresh. */
export const SCORE_CHANGED_EVENT = 'trollnet:score-changed';

const TOKEN_KEY = 'trollnet.token';

// VULN-SPOT #19: Sensitive token in browser storage (CWE-922)
//   Trade-off: localStorage is readable by any script on the page, so a single XSS bug (see #02)
//   could leak the token. The alternative is an HttpOnly cookie, which in turn needs CSRF protection (#05).
//   Here: XSS is mitigated by escaping + CSP, and tokens expire (Jwt:ExpiryMinutes).

export const tokenStore = {
  get(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token: string) {
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* storage unavailable: the session lasts until reload */
    }
  },
  clear() {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
  },
};

const FALLBACK_MESSAGES: Record<number, string> = {
  401: 'Your session expired. Reconnecting...',
  403: 'You are not allowed to do that.',
  404: 'Not found.',
  429: 'Too many requests. Slow down and try again in a minute.',
};

async function readError(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (typeof body?.error === 'string') return body.error;
    if (body?.errors) return Object.values(body.errors as Record<string, string[]>).flat().join(' ');
    if (typeof body?.title === 'string') return body.title;
  } catch {
    /* empty or non-JSON body */
  }
  return FALLBACK_MESSAGES[res.status] ?? `Request failed (${res.status}).`;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined) headers.set('Content-Type', 'application/json');

  // VULN-SPOT #05: Cross-Site Request Forgery (CWE-352)
  //   Typical mistake: authenticating with cookies the browser sends automatically, while
  //   state-changing endpoints (POST/PUT/DELETE) skip anti-forgery token validation.
  //   Here: the token is sent explicitly in the Authorization header, which another site cannot add.
  //   If you ever switch to cookie auth, add anti-forgery tokens and SameSite cookies.
  const token = tokenStore.get();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(`/api${path}`, { ...init, headers });

  if (!res.ok) {
    if (res.status === 401 && token) {
      tokenStore.clear();
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    }
    throw new ApiError(await readError(res), res.status);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const json = (body: unknown) => JSON.stringify(body);

export const api = {
  guest: () => request<AuthResponse>('/auth/guest', { method: 'POST' }),
  me: () => request<User>('/auth/me'),

  feed: (page = 1) => request<Post[]>(`/posts?page=${page}&pageSize=${PAGE_SIZE}`),
  search: (query: string) => request<Post[]>(`/posts/search?query=${encodeURIComponent(query)}`),
  post: (id: number) => request<PostDetail>(`/posts/${id}`),
  createPost: (content: string) => request<Post>('/posts', { method: 'POST', body: json({ content }) }),
  deletePost: (id: number) => request<void>(`/posts/${id}`, { method: 'DELETE' }),
  addComment: (postId: number, content: string) =>
    request<Comment>(`/posts/${postId}/comments`, { method: 'POST', body: json({ content }) }),
  deleteComment: (id: number) => request<void>(`/comments/${id}`, { method: 'DELETE' }),

  objectives: () => request<Objective[]>('/objectives'),
  submitFlag: (objectiveId: number, flag: string) =>
    request<SubmitResult>(`/objectives/${objectiveId}/submit`, { method: 'POST', body: json({ flag }) }),

  leaderboard: () => request<ScoreEntry[]>('/scores/leaderboard'),
  myScore: () => request<ScoreEntry>('/scores/me'),
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return 'Network error. Is the server running?';
  return 'Something went wrong.';
}
