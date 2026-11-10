import { eq } from 'drizzle-orm';
import type { DateStr, PlanCell, Shift } from '@/engine/types';
import type { Executor, Tx } from '@/server/db/client';
import * as t from '@/server/db/schema';
import { headerIndex, isBlankRow, parseDate, summarize, text, type ImportPreview, type SheetRows } from './detect';
import { loadRefs, type Refs } from './refs';

export const PLAN_COLUMNS = ['날짜', '교대', '공장', '라인', '제품', '상태'] as const;

const SHIFT: Record<string, Shift> = { 주간: 'day', day: 'day', 야간: 'night', night: 'night' };
const STATUS: Record<string, PlanCell['status']> = { 가동: 'run', run: 'run', 쉼: 'off', off: 'off', 무인: 'unmanned', unmanned: 'unmanned' };

/** Existing plan cells are needed to tell add from update (a Snapshot's windowed `plans` is not enough). */
export type PlanRefs = Refs & { plans: Pick<PlanCell, 'date' | 'shift' | 'postId'>[] };

export async function loadPlanRefs(tx: Executor, companyId: string): Promise<PlanRefs> {
  const plans = await tx
    .select({ date: t.planCells.date, shift: t.planCells.shift, postId: t.planCells.postId })
    .from(t.planCells)
    .where(eq(t.planCells.companyId, companyId));
  return { ...(await loadRefs(tx, companyId)), plans };
}

type Parsed = {
  row: number;
  key: string;
  errors: string[];
  exists: boolean;
  cell: { date: DateStr; shift: Shift; postId: string; productId: string | null; status: PlanCell['status'] } | null;
};

function parsePlan(refs: PlanRefs, rows: SheetRows): Parsed[] {
  const idx = headerIndex(rows);
  const existing = new Set(refs.plans.map((p) => `${p.date}|${p.shift}|${p.postId}`));
  const seen = new Set<string>();
  const out: Parsed[] = [];

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (isBlankRow(r)) continue;
    const cell = (h: string) => (idx.has(h) ? r[idx.get(h)!] : null);
    const val = (h: string) => text(cell(h));
    const errors: string[] = [];
    const date = val('날짜') ? parseDate(cell('날짜')) : null;
    const key = [date ?? val('날짜'), val('교대'), val('공장'), val('라인')].join('/');
    const p: Parsed = { row: i + 1, key, errors, exists: false, cell: null };
    out.push(p);

    if (!date) errors.push(val('날짜') ? '날짜가 올바르지 않습니다' : '날짜가 없습니다');
    const shift = SHIFT[val('교대')] ?? SHIFT[val('교대').toLowerCase()];
    if (!shift) errors.push(val('교대') ? `교대 값이 올바르지 않습니다: ${val('교대')}` : '교대가 없습니다');
    const status = STATUS[val('상태')] ?? STATUS[val('상태').toLowerCase()];
    if (!status) errors.push(val('상태') ? `상태 값이 올바르지 않습니다: ${val('상태')}` : '상태가 없습니다');

    const fname = val('공장');
    const factory = fname ? (refs.factories.find((f) => f.name === fname) ?? refs.factories.find((f) => f.code === fname)) : undefined;
    if (!factory) errors.push(fname ? `없는 공장: ${fname}` : '공장이 없습니다');
    const line = val('라인');
    const post = factory && line ? refs.posts.find((x) => x.factoryId === factory.id && x.code === line) : undefined;
    if (factory && !post) errors.push(line ? `없는 라인: ${line}` : '라인이 없습니다');
    if (!factory && !line) errors.push('라인이 없습니다');

    let productId: string | null = null;
    if (status === 'run') {
      const code = val('제품');
      const product = code ? refs.products.find((x) => x.code === code) : undefined;
      if (!product) errors.push(code ? `없는 제품: ${code}` : '가동 행에는 제품이 필요합니다');
      else productId = product.id;
    }

    if (date && shift && post) {
      const k = `${date}|${shift}|${post.id}`;
      if (seen.has(k)) errors.push('파일 안에서 같은 날짜·교대·라인이 중복됩니다');
      else seen.add(k);
      p.exists = existing.has(k);
      if (status && !errors.length) p.cell = { date, shift, postId: post.id, productId, status };
    }
  }
  return out;
}

export function previewPlan(snap: PlanRefs, rows: SheetRows): ImportPreview {
  return summarize(
    'plan',
    parsePlan(snap, rows).map((p) => ({ row: p.row, action: p.errors.length ? 'error' : p.exists ? 'update' : 'add', key: p.key, errors: p.errors })),
  );
}

/** Upsert every valid row by (date, shift, post); error rows are skipped. */
export async function commitPlan(tx: Tx, companyId: string, rows: SheetRows): Promise<ImportPreview['counts']> {
  const counts = { add: 0, update: 0, error: 0 };
  for (const p of parsePlan(await loadPlanRefs(tx, companyId), rows)) {
    if (!p.cell) {
      counts.error++;
      continue;
    }
    const { productId, status } = p.cell;
    await tx
      .insert(t.planCells)
      .values({ companyId, ...p.cell })
      .onConflictDoUpdate({ target: [t.planCells.companyId, t.planCells.date, t.planCells.shift, t.planCells.postId], set: { productId, status } });
    counts[p.exists ? 'update' : 'add']++;
  }
  return counts;
}
