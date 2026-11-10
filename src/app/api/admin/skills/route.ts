import { z } from 'zod';
import { seoulDate } from '@/engine/time';
import { id, okWithRev, readBody } from '@/server/admin/common';
import { SkillBody, setSkill } from '@/server/admin/persons';
import { skillGrid } from '@/server/admin/skillGrid';
import { requireAdmin, withApi } from '@/server/auth/guard';
import { nowFn } from '@/server/clock';
import { getDb } from '@/server/db/client';
import { loadSnapshot } from '@/server/repo/snapshot';
import { withCompanyTx } from '@/server/runAction';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Query = z.object({ factoryId: id });

/** 숙련도 표 of one factory of the session's company (a foreign or unknown factory → BAD_INPUT). */
export const GET = withApi(async (req) => {
  const s = await requireAdmin(req);
  const { factoryId } = Query.parse(Object.fromEntries(new URL(req.url).searchParams));
  const snap = await loadSnapshot(await getDb(), s.companyId, seoulDate(nowFn()));
  return Response.json(skillGrid(snap, factoryId));
});

export const POST = withApi(async (req) => {
  const s = await requireAdmin(req);
  const body = SkillBody.parse(await readBody(req));
  await withCompanyTx(s.companyId, (tx) => setSkill(tx, s.companyId, body));
  return okWithRev(s.companyId);
});
