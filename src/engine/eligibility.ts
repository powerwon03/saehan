import { addDays } from './dates';
import type { DateStr, Shift, Snapshot } from './types';
import { isOff, shiftsWorked, weekHours } from './worklog';

export type IneligibleReason =
  | 'INACTIVE'
  | 'OFF_OR_ABSENT'
  | 'ALREADY_WORKING'
  | 'NIGHT_BEFORE_DAY'
  | 'DAY_AFTER_NIGHT'
  | 'WEEK_HOURS';

export type Eligibility = { ok: true } | { ok: false; reason: IneligibleReason };

const no = (reason: IneligibleReason): Eligibility => ({ ok: false, reason });

/** 대체 근무 가능 판단. 첫 번째로 걸린 사유를 돌려준다. */
export function canWorkExtra(snap: Snapshot, personId: string, date: DateStr, shift: Shift): Eligibility {
  const person = snap.persons.find((p) => p.id === personId);
  if (!person || !person.active) return no('INACTIVE');
  if (isOff(snap, personId, date)) return no('OFF_OR_ABSENT');
  if (shiftsWorked(snap, personId, date, date).length > 0) return no('ALREADY_WORKING');

  if (shift === 'day') {
    const prev = addDays(date, -1);
    if (shiftsWorked(snap, personId, prev, prev).some((w) => w.shift === 'night')) return no('NIGHT_BEFORE_DAY');
  } else {
    const next = addDays(date, 1);
    if (shiftsWorked(snap, personId, next, next).some((w) => w.shift === 'day')) return no('DAY_AFTER_NIGHT');
  }

  const credit = snap.settings.shiftCreditHours;
  if (weekHours(snap, personId, date) + credit > snap.settings.maxWeekHours) return no('WEEK_HOURS');
  return { ok: true };
}
