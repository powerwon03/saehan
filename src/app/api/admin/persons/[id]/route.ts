import { seoulDate } from '@/engine/time';
import { id, mapUnique, okWithRev, readBody } from '@/server/admin/common';
import { PatchPerson, PersonAction, deletePerson, rehirePerson, retirePerson, updatePerson } from '@/server/admin/persons';
import { requireAdmin, withApi } from '@/server/auth/guard';
import { nowFn } from '@/server/clock';
import { withCompanyTx } from '@/server/runAction';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = withApi(async (req, { params }: Ctx) => {
  const s = await requireAdmin(req);
  const personId = id.parse((await params).id);
  const patch = PatchPerson.parse(await readBody(req));
  const person = await mapUnique(() => withCompanyTx(s.companyId, (tx) => updatePerson(tx, s.companyId, personId, patch)));
  return okWithRev(s.companyId, { person });
});

export const POST = withApi(async (req, { params }: Ctx) => {
  const s = await requireAdmin(req);
  const personId = id.parse((await params).id);
  const body = PersonAction.parse(await readBody(req));
  const now = nowFn();
  await withCompanyTx(s.companyId, (tx) =>
    body.action === 'retire'
      ? retirePerson(tx, s.companyId, personId, body.date ?? seoulDate(now), now)
      : rehirePerson(tx, s.companyId, personId),
  );
  return okWithRev(s.companyId);
});

export const DELETE = withApi(async (req, { params }: Ctx) => {
  const s = await requireAdmin(req);
  const personId = id.parse((await params).id);
  await withCompanyTx(s.companyId, (tx) => deletePerson(tx, s.companyId, personId));
  return okWithRev(s.companyId);
});
