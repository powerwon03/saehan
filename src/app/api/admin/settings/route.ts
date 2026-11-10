import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { EngineError } from '@/engine/types';
import { okWithRev, readBody } from '@/server/admin/common';
import { requireAdmin, withApi } from '@/server/auth/guard';
import { getDb } from '@/server/db/client';
import { settings } from '@/server/db/schema';
import { withCompanyTx } from '@/server/runAction';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const weight = z.number().finite().min(0);
const rate = z.number().min(0).max(1);

const Body = z
  .object({
    shiftDayStart: hhmm,
    shiftNightStart: hhmm,
    shiftCreditHours: z.number().min(1).max(12),
    maxWeekHours: z.number().min(40).max(68),
    warnWeekHours: z.number().gt(0),
    requestExpiryMin: z.number().int().min(5).max(120),
    weights: z.object({ samePost: weight, sameProduct: weight, sameFactory: weight, roleMatch: weight, roleMismatch: weight, recentSub: weight }),
    skillRates: z.tuple([rate, rate, rate, rate]),
  })
  .refine((b) => b.shiftDayStart < b.shiftNightStart)
  .refine((b) => b.warnWeekHours <= b.maxWeekHours)
  .refine((b) => b.skillRates.every((r, i, a) => i === 0 || r >= a[i - 1]));

export const GET = withApi(async (req) => {
  const s = await requireAdmin(req);
  const db = await getDb();
  const [row] = await db.select().from(settings).where(eq(settings.companyId, s.companyId));
  if (!row) throw new EngineError('DATA_INTEGRITY', 'settings missing');
  const { companyId: _companyId, ...rest } = row;
  return Response.json({ settings: rest });
});

export const PUT = withApi(async (req) => {
  const s = await requireAdmin(req);
  const body = Body.parse(await readBody(req));
  await withCompanyTx(s.companyId, async (tx) => {
    await tx.update(settings).set(body).where(eq(settings.companyId, s.companyId));
  });
  return okWithRev(s.companyId);
});
