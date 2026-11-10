'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRevPoll } from '@/hooks/useRevPoll';
import { api } from '@/lib/api';

/**
 * GET `path` for an admin screen: data (null while the first load runs), the error code of a failed load, and
 * reload. 401 goes to /login. With `poll`, refetches whenever the company revision changes (other admins, workers).
 * `path` null = nothing to load yet.
 */
export function useAdminData<T>(path: string | null, poll = true): { data: T | null; failed: string | null; reload: () => Promise<void> } {
  const router = useRouter();
  const [data, setData] = useState<T | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const seq = useRef(0);

  const reload = useCallback(async () => {
    if (!path) return;
    const mine = ++seq.current;
    const r = await api<T>(path);
    if (mine !== seq.current) return; // a newer load (other tab/filter) superseded this one
    if (r.ok) {
      setData(r.data);
      setFailed(null);
    } else if (r.status === 401) router.replace('/login');
    else setFailed(r.code);
  }, [path, router]);

  useEffect(() => {
    void reload(); // a new path keeps showing the previous data until its own arrives (no flash while typing)
  }, [reload]);
  useRevPoll(reload, poll && data !== null);

  return { data, failed, reload };
}
