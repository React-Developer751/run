'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

/** Loads data now and again every `ms`. Keeps the last good data visible if a refresh fails. */
export function usePoll<T>(load: () => Promise<T>, ms: number, enabled = true) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const loadRef = useRef(load);
  loadRef.current = load;

  const reload = useCallback(async () => {
    try {
      setData(await loadRef.current());
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void reload();
    const t = setInterval(() => void reload(), ms);
    return () => clearInterval(t);
  }, [reload, ms, enabled]);

  return { data, error, reload };
}

export function useToast(): { toast: ReactNode; flash: (message: string) => void } {
  const [message, setMessage] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const flash = useCallback((m: string) => {
    setMessage(m);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(''), 2600);
  }, []);
  return { toast: message ? <div className="toast" role="status">{message}</div> : null, flash };
}
