import { useEffect, useState } from 'react';
import { api } from './api';
import { useAuth } from './auth';

// Cached once the status is definitively known. When the assistant is off, the UI uses the heuristic bot.
let cached: boolean | null = null;
let pending: Promise<boolean> | null = null;

function loadStatus(): Promise<boolean> {
  if (cached !== null) return Promise.resolve(cached);
  // Only a successful response is cached; a transient failure (e.g. a 401 race) returns false WITHOUT caching,
  // so the next check can still discover the assistant.
  pending ??= api
    .assistantStatus()
    .then((s) => (cached = s.enabled))
    .catch(() => false)
    .finally(() => {
      pending = null;
    });
  return pending;
}

/**
 * True when the AI tutor is available. Checks `/assistant/status` once the player is authenticated — the
 * endpoint requires a token, so checking before the guest session exists would 401 and wrongly disable the
 * assistant for the whole page. Re-runs when the user becomes available (guest bootstrap, sign in/out).
 */
export function useAssistantEnabled(): boolean {
  const { user } = useAuth();
  const [enabled, setEnabled] = useState<boolean>(cached ?? false);
  useEffect(() => {
    if (cached === null && !user) return; // wait for the token before the first (auth-required) check
    let active = true;
    void loadStatus().then((v) => active && setEnabled(v));
    return () => {
      active = false;
    };
  }, [user]);
  return enabled;
}
