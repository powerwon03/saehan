import { addDays } from '@/engine/dates';
import { shiftsWorked } from '@/engine/worklog';
import { EngineError, type DateStr, type Shift, type Snapshot } from '@/engine/types';
import { toXlsx } from './detect';

/** Day-of-month the snapshot must be loaded around so a whole month fits the −35/+15 day window. */
export const attendanceAround = (month: string): DateStr => `${month}-16`;

export function parseMonth(month: string): { first: DateStr; days: number } {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!m) throw new EngineError('BAD_INPUT', 'month must be YYYY-MM');
  return { first: `${month}-01`, days: new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate() };
}

/**
 * Monthly attendance: persons × days, cell '주'/'야' (worked), '대' (sub placement), '결' (active absence), '휴'.
 * Dates after `today` stay blank (so do dates outside hiredAt..leftAt). `snap` must cover the month
 * (load it around attendanceAround(month)).
 */
export function buildAttendance(snap: Snapshot, month: string, today: DateStr): Buffer {
  const { first, days } = parseMonth(month);
  const last = addDays(first, days - 1);
  const sort = new Map(snap.factories.map((f) => [f.id, f.sort]));
  const people = snap.persons
    .filter((p) => p.active || (p.leftAt !== null && p.leftAt >= first))
    .sort((a, b) => (sort.get(a.factoryId) ?? 0) - (sort.get(b.factoryId) ?? 0) || a.empNo.localeCompare(b.empNo));

  const header: string[] = ['사번', '이름', '공장', '조'];
  for (let d = 1; d <= days; d++) header.push(String(d));
  header.push('주간', '야간', '대체', '결근');
  const aoa: (string | number)[][] = [header];
  const mark: Record<Shift, string> = { day: '주', night: '야' };

  for (const p of people) {
    const worked = new Map(shiftsWorked(snap, p.id, first, last < today ? last : today).map((w) => [w.date, w.shift]));
    const subs = new Map(snap.assignments.filter((a) => a.personId === p.id && a.source === 'sub').map((a) => [a.date, a.shift]));
    const absent = new Set(snap.absences.filter((a) => a.personId === p.id && a.status !== 'cancelled').map((a) => a.date));
    const row: (string | number)[] = [p.empNo, p.name, snap.factories.find((f) => f.id === p.factoryId)?.name ?? '', p.crew];
    const total = { day: 0, night: 0, sub: 0, absent: 0 };
    for (let n = 0; n < days; n++) {
      const date = addDays(first, n);
      if (date > today || (p.hiredAt !== null && date < p.hiredAt) || (p.leftAt !== null && date >= p.leftAt)) {
        row.push('');
        continue;
      }
      let shift: Shift | undefined;
      if (absent.has(date)) {
        row.push('결');
        total.absent++;
      } else if (subs.has(date)) {
        row.push('대');
        total.sub++;
        shift = subs.get(date);
      } else if (worked.has(date)) {
        shift = worked.get(date);
        row.push(mark[shift!]);
      } else row.push('휴');
      if (shift) total[shift]++;
    }
    row.push(total.day, total.night, total.sub, total.absent);
    aoa.push(row);
  }
  return toXlsx(month, aoa);
}
