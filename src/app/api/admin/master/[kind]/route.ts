import { id, mapUnique, okWithRev, readBody } from '@/server/admin/common';
import { Kind, createMaster, createSchema, deleteMaster, listMaster, patchSchema, updateMaster } from '@/server/admin/master';
import { requireAdmin, withApi } from '@/server/auth/guard';
import { getDb } from '@/server/db/client';
import { withCompanyTx } from '@/server/runAction';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ kind: string }> };
const kindOf = async (c: Ctx) => Kind.parse((await c.params).kind);

export const GET = withApi(async (req, ctx: Ctx) => {
  const s = await requireAdmin(req);
  const kind = await kindOf(ctx);
  const db = await getDb();
  return Response.json({ rows: await listMaster(db, s.companyId, kind) });
});

export const POST = withApi(async (req, ctx: Ctx) => {
  const s = await requireAdmin(req);
  const kind = await kindOf(ctx);
  const body = createSchema(kind).parse(await readBody(req));
  const row = await mapUnique(() => withCompanyTx(s.companyId, (tx) => createMaster(tx, s.companyId, kind, body)));
  return okWithRev(s.companyId, { row });
});

export const PATCH = withApi(async (req, ctx: Ctx) => {
  const s = await requireAdmin(req);
  const kind = await kindOf(ctx);
  const { id: rowId, ...patch } = patchSchema(kind).parse(await readBody(req));
  const row = await mapUnique(() => withCompanyTx(s.companyId, (tx) => updateMaster(tx, s.companyId, kind, rowId, patch)));
  return okWithRev(s.companyId, { row });
});

export const DELETE = withApi(async (req, ctx: Ctx) => {
  const s = await requireAdmin(req);
  const kind = await kindOf(ctx);
  const rowId = id.parse(new URL(req.url).searchParams.get('id'));
  const r = await withCompanyTx(s.companyId, (tx) => deleteMaster(tx, s.companyId, kind, rowId));
  return okWithRev(s.companyId, r.softDeleted ? { softDeleted: true } : {});
});
