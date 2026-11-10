import { flagsFor } from './autoAssign';
import { computeSlots, postNeed } from './demand';
import { canWorkExtra } from './eligibility';
import { idlePeople } from './recommend';
import { hasShiftStarted } from './time';
import {
  emptyChanges,
  EngineError,
  mergeChanges,
  type Absence,
  type AbsenceKind,
  type Assignment,
  type Changes,
  type Ctx,
  type DateStr,
  type Shift,
  type Snapshot,
  type SubRequest,
  type TableName,
} from './types';

export type RespondOutcome = 'accepted' | 'declined' | 'takenByOther' | 'expired';

const PLACEABLE: Absence['status'][] = ['decided', 'in-progress', 'failed'];

function upsertOf(table: TableName, ...rows: object[]): Changes {
  const c = emptyChanges();
  c.upsert[table] = rows;
  return c;
}

/** Admin message when personId is null, push to the worker otherwise. */
function messageOf(snap: Snapshot, personId: string | null, bodyKey: string, params: Record<string, unknown>): Changes {
  const c = emptyChanges();
  c.messages.push({ companyId: snap.companyId, personId, bodyKey, params, channel: personId === null ? 'admin' : 'push' });
  return c;
}

function findAbsence(snap: Snapshot, absenceId: string): Absence {
  const absence = snap.absences.find((a) => a.id === absenceId);
  if (!absence) throw new EngineError('BAD_INPUT', `absence ${absenceId} not found`);
  return absence;
}

function assertPlaceable(absence: Absence): void {
  if (absence.status === 'resolved') throw new EngineError('ALREADY_RESOLVED');
  if (!PLACEABLE.includes(absence.status)) throw new EngineError('BAD_STATE', `absence is ${absence.status}`);
}

const sentOf = (snap: Snapshot, absenceId: string): SubRequest[] =>
  snap.subRequests.filter((r) => r.absenceId === absenceId && r.status === 'sent');

const assignmentOf = (snap: Snapshot, personId: string, date: DateStr, shift: Shift): Assignment | undefined =>
  snap.assignments.find((a) => a.personId === personId && a.date === date && a.shift === shift);

const countOnPost = (snap: Snapshot, factoryId: string, date: DateStr, shift: Shift, postId: string): number =>
  snap.assignments.filter((a) => a.factoryId === factoryId && a.date === date && a.shift === shift && a.postId === postId)
    .length;

const needOf = (snap: Snapshot, factoryId: string, date: DateStr, shift: Shift, postId: string): number =>
  postNeed(snap, factoryId, date, shift).get(postId) ?? 0;

function absenceStatusAfterRemoval(snap: Snapshot, factoryId: string, date: DateStr, shift: Shift, found: Assignment | undefined): Absence['status'] {
  if (!snap.boards.some((b) => b.factoryId === factoryId && b.date === date && b.shift === shift)) return 'pending-board';
  if (!found) return 'not-needed';
  const remaining = countOnPost(snap, factoryId, date, shift, found.postId) - 1;
  return remaining >= needOf(snap, factoryId, date, shift, found.postId) ? 'not-needed' : 'decided';
}

export function reportAbsence(
  snap: Snapshot,
  input: { personId: string; date: DateStr; shift: Shift; kind: AbsenceKind; reportedBy: Absence['reportedBy']; reason?: string },
  ctx: Ctx,
): Changes {
  const { personId, date, shift } = input;
  if (snap.absences.some((a) => a.personId === personId && a.date === date && a.shift === shift && a.status !== 'cancelled')) {
    return emptyChanges();
  }
  const person = snap.persons.find((p) => p.id === personId);
  if (!person) throw new EngineError('BAD_INPUT', `person ${personId} not found`);

  const found = assignmentOf(snap, personId, date, shift);
  const factoryId = found?.factoryId ?? person.factoryId;
  const absence: Absence = {
    id: ctx.newId(),
    companyId: snap.companyId,
    date,
    shift,
    factoryId,
    personId,
    postId: found?.postId ?? null,
    kind: input.kind,
    reportedBy: input.reportedBy,
    reason: input.reason ?? null,
    status: absenceStatusAfterRemoval(snap, factoryId, date, shift, found),
    resolvedPersonId: null,
    round: 1,
    restore: found ?? null,
    createdAt: ctx.now,
    resolvedAt: null,
  };
  const changes = upsertOf('absences', absence);
  if (found) changes.remove.assignments = [found.id];
  const params = { absenceId: absence.id, personId, date, shift, postId: absence.postId };
  return mergeChanges(changes, messageOf(snap, null, 'absenceReported', params));
}

