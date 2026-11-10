import { and, eq, sql } from 'drizzle-orm';
import { effectivePlan } from '@/engine/demand';
import type { DateStr, PlanCell, Shift } from '@/engine/types';
import type { Executor, Tx } from '@/server/db/client';
import * as t from '@/server/db/schema';
import { headerIndex, isBlankRow, parseDate, summarize, text, type ImportPreview, type SheetRows } from './detect';
import { loadRefs, type Refs } from './refs';

export const PLAN_COLUMNS = ['날짜', '교대', '공장', '라인', '제품', '상태'] as const;

const SHIFT: Record<string, Shift> = { 주간: 'day', day: 'day', 야간: 'night', night: 'night' };
const STATUS: Record<string, PlanCell['status']> = { 가동: 'run', run: 'run', 쉼: 'off', off: 'off', 무인: 'unmanned', unmanned: 'unmanned' };
const CHUNK = 500;

/** Every existing plan cell of the company: tells add from update and is the base the inherited plan comes from. */
export type PlanRefs = Refs & { plans: PlanCell[] };

export async function loadPlanRefs(tx: Executor, companyId: string): Promise<PlanRefs> {
  const plans = await tx.select().from(t.planCells).where(eq(t.planCells.companyId, companyId));
  return { ...(await loadRefs(tx, companyId)), plans };
}

type Cell = Omit<PlanCell, 'companyId'>;

type Parsed = {
  row: number;
  key: string;
  errors: string[];
  exists: boolean;
  cell: Cell | null;
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

const validCells = (parsed: Parsed[]): Cell[] => parsed.flatMap((p) => (p.cell ? [p.cell] : []));

const byDateShift = (a: Cell, b: Cell): number =>
  a.date < b.date ? -1 : a.date > b.date ? 1 : a.shift === b.shift ? 0 : a.shift === 'day' ? -1 : 1;

/**
 * The cells a commit writes, same rule as the board's setPlan: a (date, shift, factory) the file touches that has
 * no plan cells of its own yet first gets the whole plan it inherits (`effectivePlan`), then the file rows on top.
 * Groups run in date order against the plan as already updated, so a later day of the file inherits an earlier one.
 * `inherited` counts the cells written only because of that (posts the file does not list).
 */
function planWrites(refs: PlanRefs, cells: Cell[]): { writes: Cell[]; inherited: number } {
  const factoryOf = new Map(refs.posts.map((p) => [p.id, p.factoryId]));
  const groups = new Map<string, Cell[]>();
  for (const c of [...cells].sort(byDateShift)) {
    const k = `${c.date}|${c.shift}|${factoryOf.get(c.postId)}`;
    groups.set(k, [...(groups.get(k) ?? []), c]);
  }

  let plans: PlanCell[] = refs.plans;
  const writes: Cell[] = [];
  let inherited = 0;
  for (const rows of groups.values()) {
    const { date, shift } = rows[0];
    const factoryId = factoryOf.get(rows[0].postId)!;
    const own = (c: Cell) => c.date === date && c.shift === shift && factoryOf.get(c.postId) === factoryId;
    const out = new Map<string, Cell>();
    if (!plans.some(own)) {
      for (const [postId, c] of effectivePlan({ posts: refs.posts, plans }, factoryId, date, shift)) out.set(postId, { date, shift, postId, ...c });
      inherited += [...out.keys()].filter((id) => !rows.some((r) => r.postId === id)).length;
    }
    for (const r of rows) out.set(r.postId, r);
    writes.push(...out.values());
    plans = [...plans.filter((c) => !(own(c) && out.has(c.postId))), ...[...out.values()].map((c) => ({ companyId: '', ...c }))];
  }
  return { writes, inherited };
}

export function previewPlan(refs: PlanRefs, rows: SheetRows): ImportPreview {
  const parsed = parsePlan(refs, rows);
  return {
    ...summarize(
      'plan',
      parsed.map((p) => ({ row: p.row, action: p.errors.length ? 'error' : p.exists ? 'update' : 'add', key: p.key, errors: p.errors })),
    ),
    inherited: planWrites(refs, validCells(parsed)).inherited,
  };
}

/**
 * Upsert every valid row by (date, shift, post) after materialising the inherited plan of any (date, shift, factory)
 * that had none of its own (see planWrites); error rows are skipped. An off/unmanned row removes that post's
 * assignments on that date and shift, locked ones included (as setPlan does).
 */
export async function commitPlan(tx: Tx, companyId: string, rows: SheetRows): Promise<ImportPreview['counts']> {
  const refs = await loadPlanRefs(tx, companyId);
  const parsed = parsePlan(refs, rows);
  const counts = { add: 0, update: 0, error: 0 };
  for (const p of parsed) counts[!p.cell ? 'error' : p.exists ? 'update' : 'add']++;

  const { writes } = planWrites(refs, validCells(parsed));
  for (let i = 0; i < writes.length; i += CHUNK) {
    await tx
      .insert(t.planCells)
      .values(writes.slice(i, i + CHUNK).map((c) => ({ companyId, ...c })))
      .onConflictDoUpdate({
        target: [t.planCells.companyId, t.planCells.date, t.planCells.shift, t.planCells.postId],
        set: { productId: sql`excluded.product_id`, status: sql`excluded.status` },
      });
  }
  for (const c of validCells(parsed)) {
    if (c.status === 'run') continue;
    await tx
      .delete(t.assignments)
      .where(and(eq(t.assignments.companyId, companyId), eq(t.assignments.date, c.date), eq(t.assignments.shift, c.shift), eq(t.assignments.postId, c.postId)));
  }
  return counts;
}
