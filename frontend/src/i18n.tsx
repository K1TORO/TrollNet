import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type Lang = 'pl' | 'en';

interface LangState {
  lang: Lang;
  setLang(lang: Lang): void;
  toggle(): void;
}

const LangContext = createContext<LangState | null>(null);
const LANG_KEY = 'trollnet.lang';

function readLang(): Lang {
  try {
    const stored = localStorage.getItem(LANG_KEY);
    if (stored === 'pl' || stored === 'en') return stored;
  } catch {
    /* storage unavailable */
  }
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('pl') ? 'pl' : 'en';
}

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readLang);

  useEffect(() => {
    try {
      localStorage.setItem(LANG_KEY, lang);
    } catch {
      /* storage unavailable */
    }
    if (typeof document !== 'undefined') document.documentElement.lang = lang;
  }, [lang]);

  const value = useMemo<LangState>(
    () => ({
      lang,
      setLang: setLangState,
      toggle: () => setLangState((l) => (l === 'pl' ? 'en' : 'pl')),
    }),
    [lang],
  );

  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useLang(): LangState {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error('useLang must be used within a LangProvider');
  return ctx;
}

/** Pick the string for the active language. Keeps translations next to their use site. */
export function pick(lang: Lang, pl: string, en: string): string {
  return lang === 'pl' ? pl : en;
}
