import { z } from 'zod';
import { EngineError } from '@/engine/types';
import { getRev } from '@/server/runAction';

export const id = z.string().uuid();
export const dateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => new Date(`${s}T00:00:00Z`).toISOString().startsWith(s));

/** Postgres unique_violation (23505), directly or wrapped as `cause` by the driver/ORM. */
export function isUniqueViolation(e: unknown): boolean {
  let cur: unknown = e;
  for (let i = 0; i < 3 && cur && typeof cur === 'object'; i++) {
    if ((cur as { code?: unknown }).code === '23505') return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

/** Run a write; a unique violation that slipped past the pre-check becomes DUPLICATE_CODE. */
export async function mapUnique<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (isUniqueViolation(e)) throw new EngineError('DUPLICATE_CODE');
    throw e;
  }
}

export async function readBody(req: Request): Promise<unknown> {
  return req.json().catch(() => null);
}

/** `{ ok: true, ...extra, rev }` with the post-write company rev. */
export async function okWithRev(companyId: string, extra: Record<string, unknown> = {}): Promise<Response> {
  return Response.json({ ok: true, ...extra, rev: await getRev(companyId) });
}
