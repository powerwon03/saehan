import { addDays } from './dates';
import type { DateStr, Settings, Shift } from './types';

const KST_MS = 9 * 3_600_000;

export function seoulDate(now: Date): DateStr {
  return new Date(now.getTime() + KST_MS).toISOString().slice(0, 10);
}

/** KST wall-clock "YYYY-MM-DD" + "HH:MM" -> absolute Date */
function kst(date: DateStr, hhmm: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh, mm) - KST_MS);
}

export function shiftWindow(date: DateStr, shift: Shift, settings: Settings): { start: Date; end: Date } {
  if (shift === 'day') {
    return { start: kst(date, settings.shiftDayStart), end: kst(date, settings.shiftNightStart) };
  }
  return { start: kst(date, settings.shiftNightStart), end: kst(addDays(date, 1), settings.shiftDayStart) };
}

export function hasShiftStarted(now: Date, date: DateStr, shift: Shift, settings: Settings): boolean {
  return now.getTime() >= shiftWindow(date, shift, settings).start.getTime();
}

/** The shift in progress now; between shifts (if any) it is the most recently started one. */
export function currentShift(now: Date, settings: Settings): { date: DateStr; shift: Shift } {
  const today = seoulDate(now);
  if (hasShiftStarted(now, today, 'night', settings)) return { date: today, shift: 'night' };
  if (hasShiftStarted(now, today, 'day', settings)) return { date: today, shift: 'day' };
  return { date: addDays(today, -1), shift: 'night' };
}
