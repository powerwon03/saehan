import { regularShift } from './calendar';
import { computeSlots, effectivePlan, type Slot } from './demand';
import { postExperience, productExperience, skillLevel, skillRate } from './skill';
import {
  emptyChanges,
  type Assignment,
  type Board,
  type Changes,
  type Ctx,
  type DateStr,
  type Shift,
  type Snapshot,
} from './types';
import { isOff, recentSubCount, weekHours } from './worklog';

const EXPERIENCE_CAP = 50;
const EXPERIENCE_WEIGHT = 0.2;
const HOURS_FREE = 40;
const HOURS_PENALTY = 0.5;
const SINGLE_CAPABLE_LEVEL = 2;

export type ScoreCtx = {
  factoryId: string;
  date: DateStr;
  shift: Shift;
  productId: string | null;
  isSubstitute: boolean;
};

const shiftOrder = (s: Shift): number => (s === 'day' ? 0 : 1);

/** postId of the person's latest assignment strictly before (date, shift), or null. */
function lastPostId(snap: Snapshot, personId: string, date: DateStr, shift: Shift): string | null {
  let best: { date: DateStr; shift: Shift; postId: string } | null = null;
  for (const a of snap.assignments) {
    if (a.personId !== personId) continue;
    if (a.date > date || (a.date === date && shiftOrder(a.shift) >= shiftOrder(shift))) continue;
    if (!best || a.date > best.date || (a.date === best.date && shiftOrder(a.shift) > shiftOrder(best.shift))) {
      best = a;
    }
  }
  return best?.postId ?? null;
}

export function placementScore(snap: Snapshot, personId: string, postId: string, ctx: ScoreCtx): number {
  const person = snap.persons.find((p) => p.id === personId);
  const post = snap.posts.find((p) => p.id === postId);
  if (!person || !post) return -Infinity;
  const w = snap.settings.weights;

  let score = skillRate(skillLevel(snap, personId, postId), snap.settings) * 100;
  if (lastPostId(snap, personId, ctx.date, ctx.shift) === postId) score += w.samePost;
  score += Math.min(postExperience(snap, personId, postId), EXPERIENCE_CAP) * EXPERIENCE_WEIGHT;
  if (ctx.productId !== null && productExperience(snap, personId, ctx.productId) > 0) score += w.sameProduct;
  if (person.factoryId === ctx.factoryId) score += w.sameFactory;
  if (post.role !== null) score += post.role === person.role ? w.roleMatch : -w.roleMismatch;
  if (ctx.isSubstitute) score -= recentSubCount(snap, personId, ctx.date) * w.recentSub;
  score -= Math.max(0, weekHours(snap, personId, ctx.date) - HOURS_FREE) * HOURS_PENALTY;
  return score;
}

export function flagsFor(snap: Snapshot, personId: string, postId: string, slot: Slot, date: DateStr): string[] {
  const person = snap.persons.find((p) => p.id === personId);
  const post = snap.posts.find((p) => p.id === postId);
  const level = skillLevel(snap, personId, postId);
  const flags: string[] = [];
  if (postExperience(snap, personId, postId) === 0 && level === 0) flags.push('no-exp');
  if (level <= 1) flags.push('low-skill');
  if (post && post.role !== null && post.role !== person?.role) flags.push('role');
  if (slot.gender !== null && slot.gender !== person?.gender) flags.push('gender');
  if (weekHours(snap, personId, date) >= snap.settings.warnWeekHours) flags.push('hours');
  return flags;
}

/** Active regular workers of the factory for the shift, minus those off or absent that day. */
export function rosterFor(snap: Snapshot, factoryId: string, date: DateStr, shift: Shift): string[] {
  const factory = snap.factories.find((f) => f.id === factoryId);
  if (!factory) return [];
  return snap.persons
    .filter(
      (p) =>
        p.active &&
        p.factoryId === factoryId &&
        regularShift(p, factory, date) === shift &&
        !isOff(snap, p.id, date) &&
        !snap.absences.some((a) => a.personId === p.id && a.date === date && a.shift === shift && a.status !== 'cancelled'),
    )
    .map((p) => p.id);
}

