import { okWithRev, readBody } from '@/server/admin/common';
import { AccountBody, accountAction, listWorkerAccounts } from '@/server/admin/persons';
import { requireAdmin, withApi } from '@/server/auth/guard';
import { getDb } from '@/server/db/client';
import { withCompanyTx } from '@/server/runAction';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withApi(async (req) => {
  const s = await requireAdmin(req);
  const db = await getDb();
  return Response.json({ accounts: await listWorkerAccounts(db, s.companyId) });
});

export const POST = withApi(async (req) => {
  const s = await requireAdmin(req);
  const body = AccountBody.parse(await readBody(req));
  await withCompanyTx(s.companyId, (tx) => accountAction(tx, s.companyId, body));
  return okWithRev(s.companyId);
});
