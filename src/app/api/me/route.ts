import { eq } from 'drizzle-orm';
import { requireSession, withApi } from '@/server/auth/guard';
import { getDb } from '@/server/db/client';
import { accounts, companies, persons } from '@/server/db/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withApi(async (req) => {
  const s = await requireSession(req);
  const db = await getDb();
  const [row] = await db
    .select({
      loginId: accounts.loginId,
      mustChange: accounts.mustChange,
      companyName: companies.name,
      personName: persons.name,
      empNo: persons.empNo,
    })
    .from(accounts)
    .innerJoin(companies, eq(companies.id, accounts.companyId))
    .leftJoin(persons, eq(persons.id, accounts.personId))
    .where(eq(accounts.id, s.accountId));
  if (!row) return Response.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  return Response.json({
    kind: s.kind,
    name: s.kind === 'admin' ? row.loginId : (row.personName ?? row.loginId),
    empNo: s.kind === 'worker' ? row.empNo : null,
    companyName: row.companyName,
    mustChange: row.mustChange,
  });
});
