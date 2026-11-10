'use client';

import { createContext, useContext } from 'react';
import type { factories } from '@/server/db/schema';
import type { BoardView } from '@/server/views/boardView';
import type { BoardAction } from './logic';

export type FactoryRow = typeof factories.$inferSelect;

export type BoardCtx = {
  view: BoardView;
  factories: FactoryRow[];
  /**
   * POSTs the actions in order for this board's slot (stops at the first error, which is toasted), then refetches.
   * `key` names the clicked control so it can be disabled while in flight. Resolves true when every action succeeded.
   */
  run: (key: string, ...actions: BoardAction[]) => Promise<boolean>;
  busy: (key: string) => boolean;
  /** Open the absence panel, scrolled to this absence. */
  showAbsence: (absenceId: string) => void;
};

export const BoardContext = createContext<BoardCtx | null>(null);

export function useBoard(): BoardCtx {
  const ctx = useContext(BoardContext);
  if (!ctx) throw new Error('useBoard outside the board page');
  return ctx;
}
