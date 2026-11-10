import { flagsFor, rosterFor } from './autoAssign';
import { computeSlots, effectivePlan } from './demand';
import { canWorkExtra } from './eligibility';
import {
  EngineError,
  emptyChanges,
  type Assignment,
  type Board,
  type Changes,
  type Ctx,
  type DateStr,
  type PlanCell,
  type Shift,
  type Snapshot,
} from './types';

type Key = { factoryId: string; date: DateStr; shift: Shift };

const findBoard = (snap: Snapshot, k: Key): Board | undefined =>
  snap.boards.find((b) => b.factoryId === k.factoryId && b.date === k.date && b.shift === k.shift);

const draftBoard = (snap: Snapshot, k: Key): Board => ({
  companyId: snap.companyId,
  date: k.date,
  shift: k.shift,
  factoryId: k.factoryId,
  status: 'draft',
  stoppedPostIds: [],
  confirmedAt: null,
  confirmedBy: null,
});

const slotAssignments = (snap: Snapshot, date: DateStr, shift: Shift) =>
  snap.assignments.filter((a) => a.date === date && a.shift === shift);

function removeIds(changes: Changes, ids: string[]): void {
  if (ids.length > 0) changes.remove.assignments = [...(changes.remove.assignments ?? []), ...ids];
}

export function setPlan(
  snap: Snapshot,
  input: Key & { postId: string; productId: string | null; status: PlanCell['status'] },
  _ctx: Ctx,
): Changes {
  const { factoryId, date, shift, postId, productId, status } = input;
  const changes = emptyChanges();
  const factoryPostIds = new Set(snap.posts.filter((p) => p.factoryId === factoryId).map((p) => p.id));
  if (!factoryPostIds.has(postId)) throw new EngineError('BAD_INPUT', `post ${postId} not in factory ${factoryId}`);

  const cell = (id: string, c: { productId: string | null; status: PlanCell['status'] }): PlanCell => ({
    companyId: snap.companyId,
    date,
    shift,
    postId: id,
    productId: c.productId,
    status: c.status,
  });

  const hasOwn = snap.plans.some((c) => c.date === date && c.shift === shift && factoryPostIds.has(c.postId));
  const cells = new Map<string, PlanCell>();
  if (!hasOwn) {
    for (const [id, c] of effectivePlan(snap, factoryId, date, shift)) cells.set(id, cell(id, c));
  }
  cells.set(postId, cell(postId, { productId, status }));
  changes.upsert.plans = [...cells.values()];

  if (status === 'off' || status === 'unmanned') {
    removeIds(
      changes,
      slotAssignments(snap, date, shift)
        .filter((a) => a.postId === postId)
        .map((a) => a.id),
    );
  }
  return changes;
}

export function toggleStop(snap: Snapshot, input: Key & { postId: string }, _ctx: Ctx): Changes {
  const post = snap.posts.find((p) => p.id === input.postId);
  if (!post || post.factoryId !== input.factoryId) {
    throw new EngineError('BAD_INPUT', `post ${input.postId} not in factory ${input.factoryId}`);
  }
  const changes = emptyChanges();
  const board = findBoard(snap, input) ?? draftBoard(snap, input);
  const stopping = !board.stoppedPostIds.includes(input.postId);
  const stoppedPostIds = stopping
    ? [...board.stoppedPostIds, input.postId]
    : board.stoppedPostIds.filter((id) => id !== input.postId);
  changes.upsert.boards = [{ ...board, stoppedPostIds }];
  if (stopping) {
    removeIds(
      changes,
      slotAssignments(snap, input.date, input.shift)
        .filter((a) => a.postId === input.postId)
        .map((a) => a.id),
    );
  }
  return changes;
}

export function assignPerson(snap: Snapshot, input: Key & { postId: string; personId: string }, ctx: Ctx): Changes {
  const { factoryId, date, shift, postId, personId } = input;
  const post = snap.posts.find((p) => p.id === postId);
  if (!post || post.factoryId !== factoryId) throw new EngineError('BAD_INPUT', `post ${postId} not in factory ${factoryId}`);
  if (!snap.persons.some((p) => p.id === personId)) throw new EngineError('BAD_INPUT', `person ${personId} not found`);

  const changes = emptyChanges();
  const existing = slotAssignments(snap, date, shift).find((a) => a.personId === personId);
  if (existing) {
    if (existing.postId === postId) return changes;
    removeIds(changes, [existing.id]);
  } else if (!rosterFor(snap, factoryId, date, shift).includes(personId)) {
    const verdict = canWorkExtra(snap, personId, date, shift);
    if (!verdict.ok) throw new EngineError(verdict.reason);
  }

  const slot = computeSlots(snap, factoryId, date, shift).find((s) => s.postId === postId) ?? {
    postId,
    index: 0,
    gender: null,
  };
  const row: Assignment = {
    id: ctx.newId(),
    companyId: snap.companyId,
    date,
    shift,
    factoryId,
    postId,
    personId,
    source: 'manual',
    locked: true,
    reason: null,
    flags: flagsFor(snap, personId, postId, slot, date),
    createdAt: ctx.now,
  };
  changes.upsert.assignments = [row];
  return changes;
}

export function swap(snap: Snapshot, input: { assignmentIdA: string; assignmentIdB: string }, _ctx: Ctx): Changes {
  const a = snap.assignments.find((x) => x.id === input.assignmentIdA);
  const b = snap.assignments.find((x) => x.id === input.assignmentIdB);
  if (!a || !b) throw new EngineError('BAD_INPUT', 'assignment not found');
  if (a.id === b.id) throw new EngineError('BAD_INPUT', 'cannot swap an assignment with itself');
  if (a.date !== b.date || a.shift !== b.shift) throw new EngineError('BAD_INPUT', 'assignments differ in date or shift');

  const changes = emptyChanges();
  const moved = (row: Assignment, to: Assignment): Assignment => {
    const slot = computeSlots(snap, to.factoryId, row.date, row.shift).find((s) => s.postId === to.postId) ?? {
      postId: to.postId,
      index: 0,
      gender: null,
    };
    return {
      ...row,
      postId: to.postId,
      factoryId: to.factoryId,
      locked: true,
      source: 'manual',
      flags: flagsFor(snap, row.personId, to.postId, slot, row.date),
    };
  };
  changes.upsert.assignments = [moved(a, b), moved(b, a)];
  return changes;
}

export function unassign(snap: Snapshot, input: { assignmentId: string }, _ctx: Ctx): Changes {
  if (!snap.assignments.some((a) => a.id === input.assignmentId)) throw new EngineError('BAD_INPUT', 'assignment not found');
  const changes = emptyChanges();
  changes.remove.assignments = [input.assignmentId];
  return changes;
}

export function confirmBoard(snap: Snapshot, input: Key, ctx: Ctx): Changes {
  const changes = emptyChanges();
  const board = findBoard(snap, input) ?? draftBoard(snap, input);
  changes.upsert.boards = [{ ...board, status: 'confirmed', confirmedAt: ctx.now, confirmedBy: null }];
  changes.messages = slotAssignments(snap, input.date, input.shift)
    .filter((a) => a.factoryId === input.factoryId)
    .map((a) => ({
      companyId: snap.companyId,
      personId: a.personId,
      bodyKey: 'todayWork',
      params: { date: input.date, shift: input.shift, postId: a.postId },
      channel: 'push' as const,
    }));
  return changes;
}
