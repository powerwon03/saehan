import { and, eq, isNull, lte, or, sql } from 'drizzle-orm';
import type { Executor } from '@/server/db/client';
import { accounts, companies, persons } from '@/server/db/schema';
import { hashSecret, verifySecret } from './hash';
import type { Session } from './session';

const MAX_FAILS = 5;
const LOCK_MS = 10 * 60_000;
const SESSION_MS = 30 * 24 * 60 * 60_000;

export type LoginInput = { companyCode: string; kind: 'admin' | 'worker'; loginId: string; secret: string; now?: Date };
export type LoginResult =
  | { ok: true; session: Session; mustChange: boolean }
  | { ok: false; code: 'INVALID' | 'LOCKED'; lockedUntil?: Date };

/** Precomputed at load; verified against when no real account exists so unknown accounts cost the same time. */
const DUMMY_HASH = hashSecret('dummy-secret-for-timing');
async function burn(secret: string): Promise<void> {
  await verifySecret(secret, await DUMMY_HASH);
}

type Acc = typeof accounts.$inferSelect;
type Attempt = { result: 'OK' } | { result: 'WRONG' } | { result: 'LOCKED'; lockedUntil?: Date };

async function lockNow(db: Executor, id: string, now: Date): Promise<Date> {
  const lockedUntil = new Date(now.getTime() + LOCK_MS);
  await db.update(accounts).set({ failedCount: 0, lockedUntil }).where(eq(accounts.id, id));
  return lockedUntil;
}

async function currentLock(db: Executor, id: string): Promise<Date | undefined> {
  const [r] = await db.select({ l: accounts.lockedUntil }).from(accounts).where(eq(accounts.id, id));
  return r?.l ?? undefined;
}

/**
 * Brute-force-safe secret check. The attempt is reserved atomically (failed_count + 1, only while not locked)
 * BEFORE the slow verification, so parallel guesses cannot lose increments and a late success cannot clear a lock.
 */
async function attempt(db: Executor, acc: Acc, secret: string, now: Date): Promise<Attempt> {
  const unlocked = or(isNull(accounts.lockedUntil), lte(accounts.lockedUntil, now));
  const reserved = await db
    .update(accounts)
    .set({ failedCount: sql`${accounts.failedCount} + 1` })
    .where(and(eq(accounts.id, acc.id), unlocked))
    .returning({ failedCount: accounts.failedCount });
  if (reserved.length === 0) return { result: 'LOCKED', lockedUntil: await currentLock(db, acc.id) };
  const count = reserved[0].failedCount;
  if (count > MAX_FAILS) return { result: 'LOCKED', lockedUntil: await lockNow(db, acc.id, now) };

  if (!(await verifySecret(secret, acc.secretHash))) {
    if (count === MAX_FAILS) return { result: 'LOCKED', lockedUntil: await lockNow(db, acc.id, now) };
    return { result: 'WRONG' };
  }
  const reset = await db
    .update(accounts)
    .set({ failedCount: 0, lockedUntil: null, lastLoginAt: now })
    .where(and(eq(accounts.id, acc.id), unlocked))
    .returning({ id: accounts.id });
  if (reset.length === 0) return { result: 'LOCKED', lockedUntil: await currentLock(db, acc.id) };
  return { result: 'OK' };
}

export async function login(db: Executor, input: LoginInput): Promise<LoginResult> {
  const now = input.now ?? new Date();
  const [row] = await db
    .select({ account: accounts, personActive: persons.active })
    .from(companies)
    .innerJoin(
      accounts,
      and(eq(accounts.companyId, companies.id), eq(accounts.kind, input.kind), eq(accounts.loginId, input.loginId)),
    )
    .leftJoin(persons, eq(persons.id, accounts.personId))
    .where(eq(companies.code, input.companyCode));

  if (!row || (input.kind === 'worker' && row.personActive !== true)) {
    await burn(input.secret);
    return { ok: false, code: 'INVALID' };
  }
  const acc = row.account;
  const r = await attempt(db, acc, input.secret, now);
  if (r.result === 'LOCKED') return { ok: false, code: 'LOCKED', lockedUntil: r.lockedUntil };
  if (r.result === 'WRONG') return { ok: false, code: 'INVALID' };
  return {
    ok: true,
    mustChange: acc.mustChange,
    session: {
      accountId: acc.id,
      companyId: acc.companyId,
      kind: acc.kind,
      personId: acc.personId,
      exp: now.getTime() + SESSION_MS,
    },
  };
}

function strongEnough(kind: 'admin' | 'worker', next: string): boolean {
  if (kind === 'admin') return next.length >= 8;
  if (!/^\d{6}$/.test(next)) return false;
  if (/^(\d)\1{5}$/.test(next)) return false;
  return next !== '123456' && next !== '654321';
}

export async function changeSecret(
  db: Executor,
  session: Session,
  input: { current: string; next: string },
): Promise<{ ok: true } | { ok: false; code: 'INVALID' | 'WEAK_SECRET' | 'LOCKED'; lockedUntil?: Date }> {
  const [acc] = await db.select().from(accounts).where(eq(accounts.id, session.accountId));
  if (!acc || acc.companyId !== session.companyId) return { ok: false, code: 'INVALID' };
  const r = await attempt(db, acc, input.current, new Date());
  if (r.result === 'LOCKED') return { ok: false, code: 'LOCKED', lockedUntil: r.lockedUntil };
  if (r.result === 'WRONG') return { ok: false, code: 'INVALID' };
  if (!strongEnough(acc.kind, input.next)) return { ok: false, code: 'WEAK_SECRET' };
  await db
    .update(accounts)
    .set({ secretHash: await hashSecret(input.next), mustChange: false })
    .where(eq(accounts.id, acc.id));
  return { ok: true };
}
