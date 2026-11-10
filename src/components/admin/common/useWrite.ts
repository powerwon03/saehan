'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import type { ApiResult } from '@/lib/api';
import { errorText } from '../labels';
import { useToast } from '../Toast';

/** Runs a write (busy + refetch); `quiet` = the caller shows the error itself. */
export type RunWrite = <T>(key: string, call: () => Promise<ApiResult<T>>, opts?: { quiet?: boolean }) => Promise<ApiResult<T>>;

/**
 * Runs one write for an admin screen: marks `key` busy while in flight, toasts a failure (unless `quiet`: the
 * caller shows it inline), sends 401 to /login, and always refetches afterwards. Resolves with the API result.
 */
export function useWrite(reload: () => Promise<void>) {
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());

  const run: RunWrite = useCallback(
    async <T>(key: string, call: () => Promise<ApiResult<T>>, opts: { quiet?: boolean } = {}): Promise<ApiResult<T>> => {
      setPending((s) => new Set(s).add(key));
      const r = await call();
      if (!r.ok) {
        if (r.status === 401) router.replace('/login');
        else if (!opts.quiet) toast(errorText(r.code));
      }
      await reload();
      setPending((s) => {
        const next = new Set(s);
        next.delete(key);
        return next;
      });
      return r;
    },
    [reload, router, toast],
  );

  return { run, busy: (key: string) => pending.has(key), anyBusy: pending.size > 0 };
}
