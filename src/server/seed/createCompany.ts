import { eq } from 'drizzle-orm';
import { EngineError } from '@/engine/types';
import { isUniqueViolation } from '@/server/admin/common';
import { createAccount } from '@/server/auth/accounts';
import { strongEnough } from '@/server/auth/login';
import type { Executor } from '@/server/db/client';
import { companies, settings } from '@/server/db/schema';
import { DEFAULT_SETTINGS } from './defaults';

export const COMPANY_CODE = /^[a-z0-9-]{2,32}$/;

export type NewCompany = { code: string; name: string; adminId: string; adminPassword: string };

/** Company row + default settings + admin account in one transaction. No factories (the admin creates them). */
export async function createCompany(db: Executor, input: NewCompany): Promise<{ companyId: string }> {
  const { code, name, adminId, adminPassword } = input;
  if (!COMPANY_CODE.test(code) || name.trim() === '' || adminId.trim() === '') throw new EngineError('BAD_INPUT');
  if (!strongEnough('admin', adminPassword)) throw new EngineError('WEAK_SECRET');
  try {
    return await db.transaction(async (tx) => {
      const [dup] = await tx.select({ id: companies.id }).from(companies).where(eq(companies.code, code));
      if (dup) throw new EngineError('DUPLICATE_CODE');
      const [company] = await tx.insert(companies).values({ code, name }).returning({ id: companies.id });
      await tx.insert(settings).values({ companyId: company.id, ...DEFAULT_SETTINGS });
      await createAccount(tx, {
        companyId: company.id,
        kind: 'admin',
        loginId: adminId,
        secret: adminPassword,
        mustChange: false,
      });
      return { companyId: company.id };
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new EngineError('DUPLICATE_CODE');
    throw e;
  }
}
