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
  /** Set once a player captures this post's objective: content is replaced with troll text, UI marks it "pwned". */
  isDefaced?: boolean;
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
  tipId: string;
  difficulty: number;
  points: number;
  targetPostId: number | null;
  createdAt: string;
  expiresAt: string;
  isCompleted: boolean;
  completedByUsername: string | null;
  /** How this objective's flag is exposed; drives the per-objective capture hint. */
  vector: 'AdminEndpoint' | 'DataLeak' | 'Ssrf' | 'Sqli' | 'MissingAuth' | 'Idor' | 'Xss' | 'MassAssign';
  // VULN-SPOT #15: only the DataLeak objective still returns its flag here; null for every other objective.
  flag: string | null;
  /** True when the current player skipped or let this objective fail (per-player; survives tab switches/reloads). */
  attemptFailed?: boolean;
}

export interface SubmitResult {
  correct: boolean;
  pointsAwarded: number;
  message: string;
}

export interface AssistantStatus {
  enabled: boolean;
}
export interface AssistantReply {
  text: string;
}
export interface HintContext {
  title?: string;
  vector?: string;
  description?: string;
  tipId?: string;
  mode?: string;
  lastCommand?: string;
  lastError?: string;
  lang?: string;
}
export interface ChatMsg {
  role: 'user' | 'assistant';
  content: string;
}

export type GameMode = 'Educational' | 'Challenge';
export type ChallengeStatus = 'None' | 'Active' | 'Ended';

export interface ModeState {
  mode: GameMode;
  fails: number;
  maxFails: number;
  challengeStatus: ChallengeStatus;
  challengeScore: number;
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

// VULN-SPOT #19: Sensitive token in browser storage (CWE-922) — INTENTIONAL FOR TRAINING
//   The JWT lives in localStorage, so any script running on the page (including stored XSS from #02)
//   can read it with localStorage.getItem('trollnet.token') and use it from anywhere.
//   Fix: keep the session in an HttpOnly, Secure, SameSite cookie; JavaScript then cannot read it.
const TOKEN_COOKIE = 'trollnet.token';

function writeTokenCookie(token: string | null) {
  // VULN-SPOT #05: CSRF (CWE-352) — INTENTIONAL FOR TRAINING
  //   A JavaScript-readable cookie is also set. The API accepts the JWT from this cookie and the gateway
  //   allows any CORS origin with credentials, so a malicious site can send authenticated requests
  //   without knowing the token. There is no anti-forgery token.
  //   Fix: HttpOnly + SameSite cookie and anti-forgery validation on state-changing requests.
  const suffix = 'path=/; SameSite=None; Secure';
  document.cookie = token
    ? `${TOKEN_COOKIE}=${encodeURIComponent(token)}; ${suffix}`
    : `${TOKEN_COOKIE}=; ${suffix}; Max-Age=0`;
}

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
    writeTokenCookie(token);
  },
  clear() {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
    writeTokenCookie(null);
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

async function request<T>(path: string, init: RequestInit = {}, opts: { handleUnauthorized?: boolean } = {}): Promise<T> {
  // By default a 401 means "my session expired": drop the token and recreate a guest. Endpoints where a 401
  // is an expected answer (login with wrong credentials) opt out, so a failed sign-in never wipes the session.
  const handleUnauthorized = opts.handleUnauthorized ?? true;
  const headers = new Headers(init.headers);
  if (init.body !== undefined) headers.set('Content-Type', 'application/json');

  // VULN-SPOT #05: Cross-Site Request Forgery (CWE-352) — INTENTIONAL FOR TRAINING
  //   The app sends the JWT in an Authorization header, but the API also accepts the cookie set above.
  //   Combined with the gateway's permissive CORS policy, an attacker page can call POST/DELETE endpoints
  //   with credentials: 'include' and no anti-forgery token is checked.
  //   Fix: do not accept cookie auth for mutations, or require an anti-forgery token + SameSite cookies.
  const token = tokenStore.get();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(`/api${path}`, { ...init, headers });

  if (!res.ok) {
    if (res.status === 401 && token && handleUnauthorized) {
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
  login: (username: string, password: string) =>
    // handleUnauthorized:false — a 401 here is "wrong credentials", not an expired session, so it must not
    // clear the current guest token or trigger a new guest.
    request<AuthResponse>('/auth/login', { method: 'POST', body: json({ username, password }) }, { handleUnauthorized: false }),
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
  // VULN-SPOT #02: the beacon a stored XSS payload hits to capture an XSS objective.
  xssProof: (objectiveId: number, flag: string) =>
    request<SubmitResult>(`/objectives/${objectiveId}/xss-proof`, { method: 'POST', body: json({ flag }) }),
  // VULN-SPOT #02: the XSS objective's flag, loaded into a JS-only variable (never shown on screen).
  objectiveNotice: (objectiveId: number) =>
    request<{ objectiveId: number; flag: string }>(`/objectives/${objectiveId}/notice`),

  // Educational vs Challenge mode + the current challenge run state.
  getMode: () => request<ModeState>('/mode'),
  setMode: (mode: GameMode) => request<ModeState>('/mode', { method: 'POST', body: json({ mode }) }),
  skipObjective: (objectiveId: number) =>
    request<ModeState>(`/objectives/${objectiveId}/skip`, { method: 'POST' }),

  leaderboard: () => request<ScoreEntry[]>('/scores/leaderboard'),
  myScore: () => request<ScoreEntry>('/scores/me'),

  // AI tutor (ai-service). Falls back to the heuristic bot when the assistant is not configured.
  assistantStatus: () => request<AssistantStatus>('/assistant/status'),
  assistantHint: (body: HintContext) => request<AssistantReply>('/assistant/hint', { method: 'POST', body: json(body) }),
  assistantChat: (messages: ChatMsg[], lang: string) =>
    request<AssistantReply>('/assistant/chat', { method: 'POST', body: json({ messages, lang }) }),

  // Testing console (only present when DevTools is enabled in compose).
  devStatus: () => request<DevStatus>('/dev/status'),
  devSpawn: (body: { template?: number; vector?: string }) =>
    request<DevObjective>('/dev/spawn', { method: 'POST', body: json(body) }),
  devClear: () => request<{ cleared: number }>('/dev/clear', { method: 'POST' }),
};

export interface DevTemplate {
  index: number;
  title: string;
  vector: string;
  tipId: string;
  difficulty: number;
  points: number;
}

export interface DevStatus {
  enabled: boolean;
  templates: DevTemplate[];
}

export interface DevObjective {
  id: number;
  title: string;
  vector: string;
  targetPostId: number | null;
  flag: string;
  expiresAt: string;
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return 'Network error. Is the server running?';
  return 'Something went wrong.';
}
