import { and, eq } from 'drizzle-orm';
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

let dummyHash: Promise<string> | undefined;
/** Verified against when no real account exists, so unknown accounts cost the same time as wrong passwords. */
async function burn(secret: string): Promise<void> {
  dummyHash ??= hashSecret('dummy-secret-for-timing');
  await verifySecret(secret, await dummyHash);
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
  if (acc.lockedUntil && acc.lockedUntil > now) return { ok: false, code: 'LOCKED', lockedUntil: acc.lockedUntil };

  if (!(await verifySecret(input.secret, acc.secretHash))) {
    const failed = acc.failedCount + 1;
    if (failed >= MAX_FAILS) {
      const lockedUntil = new Date(now.getTime() + LOCK_MS);
      await db.update(accounts).set({ failedCount: 0, lockedUntil }).where(eq(accounts.id, acc.id));
      return { ok: false, code: 'LOCKED', lockedUntil };
    }
    await db.update(accounts).set({ failedCount: failed }).where(eq(accounts.id, acc.id));
    return { ok: false, code: 'INVALID' };
  }

  await db.update(accounts).set({ failedCount: 0, lockedUntil: null, lastLoginAt: now }).where(eq(accounts.id, acc.id));
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
): Promise<{ ok: true } | { ok: false; code: 'INVALID' | 'WEAK_SECRET' }> {
  const [acc] = await db.select().from(accounts).where(eq(accounts.id, session.accountId));
  if (!acc || acc.companyId !== session.companyId || !(await verifySecret(input.current, acc.secretHash)))
    return { ok: false, code: 'INVALID' };
  if (!strongEnough(acc.kind, input.next)) return { ok: false, code: 'WEAK_SECRET' };
  await db
    .update(accounts)
    .set({ secretHash: await hashSecret(input.next), mustChange: false })
    .where(eq(accounts.id, acc.id));
  return { ok: true };
}
