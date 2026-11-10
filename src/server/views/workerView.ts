import { regularShift } from '@/engine/calendar';
import { addDays } from '@/engine/dates';
import { currentShift, hasShiftStarted, seoulDate } from '@/engine/time';
import type { Absence, Assignment, DateStr, Shift, ShiftOrOff, Snapshot } from '@/engine/types';
import { monthlyRecord, type MonthlyRecord } from './monthlyRecord';

export type ShiftCard = {
  date: DateStr;
  shift: ShiftOrOff;
  start?: string;
  end?: string;
  factoryName?: string;
  postName?: string;
};

export type WorkerView = {
  me: { name: string; empNo: string; lang: string; factoryName: string };
  /** Seoul calendar date of `now` (differs from `today.date` during a night shift after midnight). */
  calendarDate: DateStr;
  today: ShiftCard;
  tomorrow: ShiftCard;
  canReportAbsence: boolean;
  myAbsence: { id: string; status: Absence['status']; reportedBy: Absence['reportedBy'] } | null;
  request: { id: string; date: DateStr; shift: Shift; factoryName: string; postName: string; expiresAt: string } | null;
  requestOutcome: 'takenByOther' | null;
  leaves: { id: string; date: DateStr; status: string }[];
  month: MonthlyRecord;
};

const DAY_MS = 86_400_000;

/**
 * Pure worker home view model. It carries only the viewer's own data: no other person's name, phone or id
 * ever enters the result (a sub request exposes just the slot: date, shift, factory, post).
 */
export function workerView(snap: Snapshot, personId: string, now: Date): WorkerView {
  const person = snap.persons.find((p) => p.id === personId);
  if (!person) throw new Error(`person ${personId} not in snapshot`);
  const factory = snap.factories.find((f) => f.id === person.factoryId);
  if (!factory) throw new Error(`factory ${person.factoryId} not in snapshot`);

  const { shiftDayStart: dayStart, shiftNightStart: nightStart } = snap.settings;
  const mine = snap.assignments.filter((a) => a.personId === personId);
  const factoryName = (id: string) => snap.factories.find((f) => f.id === id)?.name ?? factory.name;
  const postName = (id: string) => snap.posts.find((p) => p.id === id)?.name;

  const card = (date: DateStr, shift: ShiftOrOff, a?: Assignment): ShiftCard => {
    if (shift === 'off') return { date, shift };
    const out: ShiftCard = {
      date,
      shift,
      start: shift === 'day' ? dayStart : nightStart,
      end: shift === 'day' ? nightStart : dayStart,
      factoryName: a ? factoryName(a.factoryId) : factory.name,
    };
    if (a) out.postName = postName(a.postId);
    return out;
  };
  /** The assignment of that day if any, else the regular shift. */
  const dayCard = (date: DateStr): ShiftCard => {
    const a = mine.find((x) => x.date === date);
    return a ? card(date, a.shift, a) : card(date, regularShift(person, factory, date));
  };

  const cur = currentShift(now, snap.settings);
  const curAssignment = mine.find((a) => a.date === cur.date && a.shift === cur.shift);
  const today =
    curAssignment || regularShift(person, factory, cur.date) === cur.shift
      ? card(cur.date, cur.shift, curAssignment)
      : dayCard(seoulDate(now));
  const tomorrow = dayCard(addDays(today.date, 1));

  const active = (date: DateStr, shift: Shift) =>
    snap.absences.find((a) => a.personId === personId && a.date === date && a.shift === shift && a.status !== 'cancelled');
  const absence = today.shift === 'off' ? undefined : active(today.date, today.shift);
  const canReportAbsence =
    today.shift !== 'off' && !absence && !hasShiftStarted(now, today.date, today.shift, snap.settings);

  const mineReq = snap.subRequests
    .filter((r) => r.personId === personId)
    .sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime());
  const open = mineReq.find((r) => r.status === 'sent' && r.expiresAt.getTime() > now.getTime());
  const openAbsence = open ? snap.absences.find((a) => a.id === open.absenceId) : undefined;
  const request =
    open && openAbsence
      ? {
          id: open.id,
          date: openAbsence.date,
          shift: openAbsence.shift,
          factoryName: factoryName(openAbsence.factoryId),
          postName: (openAbsence.postId && postName(openAbsence.postId)) || '',
          expiresAt: open.expiresAt.toISOString(),
        }
      : null;

  const latest = mineReq[0];
  const latestAbsence = latest ? snap.absences.find((a) => a.id === latest.absenceId) : undefined;
  const requestOutcome =
    !request &&
    latest?.status === 'cancelled' &&
    now.getTime() - latest.sentAt.getTime() <= DAY_MS &&
    latestAbsence?.status === 'resolved' &&
    latestAbsence.resolvedPersonId !== personId
      ? ('takenByOther' as const)
      : null;

  const todayDate = seoulDate(now);
  return {
    me: { name: person.name, empNo: person.empNo, lang: person.lang, factoryName: factory.name },
    calendarDate: todayDate,
    today,
    tomorrow,
    canReportAbsence,
    myAbsence: absence ? { id: absence.id, status: absence.status, reportedBy: absence.reportedBy } : null,
    request,
    requestOutcome,
    leaves: snap.leaves
      .filter((l) => l.personId === personId && l.date >= todayDate)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
      .map((l) => ({ id: l.id, date: l.date, status: l.status })),
    month: monthlyRecord(snap, personId, todayDate.slice(0, 7), todayDate),
  };
}
