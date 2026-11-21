import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Capability, Compatibility, Stats } from '../../../../packages/protocol/src/index';
import { api, client, errorMessage } from '../api';

/** 'feature' shows a feature chat; the others are repository-wide pages. */
export type View = 'feature' | 'overview' | 'search' | 'graph';
/** Cross-view requests (e.g. chat → reuse). `nonce` makes repeated identical requests distinct. */
export type Intents = { search?: { query: string; nonce: number } };

type Workspace = {
  repository: string; setRepository(value: string): void;
  /** Trimmed repository path, or throws a user-facing error. */
  requireRepository(): string;
  compat: Compatibility | null; recheckServer(): void;
  has(capability: Capability): boolean;
  view: View; navigate(view: View, intents?: Partial<Intents>): void;
  /** Open feature chat (remembered per repository in this browser). */
  featureId: string | undefined; openFeature(id: string | undefined): void;
  intents: Intents;
  stats: Stats | undefined; setStats(stats: Stats | undefined): void;
  /** Repositories used before, most recent first (paths only; kept in this browser). */
  recentRepositories: string[]; rememberRepository(path: string): void; forgetRepository(path: string): void;
  /**
   * Figma token for this tab only: held in memory so it is not pasted for every read, never written to
   * storage, gone on reload or tab close, cleared by Disconnect or when Figma rejects it.
   */
  figmaToken: string; setFigmaToken(token: string): void;
};
const Ctx = createContext<Workspace | null>(null);

const storage = {
  get: (key: string) => { try { return localStorage.getItem(key) ?? ''; } catch { return ''; } },
  set: (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* private mode / disabled storage */ } }
};

export function WorkspaceProvider({ children, initialView = 'feature' }: { children: React.ReactNode; initialView?: View }) {
  const [repository, setRepositoryState] = useState(() => storage.get('codedeft-repo'));
  const [compat, setCompat] = useState<Compatibility | null>(null);
  const [view, setView] = useState<View>(initialView);
  const [featureId, setFeatureId] = useState<string | undefined>(() => storage.get(`codedeft-feature:${storage.get('codedeft-repo')}`) || undefined);
  const [intents, setIntents] = useState<Intents>({});
  const [stats, setStats] = useState<Stats | undefined>();
  const [recentRepositories, setRecent] = useState<string[]>(() => { try { const v = JSON.parse(storage.get('codedeft-recent-repos') || '[]'); return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 6) : []; } catch { return []; } });
  const [figmaToken, setFigmaToken] = useState('');
  const rememberRepository = useCallback((path: string) => setRecent(list => { const next = [path, ...list.filter(p => p !== path)].slice(0, 6); storage.set('codedeft-recent-repos', JSON.stringify(next)); return next; }), []);
  const forgetRepository = useCallback((path: string) => setRecent(list => { const next = list.filter(p => p !== path); storage.set('codedeft-recent-repos', JSON.stringify(next)); return next; }), []);

  const recheckServer = useCallback(() => { client.compat(true).then(setCompat, () => setCompat(null)); }, []);
  useEffect(() => { client.compat().then(setCompat, () => setCompat(null)); }, []);

  const setRepository = useCallback((value: string) => { setRepositoryState(value); setStats(undefined); setFeatureId(storage.get(`codedeft-feature:${value.trim()}`) || undefined); }, []);
  const openFeature = useCallback((id: string | undefined) => { setFeatureId(id); storage.set(`codedeft-feature:${repository.trim()}`, id ?? ''); setView('feature'); }, [repository]);
  const requireRepository = useCallback(() => {
    const value = repository.trim();
    if (!value) throw new Error('Choose a repository first: use the repository button at the top of the page.');
    storage.set('codedeft-repo', value);
    return value;
  }, [repository]);
  const navigate = useCallback((next: View, add?: Partial<Intents>) => {
    if (add) setIntents(prev => ({ ...prev, ...add }));
    setView(next);
  }, []);
  const has = useCallback((c: Capability) => !!compat?.compatible && compat.capabilities.has(c), [compat]);

  const value = useMemo<Workspace>(() => ({ repository, setRepository, requireRepository, compat, recheckServer, has, view, navigate, featureId, openFeature, intents, stats, setStats, recentRepositories, rememberRepository, forgetRepository, figmaToken, setFigmaToken }),
    [repository, setRepository, requireRepository, compat, recheckServer, has, view, navigate, featureId, openFeature, intents, stats, recentRepositories, rememberRepository, forgetRepository, figmaToken]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWorkspace(): Workspace {
  const ws = useContext(Ctx);
  if (!ws) throw new Error('useWorkspace must be used inside WorkspaceProvider');
  return ws;
}

/** Loads repository statistics; shared by the repository bar and the overview. */
export async function loadStats(repository: string, signal?: AbortSignal): Promise<Stats> {
  const { stats } = await api.info(repository, { signal });
  if (!stats) throw new Error('The server returned no statistics for this repository');
  return stats;
}
export { errorMessage };
