import { useCallback, useEffect, useRef, useState } from 'react';
import type { FeatureDetail, FeatureSummary, ReuseChoice } from '../../../../packages/protocol/src/index';
import { api, errorMessage, isAbort } from '../api';

/** Feature list for the sidebar. Reloads when the repository or search text changes, or on demand. */
export function useFeatureList(repository: string, enabled: boolean, q: string) {
  const [features, setFeatures] = useState<FeatureSummary[]>([]);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  const reload = useCallback(async () => {
    if (!enabled || !repository.trim()) { setFeatures([]); return; }
    const id = ++seq.current; setLoading(true);
    try { const list = await api.features.list(repository.trim(), { q: q.trim() || undefined }); if (id === seq.current) { setFeatures(list); setError(undefined); } }
    catch (e) { if (id === seq.current && !isAbort(e)) setError(errorMessage(e)); }
    finally { if (id === seq.current) setLoading(false); }
  }, [repository, enabled, q]);
  useEffect(() => { const t = setTimeout(() => { void reload(); }, q ? 200 : 0); return () => clearTimeout(t); }, [reload, q]);
  return { features, error, loading, reload };
}

const POLL_MS = 1500;

/**
 * One feature's conversation and context. Every action returns the updated feature from the server
 * (the server is the source of truth, so a reload shows exactly the same thing). While a proposal is
 * generating, the feature is polled until the job finishes.
 */
export function useFeature(id: string | undefined, onChanged: () => void) {
  const [detail, setDetail] = useState<FeatureDetail>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const current = useRef(id);
  current.current = id;

  const accept = useCallback((d: FeatureDetail) => { if (d.feature.id === current.current) { setDetail(d); setError(undefined); } onChanged(); }, [onChanged]);
  const load = useCallback(async () => {
    if (!id) { setDetail(undefined); return; }
    try { const d = await api.features.get(id); if (current.current === id) { setDetail(d); setError(undefined); } }
    catch (e) { if (current.current === id) setError(errorMessage(e)); }
  }, [id]);
  useEffect(() => { setDetail(undefined); setError(undefined); void load(); }, [load]);

  const generating = detail?.feature.status === 'generating';
  useEffect(() => {
    if (!generating || !id) return;
    const timer = setInterval(async () => {
      try { const d = await api.features.get(id); if (current.current === id) { setDetail(d); if (d.feature.status !== 'generating') onChanged(); } } catch { /* keep polling */ }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [generating, id, onChanged]);

  const run = useCallback(async (label: string, work: () => Promise<FeatureDetail>) => {
    setBusy(label); setError(undefined);
    try { accept(await work()); return true; }
    catch (e) { setError(errorMessage(e)); return false; }
    finally { setBusy(undefined); }
  }, [accept]);

  return {
    detail, error, busy, reload: load, clearError: () => setError(undefined),
    send: (text: string) => run('Working…', () => api.features.send(id!, text)),
    readDesign: (url: string, token: string) => run('Reading the Figma frame…', () => api.features.readDesign(id!, url, token)),
    setReuse: (choices: Record<string, ReuseChoice>) => run('Saving…', () => api.features.setReuse(id!, choices)),
    generate: (instructions?: string) => run('Starting generation…', () => api.features.generate(id!, instructions)),
    refresh: () => run('Re-running matching…', () => api.features.refresh(id!)),
    update: (patch: { name?: string; status?: 'done' | 'exploring'; archived?: boolean }) => run('Saving…', () => api.features.update(id!, patch))
  };
}
export type FeatureController = ReturnType<typeof useFeature>;
