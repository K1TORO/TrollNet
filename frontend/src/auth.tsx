import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError, errorMessage, tokenStore, UNAUTHORIZED_EVENT, type User } from './api';

/**
 * Every browser automatically gets a guest player (e.g. "troll_48213"), so no sign-in is required
 * to play. A sign-in form is still offered for objectives that need a real account — notably the
 * seeded admin (VULN-SPOT #16, hard-coded credentials). The token is kept in localStorage, so the
 * player keeps their identity and score between visits.
 */
interface SessionState {
  user: User | null;
  error: string | null;
  retry(): void;
  /** Sign in with a username/password; resolves on success, throws with a message on failure. */
  signIn(username: string, password: string): Promise<User>;
  /** Drop the current session and start a fresh guest player. */
  signOut(): void;
}

const SessionContext = createContext<SessionState | null>(null);

// Holds the token of the account to return to after signing out of a real account (e.g. admin).
const PREVIOUS_TOKEN_KEY = 'trollnet.previousToken';

// Shared in-flight request, so parallel callers (React StrictMode, several 401s) create only one guest.
let pendingSession: Promise<User> | null = null;

function ensureSession(): Promise<User> {
  pendingSession ??= createSession().finally(() => {
    pendingSession = null;
  });
  return pendingSession;
}

async function createSession(): Promise<User> {
  if (tokenStore.get()) {
    try {
      return await api.me();
    } catch (err) {
      // Token expired or the database was reset: fall through and create a new guest.
      if (!(err instanceof ApiError && err.status === 401)) throw err;
    }
  }

  const res = await api.guest();
  tokenStore.set(res.token);
  return res.user;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(() => {
    ensureSession()
      .then((u) => {
        setUser(u);
        setError(null);
      })
      .catch((err) => setError(errorMessage(err)));
  }, []);

  useEffect(() => {
    connect();
    window.addEventListener(UNAUTHORIZED_EVENT, connect);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, connect);
  }, [connect]);

  const signIn = useCallback(async (username: string, password: string) => {
    // Remember the account we're leaving (usually the auto-created guest) so sign-out can return to it,
    // instead of stranding the player's name/score. Keep the earliest one across repeated sign-ins.
    const leaving = tokenStore.get();
    const res = await api.login(username, password);
    if (leaving && leaving !== res.token) {
      try {
        if (!localStorage.getItem(PREVIOUS_TOKEN_KEY)) localStorage.setItem(PREVIOUS_TOKEN_KEY, leaving);
      } catch {
        /* storage unavailable */
      }
    }
    tokenStore.set(res.token);
    setUser(res.user);
    setError(null);
    return res.user;
  }, []);

  const signOut = useCallback(() => {
    // Restore the previous account if we have one; otherwise fall back to a fresh guest.
    let previous: string | null = null;
    try {
      previous = localStorage.getItem(PREVIOUS_TOKEN_KEY);
      localStorage.removeItem(PREVIOUS_TOKEN_KEY);
    } catch {
      /* storage unavailable */
    }

    if (previous) {
      tokenStore.set(previous);
    } else {
      tokenStore.clear();
    }
    setUser(null);
    // createSession() will validate the restored token with /auth/me and fall back to a new guest if it expired.
    connect();
  }, [connect]);

  const value = useMemo(
    () => ({ user, error, retry: connect, signIn, signOut }),
    [user, error, connect, signIn, signOut],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useAuth(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>.');
  return ctx;
}
