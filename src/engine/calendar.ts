import { dow, diffDays } from './dates';
import type { Crew, DateStr, Factory, Person, ShiftOrOff } from './types';

const OFFSET: Record<'A' | 'B' | 'C', number> = { A: 0, B: 1, C: 2 };

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

function shiftAtPos(pos: number): ShiftOrOff {
  if (pos <= 3) return 'day';
  if (pos >= 6 && pos <= 9) return 'night';
  return 'off';
}

export function crewShift(baseDate: DateStr, crew: Crew, date: DateStr): ShiftOrOff {
  if (crew === 'D') {
    const w = dow(date);
    return w >= 1 && w <= 5 ? 'day' : 'off';
  }
  return shiftAtPos(mod(diffDays(date, baseDate) - OFFSET[crew] * 4, 12));
}

export function regularShift(person: Person, factory: Factory, date: DateStr): ShiftOrOff {
  return crewShift(factory.cycleBaseDate, person.crew, date);
}

export function crewsOn(baseDate: DateStr, date: DateStr): { day: Crew; night: Crew; off: Crew } {
  const out = {} as { day: Crew; night: Crew; off: Crew };
  for (const c of ['A', 'B', 'C'] as const) out[crewShift(baseDate, c, date)] = c;
  return out;
}
