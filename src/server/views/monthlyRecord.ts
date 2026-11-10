import { addDays } from '@/engine/dates';
import { shiftsWorked } from '@/engine/worklog';
import type { DateStr, Snapshot } from '@/engine/types';

export type MonthlyRecord = {
  workDays: number;
  dayCount: number;
  nightCount: number;
  hours: number;
  subCount: number;
  missedDays: number;
};

function monthRange(month: string): { first: DateStr; last: DateStr } {
  const [y, m] = month.split('-').map(Number);
  const first = `${month}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { first, last: addDays(first, lastDay - 1) };
}

/** One person's record for `month` ('YYYY-MM'), counting only dates up to and including `today`. */
export function monthlyRecord(snap: Snapshot, personId: string, month: string, today: DateStr): MonthlyRecord {
  const { first, last } = monthRange(month);
  const to = today < last ? today : last;
  const empty: MonthlyRecord = { workDays: 0, dayCount: 0, nightCount: 0, hours: 0, subCount: 0, missedDays: 0 };
  if (to < first) return empty;

  const worked = shiftsWorked(snap, personId, first, to);
  const inRange = (d: DateStr) => d >= first && d <= to;
  const dayCount = worked.filter((w) => w.shift === 'day').length;
  return {
    workDays: new Set(worked.map((w) => w.date)).size,
    dayCount,
    nightCount: worked.length - dayCount,
    hours: worked.length * snap.settings.shiftCreditHours,
    subCount: snap.assignments.filter((a) => a.personId === personId && a.source === 'sub' && inRange(a.date)).length,
    missedDays: new Set(
      snap.absences.filter((a) => a.personId === personId && a.status !== 'cancelled' && inRange(a.date)).map((a) => a.date),
    ).size,
  };
}
