'use client';

import { useEffect, useRef } from 'react';

const INTERVAL_MS = 4_000;
/** A hung /api/rev is aborted after this long so the in-flight guard is released and polling goes on. */
const TIMEOUT_MS = 8_000;

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
    let inFlight = false;

    const poll = async () => {
      if (inFlight) return; // the previous request is still pending: skip this tick instead of stacking fetches
      inFlight = true;
      try {
        const res = await fetch('/api/rev', { cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) });
        if (!res.ok || !alive) return;
        const { rev } = (await res.json()) as { rev: number };
        if (!alive) return;
        if (last !== null && rev !== last) callback.current();
        last = rev;
      } catch {
        /* offline or timed out: try again next tick */
      } finally {
        inFlight = false;
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
