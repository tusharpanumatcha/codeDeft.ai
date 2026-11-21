import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export type ThemeChoice = 'system' | 'dark' | 'light' | 'contrast';
export type Theme = Exclude<ThemeChoice, 'system'>;
export type TextSize = 'normal' | 'large' | 'larger';
type Prefs = { theme: ThemeChoice; textSize: TextSize; chatOpen: boolean };

const KEY = 'codedeft-preferences';
const media = (q: string) => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(q) : undefined);

/** Resolves "System" from the OS: "increase contrast" wins, then light/dark. */
export function resolveTheme(choice: ThemeChoice): Theme {
  if (choice !== 'system') return choice;
  if (media('(prefers-contrast: more)')?.matches || media('(forced-colors: active)')?.matches) return 'contrast';
  return media('(prefers-color-scheme: light)')?.matches ? 'light' : 'dark';
}
export function loadPreferences(): Prefs {
  const defaults: Prefs = { theme: 'light', textSize: 'normal', chatOpen: typeof window === 'undefined' || window.innerWidth >= 1280 };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Prefs>;
    return {
      theme: ['system', 'dark', 'light', 'contrast'].includes(saved.theme as string) ? saved.theme! : defaults.theme,
      textSize: ['normal', 'large', 'larger'].includes(saved.textSize as string) ? saved.textSize! : defaults.textSize,
      chatOpen: typeof saved.chatOpen === 'boolean' ? saved.chatOpen : defaults.chatOpen
    };
  } catch { return defaults; }
}
/** Applies theme and text size to <html>. Called before the first render too, so there is no flash. */
export function applyPreferences(p: Pick<Prefs, 'theme' | 'textSize'>): Theme {
  const theme = resolveTheme(p.theme);
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.textSize = p.textSize;
  return theme;
}

type Ctx = Prefs & { resolvedTheme: Theme; setTheme(t: ThemeChoice): void; setTextSize(s: TextSize): void; setChatOpen(open: boolean): void; toggleChat(): void };
const PrefsContext = createContext<Ctx | null>(null);

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const [prefs, setPrefs] = useState<Prefs>(loadPreferences);
  const [resolvedTheme, setResolved] = useState<Theme>(() => resolveTheme(prefs.theme));
  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* storage unavailable */ }
    setResolved(applyPreferences(prefs));
  }, [prefs]);
  // Follow OS changes while "System" is selected.
  useEffect(() => {
    if (prefs.theme !== 'system') return;
    const queries = ['(prefers-color-scheme: light)', '(prefers-contrast: more)', '(forced-colors: active)'].map(media).filter((m): m is MediaQueryList => !!m);
    const update = () => setResolved(applyPreferences(prefs));
    queries.forEach(q => q.addEventListener?.('change', update));
    return () => queries.forEach(q => q.removeEventListener?.('change', update));
  }, [prefs]);
  const setTheme = useCallback((theme: ThemeChoice) => setPrefs(p => ({ ...p, theme })), []);
  const setTextSize = useCallback((textSize: TextSize) => setPrefs(p => ({ ...p, textSize })), []);
  const setChatOpen = useCallback((chatOpen: boolean) => setPrefs(p => ({ ...p, chatOpen })), []);
  const toggleChat = useCallback(() => setPrefs(p => ({ ...p, chatOpen: !p.chatOpen })), []);
  const value = useMemo(() => ({ ...prefs, resolvedTheme, setTheme, setTextSize, setChatOpen, toggleChat }), [prefs, resolvedTheme, setTheme, setTextSize, setChatOpen, toggleChat]);
  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}
export function usePreferences(): Ctx {
  const ctx = useContext(PrefsContext);
  if (!ctx) throw new Error('usePreferences must be used inside PreferencesProvider');
  return ctx;
}
