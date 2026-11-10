import { z } from 'zod';
import { EngineError } from '@/engine/types';
import { requireAdmin, withApi } from '@/server/auth/guard';
import { nowFn } from '@/server/clock';
import { getDb } from '@/server/db/client';
import { okWithRev } from '@/server/admin/common';
import { MAX_BYTES, detectKind, headersOf, readSheetRows, text, type ImportPreview } from '@/server/excel/detect';
import { commitPlan, loadPlanRefs, previewPlan } from '@/server/excel/plan';
import { loadRefs } from '@/server/excel/refs';
import { commitRoster, previewRoster } from '@/server/excel/roster';
import { withCompanyTx } from '@/server/runAction';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Mode = z.enum(['preview', 'commit']);

export const POST = withApi(async (req) => {
  const s = await requireAdmin(req);
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!form || !(file instanceof File)) throw new EngineError('BAD_INPUT', 'file is required');
  const mode = Mode.parse(form.get('mode'));
  if (file.size > MAX_BYTES) throw new EngineError('BAD_INPUT', 'file too large');

  const rows = readSheetRows(Buffer.from(await file.arrayBuffer()));
  const kind = detectKind(headersOf(rows));

  if (kind === 'unknown') {
    if (mode === 'commit') throw new EngineError('UNKNOWN_FORMAT');
    const preview: ImportPreview = {
      kind,
      rows: [],
      counts: { add: 0, update: 0, error: 0 },
      sample: rows.slice(0, 10).map((r) => r.map(text)),
    };
    return Response.json(preview);
  }

  if (mode === 'preview') {
    const db = await getDb();
    return Response.json(kind === 'roster' ? previewRoster(await loadRefs(db, s.companyId), rows) : previewPlan(await loadPlanRefs(db, s.companyId), rows));
  }
  const now = nowFn();
  const counts = await withCompanyTx(s.companyId, (tx) =>
    kind === 'roster' ? commitRoster(tx, s.companyId, rows, now) : commitPlan(tx, s.companyId, rows),
  );
  return okWithRev(s.companyId, { kind, counts });
});
