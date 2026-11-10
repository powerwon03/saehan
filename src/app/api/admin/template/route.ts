import { z } from 'zod';
import { seoulDate } from '@/engine/time';
import { requireAdmin, withApi } from '@/server/auth/guard';
import { nowFn } from '@/server/clock';
import { getDb } from '@/server/db/client';
import { XLSX_TYPE } from '@/server/excel/mime';
import { loadRefs } from '@/server/excel/refs';
import { buildTemplate } from '@/server/excel/templates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Query = z.object({ type: z.enum(['roster', 'plan']) });

export const GET = withApi(async (req) => {
  const s = await requireAdmin(req);
  const { type } = Query.parse(Object.fromEntries(new URL(req.url).searchParams));
  const buf = buildTemplate(type, await loadRefs(await getDb(), s.companyId), seoulDate(nowFn()));
  return new Response(new Uint8Array(buf), {
    headers: { 'content-type': XLSX_TYPE, 'content-disposition': `attachment; filename="${type}-template.xlsx"` },
  });
});
