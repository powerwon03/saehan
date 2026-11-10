import { z } from 'zod';
import { mapUnique, okWithRev, readBody } from '@/server/admin/common';
import { CreatePerson, createPerson, listPersons } from '@/server/admin/persons';
import { requireAdmin, withApi } from '@/server/auth/guard';
import { getDb } from '@/server/db/client';
import { withCompanyTx } from '@/server/runAction';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Query = z.object({ q: z.string().max(100).optional(), active: z.enum(['true', 'false', 'all']).default('true') });

export const GET = withApi(async (req) => {
  const s = await requireAdmin(req);
  const q = Query.parse(Object.fromEntries(new URL(req.url).searchParams));
  const db = await getDb();
  return Response.json({ persons: await listPersons(db, s.companyId, q) });
});

export const POST = withApi(async (req) => {
  const s = await requireAdmin(req);
  const body = CreatePerson.parse(await readBody(req));
  const person = await mapUnique(() => withCompanyTx(s.companyId, (tx) => createPerson(tx, s.companyId, body)));
  return okWithRev(s.companyId, { person });
});
