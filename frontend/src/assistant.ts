import { useEffect, useState } from 'react';
import { api } from './api';

// Cached once per page load: whether the ai-service is configured. When false, the UI uses the heuristic bot.
let cached: boolean | null = null;
let pending: Promise<boolean> | null = null;

function loadStatus(): Promise<boolean> {
  if (cached !== null) return Promise.resolve(cached);
  pending ??= api
    .assistantStatus()
    .then((s) => (cached = s.enabled))
    .catch(() => (cached = false))
    .finally(() => {
      pending = null;
    });
  return pending;
}

/** True when the AI tutor is available. Fetches /assistant/status once and caches the result. */
export function useAssistantEnabled(): boolean {
  const [enabled, setEnabled] = useState<boolean>(cached ?? false);
  useEffect(() => {
    let active = true;
    void loadStatus().then((v) => active && setEnabled(v));
    return () => {
      active = false;
    };
  }, []);
  return enabled;
}