function shouldRestore(snap: Snapshot, absence: Absence, restore: Assignment | null): restore is Assignment {
  return (
    restore !== null &&
    !assignmentOf(snap, absence.personId, absence.date, absence.shift) &&
    countOnPost(snap, restore.factoryId, absence.date, absence.shift, restore.postId) <
      needOf(snap, restore.factoryId, absence.date, absence.shift, restore.postId)
  );
}

export function cancelAbsence(snap: Snapshot, input: { absenceId: string; by: 'self' | 'admin' }, ctx: Ctx): Changes {
  const absence = findAbsence(snap, input.absenceId);
  if (absence.status === 'cancelled') return emptyChanges();
  if (absence.status === 'resolved') throw new EngineError('ALREADY_RESOLVED');
  if (input.by === 'self' && hasShiftStarted(ctx.now, absence.date, absence.shift, snap.settings)) {
    throw new EngineError('SHIFT_STARTED');
  }

  let changes = upsertOf('absences', { ...absence, status: 'cancelled' });
  for (const r of sentOf(snap, absence.id)) {
    changes = mergeChanges(changes, upsertOf('subRequests', { ...r, status: 'cancelled' }));
    changes = mergeChanges(changes, messageOf(snap, r.personId, 'requestCancelled', { absenceId: absence.id }));
  }
  const restore = absence.restore as Assignment | null;
  return shouldRestore(snap, absence, restore) ? mergeChanges(changes, upsertOf('assignments', restore)) : changes;
}

/** Shared by placeSub and accept: place the sub, resolve the absence, cancel the other open requests. */
function placeAndResolve(snap: Snapshot, absence: Absence, personId: string, keepRequestId: string | null, ctx: Ctx): Changes {
  const postId = absence.postId;
  if (postId === null) throw new EngineError('BAD_STATE', 'absence has no post');
  const slot = computeSlots(snap, absence.factoryId, absence.date, absence.shift).find((s) => s.postId === postId) ?? {
    postId,
    index: 0,
    gender: null,
  };
  const assignment: Assignment = {
    id: ctx.newId(),
    companyId: snap.companyId,
    date: absence.date,
    shift: absence.shift,
    factoryId: absence.factoryId,
    postId,
    personId,
    source: 'sub',
    locked: true,
    reason: `absence:${absence.id}`,
    flags: flagsFor(snap, personId, postId, slot, absence.date),
    createdAt: ctx.now,
  };
  let changes = mergeChanges(
    upsertOf('assignments', assignment),
    upsertOf('absences', { ...absence, status: 'resolved', resolvedPersonId: personId, resolvedAt: ctx.now }),
  );
  for (const r of sentOf(snap, absence.id).filter((r) => r.id !== keepRequestId)) {
    changes = mergeChanges(changes, upsertOf('subRequests', { ...r, status: 'cancelled' }));
    changes = mergeChanges(changes, messageOf(snap, r.personId, 'takenByOther', { absenceId: absence.id }));
  }
  return changes;
}

export function placeSub(snap: Snapshot, input: { absenceId: string; personId: string }, ctx: Ctx): Changes {
  const absence = findAbsence(snap, input.absenceId);
  assertPlaceable(absence);
  if (!idlePeople(snap, absence.factoryId, absence.date, absence.shift).includes(input.personId)) {
    const verdict = canWorkExtra(snap, input.personId, absence.date, absence.shift);
    if (!verdict.ok) throw new EngineError(verdict.reason);
  }
  const assigned = messageOf(snap, input.personId, 'subAssigned', {
    absenceId: absence.id,
    date: absence.date,
    shift: absence.shift,
    postId: absence.postId,
  });
  return mergeChanges(placeAndResolve(snap, absence, input.personId, null, ctx), assigned);
}

