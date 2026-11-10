'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useRevPoll } from '@/hooks/useRevPoll';

type Subscribe = (onChange: () => void) => () => void;

const RevContext = createContext<Subscribe | null>(null);

/**
 * One GET /api/rev poller for the whole admin page: every `useRevChange` subscriber is told when the company
 * revision changes. It polls only while at least one subscriber is enabled.
 */
export function RevProvider({ children }: { children: ReactNode }) {
  const subscribers = useRef(new Set<() => void>());
  const [count, setCount] = useState(0);

  const subscribe = useCallback<Subscribe>((onChange) => {
    subscribers.current.add(onChange);
    setCount(subscribers.current.size);
    return () => {
      subscribers.current.delete(onChange);
      setCount(subscribers.current.size);
    };
  }, []);

  useRevPoll(() => {
    for (const onChange of [...subscribers.current]) onChange();
  }, count > 0);

  return <RevContext.Provider value={subscribe}>{children}</RevContext.Provider>;
}

/** Calls `onChange` whenever the company revision changes (shared poller of the admin layout). */
export function useRevChange(onChange: () => void, enabled = true): void {
  const subscribe = useContext(RevContext);
  if (!subscribe) throw new Error('useRevChange needs <RevProvider> (admin layout)');
  const callback = useRef(onChange);
  callback.current = onChange;

  useEffect(() => {
    if (!enabled) return;
    return subscribe(() => callback.current());
  }, [enabled, subscribe]);
}
