import { requireSession, withApi } from '@/server/auth/guard';
import { getRev } from '@/server/runAction';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withApi(async (req) => {
  const s = await requireSession(req);
  return Response.json({ rev: await getRev(s.companyId) });
});
