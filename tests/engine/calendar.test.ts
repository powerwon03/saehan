import { describe, expect, test } from 'vitest';
import { addDays, diffDays, dow, weekStart } from '@/engine/dates';
import { crewShift, crewsOn, regularShift } from '@/engine/calendar';
import { makeFactory, makePerson } from '../helpers/fixtures';

const BASE = '2025-04-27';

test('A조는 기준일부터 주간4·휴무2·야간4·휴무2', () => {
  const seq = Array.from({ length: 12 }, (_, i) => crewShift(BASE, 'A', addDays(BASE, i)));
  expect(seq).toEqual(['day', 'day', 'day', 'day', 'off', 'off', 'night', 'night', 'night', 'night', 'off', 'off']);
});

test('매일 주간·야간·휴무 각 1개 조 (기준일 전후 400일)', () => {
  for (let i = -200; i < 200; i++) {
    const d = addDays(BASE, i);
    const s = (['A', 'B', 'C'] as const).map((c) => crewShift(BASE, c, d)).sort();
    expect(s).toEqual(['day', 'night', 'off']);
  }
});

test('야간 바로 다음 날 주간이 되는 조는 없다', () => {
  for (const c of ['A', 'B', 'C'] as const) {
    for (let i = -200; i < 200; i++) {
      const d = addDays(BASE, i);
      if (crewShift(BASE, c, d) === 'night') expect(crewShift(BASE, c, addDays(d, 1))).not.toBe('day');
    }
  }
});

test('2공장(기준일 하루 늦음)은 1공장의 전날 패턴', () => {
  expect(crewShift('2025-04-28', 'A', '2025-05-01')).toBe(crewShift(BASE, 'A', '2025-04-30'));
});

test('주간조 D는 평일 주간, 주말 휴무', () => {
  expect(crewShift(BASE, 'D', '2026-11-09')).toBe('day'); // 월
  expect(crewShift(BASE, 'D', '2026-11-08')).toBe('off'); // 일
  expect(crewShift(BASE, 'D', '2026-11-14')).toBe('off'); // 토
  expect(crewShift(BASE, 'D', '2026-11-13')).toBe('day'); // 금
});

test('crewsOn은 주간·야간·휴무 조를 돌려준다', () => {
  expect(crewsOn(BASE, BASE)).toEqual({ day: 'A', night: 'B', off: 'C' });
});

test('regularShift는 사람의 조와 공장 기준일을 쓴다', () => {
  const f = makeFactory({ cycleBaseDate: BASE });
  expect(regularShift(makePerson({ crew: 'A' }), f, BASE)).toBe('day');
  expect(regularShift(makePerson({ crew: 'D' }), f, '2026-11-08')).toBe('off');
});

describe('dates', () => {
  test('addDays는 월·연 경계를 넘는다', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2025-12-31', 1)).toBe('2026-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
  test('diffDays는 a−b', () => {
    expect(diffDays('2026-11-10', '2026-11-08')).toBe(2);
    expect(diffDays('2026-11-08', '2026-11-10')).toBe(-2);
  });
  test('dow는 0=일', () => {
    expect(dow('2026-11-08')).toBe(0);
    expect(dow('2026-11-09')).toBe(1);
    expect(dow('2026-11-14')).toBe(6);
  });
  test('weekStart는 월요일', () => {
    expect(weekStart('2026-11-08')).toBe('2026-11-02'); // 일
    expect(weekStart('2026-11-09')).toBe('2026-11-09'); // 월
    expect(weekStart('2026-11-12')).toBe('2026-11-09');
  });
});
