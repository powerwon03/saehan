import { z } from 'zod';
import { seoulDate } from '@/engine/time';
import { requireAdmin, withApi } from '@/server/auth/guard';
import { nowFn } from '@/server/clock';
import { getDb } from '@/server/db/client';
import { attendanceAround, buildAttendance, parseMonth } from '@/server/excel/attendance';
import { loadSnapshot } from '@/server/repo/snapshot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const Query = z.object({ month: z.string() });

export const GET = withApi(async (req) => {
  const s = await requireAdmin(req);
  const { month } = Query.parse(Object.fromEntries(new URL(req.url).searchParams));
  parseMonth(month);
  // one snapshot centred on the 16th: its −35/+15 day window covers the whole month (day 1 … day 31)
  const snap = await loadSnapshot(await getDb(), s.companyId, attendanceAround(month));
  const buf = buildAttendance(snap, month, seoulDate(nowFn()));
  return new Response(new Uint8Array(buf), {
    headers: { 'content-type': XLSX_TYPE, 'content-disposition': `attachment; filename="attendance-${month}.xlsx"` },
  });
});
