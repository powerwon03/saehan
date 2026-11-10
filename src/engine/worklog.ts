import { regularShift } from './calendar';
import { addDays, diffDays, weekStart } from './dates';
import { EngineError, type DateStr, type Shift, type Snapshot } from './types';

/** 취소되지 않은 결근 또는 승인된 휴무가 있는 날 */
export function isOff(snap: Snapshot, personId: string, date: DateStr): boolean {
  return (
    snap.absences.some((a) => a.personId === personId && a.date === date && a.status !== 'cancelled') ||
    snap.leaves.some((l) => l.personId === personId && l.date === date && l.status === 'approved')
  );
}

/** 정규 교대(쉬는 날 제외) ∪ 배치 행, (date, shift) 중복 제거. from~to 포함, 날짜·교대 순. */
export function shiftsWorked(
  snap: Snapshot,
  personId: string,
  from: DateStr,
  to: DateStr,
): { date: DateStr; shift: Shift }[] {
  const seen = new Set<string>();
  const out: { date: DateStr; shift: Shift }[] = [];
  const add = (date: DateStr, shift: Shift) => {
    const key = `${date}|${shift}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ date, shift });
  };

  const person = snap.persons.find((p) => p.id === personId);
  const factory = person ? snap.factories.find((f) => f.id === person.factoryId) : undefined;
  if (person && !factory) {
    throw new EngineError('DATA_INTEGRITY', `factory ${person.factoryId} not found for person ${personId}`);
  }
  if (person && factory) {
    for (let d = from; diffDays(to, d) >= 0; d = addDays(d, 1)) {
      const s = regularShift(person, factory, d);
      if (s !== 'off' && !isOff(snap, personId, d)) add(d, s);
    }
  }
  for (const a of snap.assignments) {
    if (a.personId === personId && a.date >= from && a.date <= to) add(a.date, a.shift);
  }
  return out.sort((x, y) => (x.date === y.date ? (x.shift === 'day' ? -1 : 1) : x.date < y.date ? -1 : 1));
}

/** date가 속한 월~일 주의 근무 시간 (미래 예정 포함) */
export function weekHours(snap: Snapshot, personId: string, date: DateStr): number {
  const start = weekStart(date);
  return shiftsWorked(snap, personId, start, addDays(start, 6)).length * snap.settings.shiftCreditHours;
}

/** date−days ~ date−1 사이 sub·manual 배치 수 */
export function recentSubCount(snap: Snapshot, personId: string, date: DateStr, days = 30): number {
  const from = addDays(date, -days);
  const to = addDays(date, -1);
  return snap.assignments.filter(
    (a) =>
      a.personId === personId &&
      (a.source === 'sub' || a.source === 'manual') &&
      a.date >= from &&
      a.date <= to,
  ).length;
}
