import { requireSession, withApi } from '@/server/auth/guard';
import { nowFn } from '@/server/clock';
import { expireCompany, getRev, hasOverdueRequests } from '@/server/runAction';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Every screen polls this. Overdue sub requests are expired here too (spec §0.1-8, §3.9.6), so expiry never
 * waits for the next write or the cron: a cheap indexed EXISTS first, the locking transaction only when needed.
 */
export const GET = withApi(async (req) => {
  const s = await requireSession(req);
  const now = nowFn();
  if (await hasOverdueRequests(s.companyId, now)) await expireCompany(s.companyId, { now });
  return Response.json({ rev: await getRev(s.companyId) });
});
