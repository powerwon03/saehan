import { api } from '@/lib/api';

/** POST /api/worker with one action. */
export const workerAction = <T = { ok: true; rev: number }>(action: { type: string } & Record<string, unknown>) =>
  api<T>('/api/worker', action);
