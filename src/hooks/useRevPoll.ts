'use client';

import { useEffect, useRef } from 'react';

const INTERVAL_MS = 4_000;

/**
 * Polls GET /api/rev every 4 s while the tab is visible (stops when hidden, checks at once when shown again)
 * and calls `onChange` whenever the company revision differs from the last one seen.
 */
export function useRevPoll(onChange: () => void, enabled = true): void {
  const callback = useRef(onChange);
  callback.current = onChange;

  useEffect(() => {
    if (!enabled) return;
    let last: number | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let alive = true;

    const poll = async () => {
      try {
        const res = await fetch('/api/rev', { cache: 'no-store' });
        if (!res.ok || !alive) return;
        const { rev } = (await res.json()) as { rev: number };
        if (last !== null && rev !== last) callback.current();
        last = rev;
      } catch {
        /* offline: try again next tick */
      }
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const start = () => {
      stop();
      void poll();
      timer = setInterval(poll, INTERVAL_MS);
    };
    const onVisibility = () => (document.visibilityState === 'visible' ? start() : stop());

    onVisibility();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      alive = false;
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled]);
}
