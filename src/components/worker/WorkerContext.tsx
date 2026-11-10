'use client';

import { createContext, useContext } from 'react';
import type { DictKey, Lang, Params } from '@/i18n';
import type { WorkerView } from '@/server/views/workerView';

export type WorkerCtx = {
  lang: Lang;
  t: (key: DictKey, params?: Params) => string;
  chooseLang: (lang: Lang) => void;
  /** Null until loaded (and always on /w/login and /w/pin). */
  view: WorkerView | null;
  reload: () => Promise<void>;
};

export const WorkerContext = createContext<WorkerCtx | null>(null);

export function useWorker(): WorkerCtx {
  const ctx = useContext(WorkerContext);
  if (!ctx) throw new Error('useWorker outside /w layout');
  return ctx;
}
