import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, type GameMode, type ModeState } from './api';
import { useAuth } from './auth';

/**
 * Educational vs Challenge mode is authoritative on the server (it controls points, the fail counter
 * and the challenge end). This context fetches and caches that state, polling so expiry-driven fails
 * (counted by the game engine) show up without a reload.
 */
interface ModeContextValue {
  state: ModeState | null;
  mode: GameMode;
  isChallenge: boolean;
  setMode(mode: GameMode): Promise<void>;
  skip(objectiveId: number): Promise<void>;
  refresh(): void;
}

const ModeContext = createContext<ModeContextValue | null>(null);

export function ModeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [state, setState] = useState<ModeState | null>(null);

  const refresh = useCallback(() => {
    api
      .getMode()
      .then(setState)
      .catch(() => {
        /* not signed in yet, or offline — keep last known state */
      });
  }, []);

  // Refresh on mount, whenever the signed-in player changes (guest creation, sign in/out), and on a poll
  // so expiry-driven fails counted by the game engine appear without a reload.
  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, 10_000);
    return () => window.clearInterval(id);
  }, [refresh, user?.id]);

  const setMode = useCallback(async (mode: GameMode) => {
    const next = await api.setMode(mode);
    setState(next);
  }, []);

  const skip = useCallback(async (objectiveId: number) => {
    const next = await api.skipObjective(objectiveId);
    setState(next);
  }, []);

  const value = useMemo<ModeContextValue>(
    () => ({
      state,
      mode: state?.mode ?? 'Educational',
      isChallenge: state?.mode === 'Challenge',
      setMode,
      skip,
      refresh,
    }),
    [state, setMode, skip, refresh],
  );

  return <ModeContext.Provider value={value}>{children}</ModeContext.Provider>;
}

export function useMode(): ModeContextValue {
  const ctx = useContext(ModeContext);
  if (!ctx) throw new Error('useMode must be used within a ModeProvider');
  return ctx;
}
