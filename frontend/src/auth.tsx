import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError, errorMessage, tokenStore, UNAUTHORIZED_EVENT, type User } from './api';

/**
 * No sign-in screen: every browser automatically gets a guest player (e.g. "troll_48213").
 * The token is kept in localStorage, so the player keeps their name and score between visits.
 */
interface SessionState {
  user: User | null;
  error: string | null;
  retry(): void;
}

const SessionContext = createContext<SessionState | null>(null);

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

  const value = useMemo(() => ({ user, error, retry: connect }), [user, error, connect]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useAuth(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>.');
  return ctx;
}
