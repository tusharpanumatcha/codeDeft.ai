import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Capability, Compatibility, Stats } from '../../../../packages/protocol/src/index';
import { api, client, errorMessage } from '../api';

export type View = 'overview' | 'search' | 'graph' | 'reuse' | 'figma' | 'chat';
/** Cross-view requests (e.g. chat → reuse). `nonce` makes repeated identical requests distinct. */
export type Intents = { search?: { query: string; nonce: number }; reuse?: { requirement: string; autorun: boolean; nonce: number }; figma?: { url: string; nonce: number } };

type Workspace = {
  repository: string; setRepository(value: string): void;
  /** Trimmed repository path, or throws a user-facing error. */
  requireRepository(): string;
  compat: Compatibility | null; recheckServer(): void;
  has(capability: Capability): boolean;
  view: View; navigate(view: View, intents?: Partial<Intents>): void;
  intents: Intents;
  stats: Stats | undefined; setStats(stats: Stats | undefined): void;
};
const Ctx = createContext<Workspace | null>(null);

const storage = {
  get: (key: string) => { try { return localStorage.getItem(key) ?? ''; } catch { return ''; } },
  set: (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* private mode / disabled storage */ } }
};

export function WorkspaceProvider({ children, initialView = 'overview' }: { children: React.ReactNode; initialView?: View }) {
  const [repository, setRepositoryState] = useState(() => storage.get('codedeft-repo'));
  const [compat, setCompat] = useState<Compatibility | null>(null);
  const [view, setView] = useState<View>(initialView);
  const [intents, setIntents] = useState<Intents>({});
  const [stats, setStats] = useState<Stats | undefined>();

  const recheckServer = useCallback(() => { client.compat(true).then(setCompat, () => setCompat(null)); }, []);
  useEffect(() => { client.compat().then(setCompat, () => setCompat(null)); }, []);

  const setRepository = useCallback((value: string) => { setRepositoryState(value); setStats(undefined); }, []);
  const requireRepository = useCallback(() => {
    const value = repository.trim();
    if (!value) throw new Error('Enter the repository path at the top of the page first.');
    storage.set('codedeft-repo', value);
    return value;
  }, [repository]);
  const navigate = useCallback((next: View, add?: Partial<Intents>) => {
    if (add) setIntents(prev => ({ ...prev, ...add }));
    setView(next);
  }, []);
  const has = useCallback((c: Capability) => !!compat?.compatible && compat.capabilities.has(c), [compat]);

  const value = useMemo<Workspace>(() => ({ repository, setRepository, requireRepository, compat, recheckServer, has, view, navigate, intents, stats, setStats }),
    [repository, setRepository, requireRepository, compat, recheckServer, has, view, navigate, intents, stats]);
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
