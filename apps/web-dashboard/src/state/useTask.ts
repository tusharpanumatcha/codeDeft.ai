import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage, isAbort } from '../api';

export type TaskState<T> = { status: 'idle' | 'running' | 'done' | 'error'; data?: T; error?: string };

/**
 * Runs async work for one panel with "latest wins" semantics: starting a new run cancels the previous
 * one (AbortSignal) and a sequence number guarantees that a slow, superseded response can never
 * overwrite a newer result. Work is cancelled when the component unmounts.
 */
export function useTask<T>() {
  const [state, setState] = useState<TaskState<T>>({ status: 'idle' });
  const seq = useRef(0);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  const run = useCallback(async (work: (signal: AbortSignal) => Promise<T>): Promise<T | undefined> => {
    controller.current?.abort();
    const id = ++seq.current;
    const c = new AbortController(); controller.current = c;
    setState(s => ({ ...s, status: 'running', error: undefined }));
    try {
      const data = await work(c.signal);
      if (id === seq.current) setState({ status: 'done', data });
      return data;
    } catch (error) {
      if (id === seq.current && !isAbort(error)) setState(s => ({ ...s, status: 'error', error: errorMessage(error) }));
      return undefined;
    }
  }, []);
  const cancel = useCallback(() => { controller.current?.abort(); seq.current++; setState(s => ({ ...s, status: s.data === undefined ? 'idle' : 'done' })); }, []);
  const reset = useCallback(() => { controller.current?.abort(); seq.current++; setState({ status: 'idle' }); }, []);
  return { ...state, running: state.status === 'running', run, cancel, reset };
}
