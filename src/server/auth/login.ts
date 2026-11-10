import { and, count, desc, eq, gt, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { strongEnough } from '@/lib/personRules';
import type { Executor } from '@/server/db/client';
import { accounts, companies, loginFailures, persons } from '@/server/db/schema';
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
/** `wrong`: this attempt verified a wrong secret (the 5th one, which locks the account). */
type Attempt = { result: 'OK' } | { result: 'WRONG' } | { result: 'LOCKED'; lockedUntil?: Date; wrong?: boolean };

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
    if (count === MAX_FAILS) return { result: 'LOCKED', lockedUntil: await lockNow(db, acc.id, now), wrong: true };
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

/**
 * Company-wide spray window (R41). Every failed worker login (wrong PIN or unknown 사번) leaves a login_failures row.
 * While a company has SPRAY_LIMIT failures in the last SPRAY_WINDOW_MS, logins to accounts still on their initial PIN
 * (must_change) and to unknown 사번 are refused as LOCKED without verifying; activated workers and admins are unaffected.
 */
const SPRAY_LIMIT = 20;
const SPRAY_WINDOW_MS = 10 * 60_000;
const SPRAY_KEEP_MS = 60 * 60_000;

/** Record one failure (and prune this company's rows older than an hour). Returns the row id. */
async function recordFailure(db: Executor, companyId: string, now: Date): Promise<string> {
  await db.delete(loginFailures).where(and(eq(loginFailures.companyId, companyId), lt(loginFailures.at, new Date(now.getTime() - SPRAY_KEEP_MS))));
  const [row] = await db.insert(loginFailures).values({ companyId, at: now }).returning({ id: loginFailures.id });
  return row.id;
}

const forgetFailure = async (db: Executor, id: string): Promise<void> => {
  await db.delete(loginFailures).where(eq(loginFailures.id, id));
};

/**
 * Reserve a failure row BEFORE verifying (kept if the attempt fails, removed if it succeeds or never verifies). Check
 * and insert run in one transaction holding the company row lock, so parallel guesses are counted one by one: at most
 * SPRAY_LIMIT rows (failures plus attempts in flight) ever exist in the window, and the next attempt is refused.
 */
async function reserveSprayAttempt(db: Executor, companyId: string, now: Date): Promise<{ ok: true; id: string } | { ok: false; lockedUntil: Date }> {
  return db.transaction(async (tx) => {
    await tx.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId)).for('update');
    const inWindow = and(eq(loginFailures.companyId, companyId), gt(loginFailures.at, new Date(now.getTime() - SPRAY_WINDOW_MS)), lte(loginFailures.at, now));
    const [{ n }] = await tx.select({ n: count() }).from(loginFailures).where(inWindow);
    if (n < SPRAY_LIMIT) return { ok: true as const, id: await recordFailure(tx, companyId, now) };
    // the window opens again when the SPRAY_LIMIT-th most recent failure leaves it
    const [edge] = await tx.select({ at: loginFailures.at }).from(loginFailures).where(inWindow).orderBy(desc(loginFailures.at)).offset(SPRAY_LIMIT - 1).limit(1);
    return { ok: false as const, lockedUntil: new Date((edge?.at ?? now).getTime() + SPRAY_WINDOW_MS) };
  });
}

async function workerLogin(db: Executor, input: LoginInput, now: Date): Promise<LoginResult> {
  const [company] = await db.select({ id: companies.id }).from(companies).where(eq(companies.code, input.companyCode));
  if (!company) {
    await burn(input.secret);
    return { ok: false, code: 'INVALID' };
  }
  const [row] = await db
    .select({ account: accounts, personActive: persons.active })
    .from(accounts)
    .leftJoin(persons, eq(persons.id, accounts.personId))
    .where(and(eq(accounts.companyId, company.id), eq(accounts.kind, 'worker'), eq(accounts.loginId, input.loginId)));
  const acc = row && row.personActive === true ? row.account : null;

  if (!acc || acc.mustChange) {
    const gate = await reserveSprayAttempt(db, company.id, now);
    if (!gate.ok) return { ok: false, code: 'LOCKED', lockedUntil: gate.lockedUntil };
    if (!acc) {
      await burn(input.secret);
      return { ok: false, code: 'INVALID' }; // the reserved row stays: an unknown 사번 is a failure
    }
    const r = await attempt(db, acc, input.secret, now);
    if (r.result === 'OK' || (r.result === 'LOCKED' && !r.wrong)) await forgetFailure(db, gate.id);
    return outcome(acc, r, now);
  }

  const r = await attempt(db, acc, input.secret, now);
  if (r.result === 'WRONG' || (r.result === 'LOCKED' && r.wrong)) await recordFailure(db, company.id, now);
  return outcome(acc, r, now);
}

export async function login(db: Executor, input: LoginInput): Promise<LoginResult> {
  const now = input.now ?? new Date();
  if (input.kind === 'worker') return workerLogin(db, input, now);
  const [row] = await db
    .select({ account: accounts })
    .from(companies)
    .innerJoin(
      accounts,
      and(eq(accounts.companyId, companies.id), eq(accounts.kind, input.kind), eq(accounts.loginId, input.loginId)),
    )
    .where(eq(companies.code, input.companyCode));

  if (!row) {
    await burn(input.secret);
    return { ok: false, code: 'INVALID' };
  }
  return outcome(row.account, await attempt(db, row.account, input.secret, now), now);
}

function outcome(acc: Acc, r: Attempt, now: Date): LoginResult {
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

export { strongEnough };

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