export function autoAssign(snap: Snapshot, factoryId: string, date: DateStr, shift: Shift, ctx: Ctx): Changes {
  const changes = emptyChanges();
  const inScope = (a: Assignment) => a.factoryId === factoryId && a.date === date && a.shift === shift;
  const stale = snap.assignments.filter((a) => inScope(a) && !a.locked);
  const locked = snap.assignments.filter((a) => inScope(a) && a.locked);

  // Anyone holding an assignment that is not being recomputed is unavailable.
  const busy = new Set(
    snap.assignments.filter((a) => a.date === date && a.shift === shift && !(inScope(a) && !a.locked)).map((a) => a.personId),
  );
  const empNo = new Map(snap.persons.map((p) => [p.id, p.empNo]));
  let pool = rosterFor(snap, factoryId, date, shift)
    .filter((id) => !busy.has(id))
    .sort((a, b) => (empNo.get(a)! < empNo.get(b)! ? -1 : empNo.get(a)! > empNo.get(b)! ? 1 : 0));

  // Open slots per post (locked assignments consume slots).
  const plan = effectivePlan(snap, factoryId, date, shift);
  const slotsByPost = new Map<string, Slot[]>();
  for (const s of computeSlots(snap, factoryId, date, shift)) {
    const list = slotsByPost.get(s.postId) ?? [];
    list.push(s);
    slotsByPost.set(s.postId, list);
  }
  for (const a of locked) {
    const list = slotsByPost.get(a.postId);
    if (list) list.pop();
  }

  const rows: Assignment[] = [];
  const place = (personId: string, slot: Slot) => {
    rows.push({
      id: ctx.newId(),
      companyId: snap.companyId,
      date,
      shift,
      factoryId,
      postId: slot.postId,
      personId,
      source: 'auto',
      locked: false,
      reason: null,
      flags: flagsFor(snap, personId, slot.postId, slot, date),
      createdAt: ctx.now,
    });
    pool = pool.filter((id) => id !== personId);
  };
  const genderOk = (personId: string, slot: Slot) =>
    slot.gender === null || snap.persons.find((p) => p.id === personId)?.gender === slot.gender;

  // 1) designated people go to their fixed post first
  for (const personId of [...pool]) {
    const fixed = snap.persons.find((p) => p.id === personId)?.fixedPostId;
    if (!fixed) continue;
    const list = slotsByPost.get(fixed);
    const i = list ? list.findIndex((s) => genderOk(personId, s)) : -1;
    if (list && i >= 0) place(personId, list.splice(i, 1)[0]);
  }

  // 2) remaining posts: fewest single-capable candidates first (recounted against the current pool),
  //    then priority desc, then sort asc
  const singleCapable = (postId: string, gender: Slot['gender']) =>
    pool.filter(
      (id) =>
        skillLevel(snap, id, postId) >= SINGLE_CAPABLE_LEVEL &&
        (gender === null || snap.persons.find((p) => p.id === id)?.gender === gender),
    ).length;
  const remaining = [...slotsByPost.entries()].filter(([, list]) => list.length > 0);
  while (remaining.length > 0 && pool.length > 0) {
    const ranked = remaining
      .map((entry) => ({
        entry,
        post: snap.posts.find((p) => p.id === entry[0])!,
        capable: singleCapable(entry[0], entry[1][0].gender),
      }))
      .sort((a, b) => a.capable - b.capable || b.post.priority - a.post.priority || a.post.sort - b.post.sort);
    const { entry, post } = ranked[0];
    remaining.splice(remaining.indexOf(entry), 1);
    const productId = plan.get(post.id)?.productId ?? null;
    for (const slot of entry[1]) {
      let best: { id: string; score: number } | null = null;
      for (const id of pool) {
        if (!genderOk(id, slot)) continue;
        const score = placementScore(snap, id, post.id, { factoryId, date, shift, productId, isSubstitute: false });
        if (!best || score > best.score) best = { id, score }; // pool is empNo-ascending, so ties keep the earlier one
      }
      if (best) place(best.id, slot);
    }
  }

  if (stale.length > 0) changes.remove.assignments = stale.map((a) => a.id);
  if (rows.length > 0) changes.upsert.assignments = rows;
  if (!snap.boards.some((b) => b.factoryId === factoryId && b.date === date && b.shift === shift)) {
    const board: Board = {
      companyId: snap.companyId,
      date,
      shift,
      factoryId,
      status: 'draft',
      stoppedPostIds: [],
      confirmedAt: null,
      confirmedBy: null,
    };
    changes.upsert.boards = [board];
  }
  return changes;
}
