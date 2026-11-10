import type { DateStr, Post, Shift, Snapshot, Standard } from './types';

export type Slot = { postId: string; index: number; gender: 'M' | 'F' | null };

export type EffectiveCell = { productId: string | null; status: 'run' | 'off' | 'unmanned' };

const RUN_LINES_FOR_EXTRA_CARRIER = 6;
const CARRIER_ROLE = '운반';

function activePosts(snap: Snapshot, factoryId: string): Post[] {
  return snap.posts.filter((p) => p.factoryId === factoryId && p.active);
}

/** Plan per active post of the factory; falls back to the latest earlier day's cells for the same shift. */
export function effectivePlan(
  snap: Snapshot,
  factoryId: string,
  date: DateStr,
  shift: Shift,
): Map<string, EffectiveCell> {
  const posts = activePosts(snap, factoryId);
  const factoryPostIds = new Set(snap.posts.filter((p) => p.factoryId === factoryId).map((p) => p.id));
  const cells = snap.plans.filter((c) => c.shift === shift && factoryPostIds.has(c.postId));

  let useDate: DateStr | null = null;
  if (cells.some((c) => c.date === date)) {
    useDate = date;
  } else {
    for (const c of cells) {
      if (c.date < date && (useDate === null || c.date > useDate)) useDate = c.date;
    }
  }

  const out = new Map<string, EffectiveCell>();
  if (useDate !== null) {
    for (const c of cells) {
      if (c.date === useDate) out.set(c.postId, { productId: c.productId, status: c.status });
    }
  }
  for (const p of posts) {
    if (!out.has(p.id)) out.set(p.id, { productId: null, status: p.unmanned ? 'unmanned' : 'run' });
  }
  for (const id of [...out.keys()]) {
    if (!posts.some((p) => p.id === id)) out.delete(id);
  }
  return out;
}

function findStandard(snap: Snapshot, postId: string, productId: string | null): Standard | undefined {
  if (productId !== null) {
    const exact = snap.standards.find((s) => s.postId === postId && s.productId === productId);
    if (exact) return exact;
  }
  return snap.standards.find((s) => s.postId === postId && s.productId === null);
}

function stoppedPostIds(snap: Snapshot, factoryId: string, date: DateStr, shift: Shift): Set<string> {
  const board = snap.boards.find((b) => b.factoryId === factoryId && b.date === date && b.shift === shift);
  return new Set(board?.stoppedPostIds ?? []);
}

function isRunningLine(post: Post, cell: EffectiveCell | undefined, stopped: Set<string>): boolean {
  return post.kind === 'line' && cell?.status === 'run' && !post.unmanned && !stopped.has(post.id);
}

export function postNeed(snap: Snapshot, factoryId: string, date: DateStr, shift: Shift): Map<string, number> {
  const posts = activePosts(snap, factoryId);
  const plan = effectivePlan(snap, factoryId, date, shift);
  const stopped = stoppedPostIds(snap, factoryId, date, shift);
  const runningLines = posts.filter((p) => isRunningLine(p, plan.get(p.id), stopped)).length;

  const extraCarrier =
    runningLines >= RUN_LINES_FOR_EXTRA_CARRIER
      ? posts
          .filter((p) => p.kind === 'fixed' && p.role === CARRIER_ROLE)
          .sort((a, b) => a.sort - b.sort)[0]
      : undefined;

  const out = new Map<string, number>();
  for (const p of posts) {
    let need: number;
    if (p.unmanned) {
      need = 0;
    } else if (p.kind === 'line') {
      need = isRunningLine(p, plan.get(p.id), stopped)
        ? (findStandard(snap, p.id, plan.get(p.id)?.productId ?? null)?.need ?? p.defaultNeed)
        : 0;
    } else {
      need = runningLines === 0 ? 0 : p.defaultNeed;
      if (extraCarrier?.id === p.id) need += 1;
    }
    out.set(p.id, need);
  }
  return out;
}

export function computeSlots(snap: Snapshot, factoryId: string, date: DateStr, shift: Shift): Slot[] {
  const needs = postNeed(snap, factoryId, date, shift);
  const plan = effectivePlan(snap, factoryId, date, shift);
  const slots: Slot[] = [];
  for (const p of activePosts(snap, factoryId).sort((a, b) => a.sort - b.sort)) {
    const need = needs.get(p.id) ?? 0;
    const gender = findStandard(snap, p.id, plan.get(p.id)?.productId ?? null)?.gender ?? null;
    for (let index = 0; index < need; index++) slots.push({ postId: p.id, index, gender });
  }
  return slots;
}
