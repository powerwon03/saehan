import type { Executor } from '@/server/db/client';
import { accounts } from '@/server/db/schema';
import { hashSecret } from './hash';

export type NewAccount = {
  companyId: string;
  kind: 'admin' | 'worker';
  loginId: string;
  secret: string;
  personId?: string | null;
  mustChange?: boolean;
};

/** Insert an account with a scrypt-hashed secret. Does not validate secret strength (callers decide). */
export async function createAccount(db: Executor, a: NewAccount): Promise<{ id: string }> {
  const [row] = await db
    .insert(accounts)
    .values({
      companyId: a.companyId,
      kind: a.kind,
      loginId: a.loginId,
      personId: a.personId ?? null,
      secretHash: await hashSecret(a.secret),
      mustChange: a.mustChange ?? false,
    })
    .returning({ id: accounts.id });
  return row;
}