export function requestSubs(snap: Snapshot, input: { absenceId: string; personIds: string[] }, ctx: Ctx): Changes {
  const absence = findAbsence(snap, input.absenceId);
  assertPlaceable(absence);
  const alreadySent = new Set(sentOf(snap, absence.id).map((r) => r.personId));
  const eligible = input.personIds.filter((id) => !alreadySent.has(id) && canWorkExtra(snap, id, absence.date, absence.shift).ok);
  if (eligible.length === 0) throw new EngineError('NO_CANDIDATES');

  const inRound = snap.subRequests.filter((r) => r.absenceId === absence.id && r.round === absence.round).length;
  const expiresAt = new Date(ctx.now.getTime() + snap.settings.requestExpiryMin * 60_000);
  let changes = upsertOf('absences', { ...absence, status: 'in-progress' });
  eligible.forEach((personId, index) => {
    const row: SubRequest = {
      id: ctx.newId(),
      companyId: snap.companyId,
      absenceId: absence.id,
      personId,
      round: absence.round,
      rank: inRound + index + 1,
      status: 'sent',
      sentAt: ctx.now,
      expiresAt,
      respondedAt: null,
    };
    const params = {
      absenceId: absence.id,
      requestId: row.id,
      date: absence.date,
      shift: absence.shift,
      postId: absence.postId,
      expiresAt: expiresAt.toISOString(),
    };
    changes = mergeChanges(changes, upsertOf('subRequests', row));
    changes = mergeChanges(changes, messageOf(snap, personId, 'subRequest', params));
  });
  return changes;
}

/** If no request of the absence stays 'sent' once `closedIds` are closed, mark it failed (next round). */
function failIfNoneSent(snap: Snapshot, absence: Absence, closedIds: Set<string>): Changes {
  if (sentOf(snap, absence.id).some((r) => !closedIds.has(r.id))) return emptyChanges();
  return mergeChanges(
    upsertOf('absences', { ...absence, status: 'failed', round: absence.round + 1 }),
    messageOf(snap, null, 'subFailed', { absenceId: absence.id }),
  );
}

const OUTCOME_BY_STATUS: Record<Exclude<SubRequest['status'], 'sent'>, RespondOutcome> = {
  cancelled: 'takenByOther',
  expired: 'expired',
  accepted: 'accepted',
  declined: 'declined',
};

export function respondSub(
  snap: Snapshot,
  input: { requestId: string; personId: string; accept: boolean },
  ctx: Ctx,
): { changes: Changes; outcome: RespondOutcome } {
  const request = snap.subRequests.find((r) => r.id === input.requestId);
  if (!request) throw new EngineError('BAD_INPUT', `request ${input.requestId} not found`);
  if (request.personId !== input.personId) throw new EngineError('FORBIDDEN');
  if (request.status !== 'sent') return { changes: emptyChanges(), outcome: OUTCOME_BY_STATUS[request.status] };

  const absence = findAbsence(snap, request.absenceId);
  const closed = new Set([request.id]);

  if (ctx.now.getTime() >= request.expiresAt.getTime()) {
    const changes = mergeChanges(upsertOf('subRequests', { ...request, status: 'expired' }), failIfNoneSent(snap, absence, closed));
    return { changes, outcome: 'expired' };
  }
  if (absence.status === 'resolved' || absence.status === 'cancelled') {
    return { changes: upsertOf('subRequests', { ...request, status: 'cancelled' }), outcome: 'takenByOther' };
  }
  if (!input.accept) {
    const declined = upsertOf('subRequests', { ...request, status: 'declined', respondedAt: ctx.now });
    return { changes: mergeChanges(declined, failIfNoneSent(snap, absence, closed)), outcome: 'declined' };
  }

  const verdict = canWorkExtra(snap, input.personId, absence.date, absence.shift);
  if (!verdict.ok) throw new EngineError(verdict.reason);
  let changes = mergeChanges(
    placeAndResolve(snap, absence, input.personId, request.id, ctx),
    upsertOf('subRequests', { ...request, status: 'accepted', respondedAt: ctx.now }),
  );
  changes = mergeChanges(changes, messageOf(snap, null, 'subAccepted', { absenceId: absence.id, personId: input.personId }));
  return { changes, outcome: 'accepted' };
}

export function expireRequests(snap: Snapshot, ctx: Ctx): Changes {
  const expired = snap.subRequests.filter((r) => r.status === 'sent' && r.expiresAt.getTime() <= ctx.now.getTime());
  const closed = new Set(expired.map((r) => r.id));
  let changes = emptyChanges();
  for (const r of expired) changes = mergeChanges(changes, upsertOf('subRequests', { ...r, status: 'expired' }));
  for (const absenceId of new Set(expired.map((r) => r.absenceId))) {
    const absence = snap.absences.find((a) => a.id === absenceId);
    if (absence?.status === 'in-progress') changes = mergeChanges(changes, failIfNoneSent(snap, absence, closed));
  }
  return changes;
}
