import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { expireRequests } from '@/engine/absence';
import { seoulDate } from '@/engine/time';
import { EngineError, type Changes, type Ctx, type DateStr, type Snapshot } from '@/engine/types';
import { getDb, type DB, type Tx } from './db/client';
import { companies } from './db/schema';
import { applyChanges } from './repo/apply';
import { loadSnapshot } from './repo/snapshot';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ActionFn<T> = (snap: Snapshot, ctx: Ctx) => { changes: Changes; result?: T } | Changes;
export type RunOpts = { db?: DB; now?: Date };

/**
 * One write action in one transaction: lock the company row (serializes all writes of a company, which
 * also guarantees first-accept-wins for sub requests) → expire overdue requests → reload snapshot → fn →
 * apply → rev + 1. Any throw (EngineError included) rolls everything back and propagates unchanged.
 */
export async function runAction<T>(
  companyId: string,
  around: DateStr,
  fn: ActionFn<T>,
  opts: RunOpts = {},
): Promise<T | undefined> {
  const { result } = await inTransaction(companyId, around, opts, async (tx, snap, ctx) => {
    const out = fn(snap, ctx);
    const { changes, result } = 'changes' in out ? out : { changes: out, result: undefined };
    await applyChanges(tx, companyId, changes, ctx.now);
    return { bump: true, result };
  });
  return result;
}

/**
 * A company-scoped write that bypasses the engine (admin CRUD): lock the company row, run fn, rev + 1.
 * Any throw rolls the whole transaction back and propagates unchanged.
 */
export async function withCompanyTx<T>(
  companyId: string,
  fn: (tx: Tx) => Promise<T>,
  opts: { db?: DB } = {},
): Promise<T> {
  assertCompanyId(companyId);
  const db = opts.db ?? (await getDb());
  return db.transaction(async (tx) => {
    const locked = await tx.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId)).for('update');
    if (locked.length === 0) throw new EngineError('BAD_INPUT', `unknown company ${companyId}`);
    const out = await fn(tx);
    await tx.update(companies).set({ rev: sql`${companies.rev} + 1` }).where(eq(companies.id, companyId));
    return out;
  });
}

/** Expire overdue sub requests. Bumps rev only when something expired; returns whether it did. */
export async function expireCompany(companyId: string, opts: RunOpts = {}): Promise<boolean> {
  const now = opts.now ?? new Date();
  const { expired } = await inTransaction(companyId, seoulDate(now), { ...opts, now }, async () => ({
    bump: false,
    result: undefined,
  }));
  return expired;
}

export async function getRev(companyId: string, opts: { db?: DB } = {}): Promise<number> {
  assertCompanyId(companyId);
  const db = opts.db ?? (await getDb());
  const [row] = await db.select({ rev: companies.rev }).from(companies).where(eq(companies.id, companyId));
  if (!row) throw new EngineError('BAD_INPUT', `unknown company ${companyId}`);
  return row.rev;
}

async function inTransaction<T>(
  companyId: string,
  around: DateStr,
  opts: RunOpts,
  body: (tx: Tx, snap: Snapshot, ctx: Ctx) => Promise<{ bump: boolean; result: T }>,
): Promise<{ result: T; expired: boolean }> {
  assertCompanyId(companyId);
  const db = opts.db ?? (await getDb());
  const ctx: Ctx = { now: opts.now ?? new Date(), newId: () => randomUUID() };
  return db.transaction(async (tx) => {
    const locked = await tx
      .select({ id: companies.id })
      .from(companies)
      .where(eq(companies.id, companyId))
      .for('update');
    if (locked.length === 0) throw new EngineError('BAD_INPUT', `unknown company ${companyId}`);

    let snap = await loadSnapshot(tx, companyId, around);
    const expiry = expireRequests(snap, ctx);
    const expired = hasChanges(expiry);
    if (expired) {
      await applyChanges(tx, companyId, expiry, ctx.now);
      snap = await loadSnapshot(tx, companyId, around);
    }

    const { bump, result } = await body(tx, snap, ctx);
    if (bump || expired) {
      await tx
        .update(companies)
        .set({ rev: sql`${companies.rev} + 1` })
        .where(eq(companies.id, companyId));
    }
    return { result, expired };
  });
}

/** Non-uuid ids would reach Postgres as a raw cast error (22P02); reject them as BAD_INPUT instead. */
function assertCompanyId(companyId: string): void {
  if (!UUID.test(companyId)) throw new EngineError('BAD_INPUT', `unknown company ${companyId}`);
}

function hasChanges(c: Changes): boolean {
  return (
    c.messages.length > 0 ||
    Object.values(c.upsert).some((rows) => rows.length > 0) ||
    Object.values(c.remove).some((ids) => ids.length > 0)
  );
}
