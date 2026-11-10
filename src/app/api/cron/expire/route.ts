import { createHash, timingSafeEqual } from 'node:crypto';
import { withApi } from '@/server/auth/guard';
import { nowFn } from '@/server/clock';
import { getDb } from '@/server/db/client';
import { companies } from '@/server/db/schema';
import { expireCompany } from '@/server/runAction';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const digest = (s: string) => createHash('sha256').update(s).digest();

/** `Authorization: Bearer <secret>`, compared in constant time (hashing first hides the length too). */
function authorized(req: Request, secret: string): boolean {
  const header = req.headers.get('authorization') ?? '';
  const given = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  return timingSafeEqual(digest(given), digest(secret));
}

/**
 * Scheduled expiry (Vercel Cron or Supabase pg_cron + pg_net): expire overdue sub requests of every company.
 * Requests are also expired inside every write, so this only keeps screens current when nobody acts.
 * CRON_SECRET unset → 503 CRON_DISABLED; wrong or missing bearer → 401. Returns how many companies changed.
 */
export const GET = withApi(async (req) => {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ error: 'CRON_DISABLED' }, { status: 503 });
  if (!authorized(req, secret)) return Response.json({ error: 'UNAUTHENTICATED' }, { status: 401 });

  const db = await getDb();
  const now = nowFn();
  let expired = 0;
  for (const { id } of await db.select({ id: companies.id }).from(companies)) {
    if (await expireCompany(id, { now })) expired += 1;
  }
  return Response.json({ expired });
});
