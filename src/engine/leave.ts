import { reportAbsence } from './absence';
import { regularShift } from './calendar';
import { addDays } from './dates';
import { seoulDate } from './time';
import {
  emptyChanges,
  EngineError,
  mergeChanges,
  type Changes,
  type Ctx,
  type DateStr,
  type LeaveRequest,
  type Snapshot,
} from './types';

function findLeave(snap: Snapshot, leaveId: string): LeaveRequest {
  const leave = snap.leaves.find((l) => l.id === leaveId);
  if (!leave) throw new EngineError('BAD_INPUT', `leave ${leaveId} not found`);
  return leave;
}

function leaveChanges(row: LeaveRequest): Changes {
  const c = emptyChanges();
  c.upsert.leaves = [row];
  return c;
}

function pushTo(snap: Snapshot, c: Changes, personId: string, bodyKey: string, date: DateStr): Changes {
  c.messages.push({ companyId: snap.companyId, personId, bodyKey, params: { date }, channel: 'push' });
  return c;
}

export function requestLeave(snap: Snapshot, input: { personId: string; date: DateStr; kind?: string }, ctx: Ctx): Changes {
  const today = seoulDate(ctx.now);
  if (input.date < addDays(today, 1) || input.date > addDays(today, 14)) throw new EngineError('OUT_OF_RANGE');
  const open = (l: LeaveRequest) =>
    l.personId === input.personId && l.date === input.date && (l.status === 'pending' || l.status === 'approved');
  if (snap.leaves.some(open)) return emptyChanges();
  return leaveChanges({
    id: ctx.newId(),
    companyId: snap.companyId,
    personId: input.personId,
    date: input.date,
    kind: input.kind ?? 'leave',
    status: 'pending',
    createdAt: ctx.now,
    decidedAt: null,
  });
}

export function cancelLeave(snap: Snapshot, input: { leaveId: string; personId: string }, ctx: Ctx): Changes {
  const leave = findLeave(snap, input.leaveId);
  if (leave.personId !== input.personId) throw new EngineError('FORBIDDEN');
  if (leave.status !== 'pending') throw new EngineError('BAD_STATE');
  return leaveChanges({ ...leave, status: 'cancelled', decidedAt: ctx.now });
}

/** Absence implied by an approved leave: only on a regular working day. */
function leaveAbsence(snap: Snapshot, leave: LeaveRequest, ctx: Ctx): Changes {
  const person = snap.persons.find((p) => p.id === leave.personId);
  const factory = snap.factories.find((f) => f.id === person?.factoryId);
  if (!person || !factory) return emptyChanges();
  const shift = regularShift(person, factory, leave.date);
  if (shift === 'off') return emptyChanges();
  return reportAbsence(snap, { personId: person.id, date: leave.date, shift, kind: 'leave', reportedBy: 'support' }, ctx);
}

export function decideLeave(snap: Snapshot, input: { leaveId: string; approve: boolean }, ctx: Ctx): Changes {
  const leave = findLeave(snap, input.leaveId);
  if (leave.status !== 'pending') throw new EngineError('BAD_STATE');
  if (!input.approve) {
    const rejected = leaveChanges({ ...leave, status: 'rejected', decidedAt: ctx.now });
    return pushTo(snap, rejected, leave.personId, 'leaveRejected', leave.date);
  }
  const approved = leaveChanges({ ...leave, status: 'approved', decidedAt: ctx.now });
  pushTo(snap, approved, leave.personId, 'leaveApproved', leave.date);
  return mergeChanges(approved, leaveAbsence(snap, leave, ctx));
}
