import type { DateStr } from './types';

const MS_DAY = 86_400_000;

function toDays(d: DateStr): number {
  const [y, m, day] = d.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, day) / MS_DAY);
}

function fromDays(n: number): DateStr {
  return new Date(n * MS_DAY).toISOString().slice(0, 10);
}

export function addDays(d: DateStr, n: number): DateStr {
  return fromDays(toDays(d) + n);
}

/** a − b in days */
export function diffDays(a: DateStr, b: DateStr): number {
  return toDays(a) - toDays(b);
}

/** 0 = Sunday */
export function dow(d: DateStr): number {
  return (((toDays(d) + 4) % 7) + 7) % 7; // 1970-01-01 was Thursday
}

/** Monday of the week containing d */
export function weekStart(d: DateStr): DateStr {
  return addDays(d, -((dow(d) + 6) % 7));
}
