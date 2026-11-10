import { okWithRev, readBody } from '@/server/admin/common';
import { SkillBody, setSkill } from '@/server/admin/persons';
import { requireAdmin, withApi } from '@/server/auth/guard';
import { withCompanyTx } from '@/server/runAction';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withApi(async (req) => {
  const s = await requireAdmin(req);
  const body = SkillBody.parse(await readBody(req));
  await withCompanyTx(s.companyId, (tx) => setSkill(tx, s.companyId, body));
  return okWithRev(s.companyId);
});
