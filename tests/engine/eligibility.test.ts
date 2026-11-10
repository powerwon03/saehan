import { describe, expect, test } from 'vitest';
import { addDays } from '@/engine/dates';
import { crewShift } from '@/engine/calendar';
import { canWorkExtra } from '@/engine/eligibility';
import { isOff, recentSubCount, shiftsWorked, weekHours } from '@/engine/worklog';
import { EngineError } from '@/engine/types';
import type { Absence, Assignment, DateStr, LeaveRequest, Shift, Snapshot } from '@/engine/types';
import { COMPANY, makePerson, makeSnapshot } from '../helpers/fixtures';

const BASE = '2025-04-27';
const A = makePerson({ id: 'pa', crew: 'A' });
const D = makePerson({ id: 'pd', crew: 'D' });

function asg(personId: string, date: DateStr, shift: Shift, source: Assignment['source'] = 'sub'): Assignment {
  return {
    id: `${personId}-${date}-${shift}`,
    companyId: COMPANY,
    date,
    shift,
    factoryId: 'f1',
    postId: 'post1',
    personId,
    source,
    locked: false,
    reason: null,
    flags: [],
    createdAt: new Date('2026-11-01T00:00:00Z'),
  };
}

function leave(personId: string, date: DateStr, status: LeaveRequest['status']): LeaveRequest {
  return { id: `l-${date}-${status}`, companyId: COMPANY, personId, date, kind: 'annual', status, createdAt: new Date(), decidedAt: null };
}

function absence(personId: string, date: DateStr, status: Absence['status']): Absence {
  return {
    id: `a-${date}-${status}`,
    companyId: COMPANY,
    date,
    shift: 'day',
    factoryId: 'f1',
    personId,
    postId: null,
    kind: 'absent',
    reportedBy: 'self',
    reason: null,
    status,
    resolvedPersonId: null,
    round: 0,
    restore: null,
    createdAt: new Date(),
    resolvedAt: null,
  };
}

function snap(over: Partial<Snapshot> = {}): Snapshot {
  return makeSnapshot({ persons: [A, D], ...over });
}

/** first date from 2026-11-01 where A crew's (prev, cur, next) shifts satisfy pred */
function findA(pred: (prev: string, cur: string, next: string) => boolean): DateStr {
  const s = (x: DateStr) => crewShift(BASE, 'A', x);
  for (let i = 0; i < 40; i++) {
    const d = addDays('2026-11-01', i);
    if (pred(s(addDays(d, -1)), s(d), s(addDays(d, 1)))) return d;
  }
  throw new Error('no date');
}

describe('canWorkExtra', () => {
  test('재직 안 함 → INACTIVE', () => {
    const s = snap({ persons: [makePerson({ id: 'pa', crew: 'A', active: false })] });
    expect(canWorkExtra(s, 'pa', '2026-11-10', 'day')).toEqual({ ok: false, reason: 'INACTIVE' });
  });

  test('그날 approved 휴무 → OFF_OR_ABSENT; pending 휴무는 통과', () => {
    const date = findA((_, cur) => cur === 'off');
    const approved = snap({ leaves: [leave('pa', date, 'approved')] });
    expect(canWorkExtra(approved, 'pa', date, 'day')).toEqual({ ok: false, reason: 'OFF_OR_ABSENT' });
    const pending = snap({ leaves: [leave('pa', date, 'pending')] });
    expect(canWorkExtra(pending, 'pa', date, 'day').ok).toBe(true);
  });

  test('취소되지 않은 결근은 OFF_OR_ABSENT, 취소된 결근은 통과', () => {
    const date = findA((prev, cur) => cur === 'off' && prev !== 'night');
    expect(canWorkExtra(snap({ absences: [absence('pa', date, 'decided')] }), 'pa', date, 'day')).toEqual({
      ok: false,
      reason: 'OFF_OR_ABSENT',
    });
    expect(canWorkExtra(snap({ absences: [absence('pa', date, 'cancelled')] }), 'pa', date, 'day').ok).toBe(true);
  });

  test('같은 날 주간 배치가 있으면 야간 추가 → ALREADY_WORKING', () => {
    const date = findA((_, cur) => cur === 'off');
    const s = snap({ assignments: [asg('pa', date, 'day')] });
    expect(canWorkExtra(s, 'pa', date, 'night')).toEqual({ ok: false, reason: 'ALREADY_WORKING' });
  });

  test('정규 교대와 같은 교대 → ALREADY_WORKING', () => {
    const date = findA((_, cur) => cur === 'day');
    expect(canWorkExtra(snap(), 'pa', date, 'day')).toEqual({ ok: false, reason: 'ALREADY_WORKING' });
  });

  test('전날 야간 근무자가 오늘 주간 → NIGHT_BEFORE_DAY', () => {
    const date = findA((prev, cur) => prev === 'night' && cur === 'off');
    expect(canWorkExtra(snap(), 'pa', date, 'day')).toEqual({ ok: false, reason: 'NIGHT_BEFORE_DAY' });
  });

  test('오늘 야간 후보가 내일 정규 주간 → DAY_AFTER_NIGHT', () => {
    const date = findA((_, cur, next) => cur === 'off' && next === 'day');
    expect(canWorkExtra(snap(), 'pa', date, 'night')).toEqual({ ok: false, reason: 'DAY_AFTER_NIGHT' });
  });

  test('이번 주 6교대(48h) + 8 = 56 > 52 → WEEK_HOURS; 5교대(40h)+8=48 → ok', () => {
    // D조: 2026-11-09(월)~13(금) 주간 5교대. 토 14일 추가 배치 → 6교대
    const six = snap({ assignments: [asg('pd', '2026-11-14', 'day')] });
    expect(weekHours(six, 'pd', '2026-11-15')).toBe(48);
    expect(canWorkExtra(six, 'pd', '2026-11-15', 'day')).toEqual({ ok: false, reason: 'WEEK_HOURS' });
    const five = snap();
    expect(weekHours(five, 'pd', '2026-11-14')).toBe(40);
    expect(canWorkExtra(five, 'pd', '2026-11-14', 'day')).toEqual({ ok: true });
  });

  test('maxWeekHours 설정을 쓴다 (정확히 max면 통과)', () => {
    const base = snap();
    const at48 = { ...base, settings: { ...base.settings, maxWeekHours: 48 } };
    expect(canWorkExtra(at48, 'pd', '2026-11-14', 'day')).toEqual({ ok: true });
    const at47 = { ...base, settings: { ...base.settings, maxWeekHours: 47 } };
    expect(canWorkExtra(at47, 'pd', '2026-11-14', 'day')).toEqual({ ok: false, reason: 'WEEK_HOURS' });
  });

  test('검사 순서: INACTIVE가 가장 먼저', () => {
    const s = snap({
      persons: [makePerson({ id: 'pa', crew: 'A', active: false })],
      leaves: [leave('pa', '2026-11-10', 'approved')],
    });
    expect(canWorkExtra(s, 'pa', '2026-11-10', 'day')).toEqual({ ok: false, reason: 'INACTIVE' });
  });
});

describe('worklog', () => {
  test('일요일 야간은 그 주(월~일)에 센다', () => {
    const s = snap({ assignments: [asg('pd', '2026-11-15', 'night')] });
    expect(weekHours(s, 'pd', '2026-11-15')).toBe(48);
    expect(weekHours(s, 'pd', '2026-11-09')).toBe(48);
    expect(weekHours(s, 'pd', '2026-11-16')).toBe(40);
  });

  test('shiftsWorked: 정규 ∪ 배치, 중복 제거', () => {
    const s = snap({ assignments: [asg('pd', '2026-11-09', 'day'), asg('pd', '2026-11-14', 'night')] });
    const w = shiftsWorked(s, 'pd', '2026-11-09', '2026-11-15');
    expect(w).toHaveLength(6);
    expect(w).toContainEqual({ date: '2026-11-14', shift: 'night' });
    expect(w.filter((x) => x.date === '2026-11-09')).toHaveLength(1);
  });

  test('휴무·결근이 있는 날은 정규 교대로 세지 않고, 취소된 결근은 센다', () => {
    const s = snap({
      leaves: [leave('pd', '2026-11-09', 'approved'), leave('pd', '2026-11-10', 'pending')],
      absences: [absence('pd', '2026-11-11', 'resolved'), absence('pd', '2026-11-12', 'cancelled')],
    });
    const dates = shiftsWorked(s, 'pd', '2026-11-09', '2026-11-13').map((x) => x.date);
    expect(dates).toEqual(['2026-11-10', '2026-11-12', '2026-11-13']);
    expect(isOff(s, 'pd', '2026-11-09')).toBe(true);
    expect(isOff(s, 'pd', '2026-11-10')).toBe(false);
    expect(isOff(s, 'pd', '2026-11-11')).toBe(true);
    expect(isOff(s, 'pd', '2026-11-12')).toBe(false);
  });

  test('recentSubCount: sub·manual만, date−30 ~ date−1', () => {
    const d = '2026-11-10';
    const s = snap({
      assignments: [
        asg('pd', '2026-10-11', 'day', 'sub'), // d-30 포함
        asg('pd', '2026-10-10', 'day', 'sub'), // d-31 제외
        asg('pd', '2026-11-09', 'night', 'manual'),
        asg('pd', '2026-11-10', 'day', 'sub'), // 당일 제외
        asg('pd', '2026-11-05', 'day', 'auto'),
        asg('pd', '2026-11-06', 'day', 'move'),
        asg('pa', '2026-11-05', 'day', 'sub'),
      ],
    });
    expect(recentSubCount(s, 'pd', d)).toBe(2);
    expect(recentSubCount(s, 'pd', d, 5)).toBe(1);
  });

  test('공장이 snapshot에 없는 사람은 DATA_INTEGRITY로 실패한다', () => {
    const s = snap({ persons: [makePerson({ id: 'px', crew: 'A', factoryId: 'missing' })] });
    expect(() => shiftsWorked(s, 'px', '2026-11-09', '2026-11-15')).toThrow(EngineError);
    expect(() => shiftsWorked(s, 'px', '2026-11-09', '2026-11-15')).toThrow(
      expect.objectContaining({ code: 'DATA_INTEGRITY' }),
    );
    expect(() => canWorkExtra(s, 'px', '2026-11-10', 'day')).toThrow(
      expect.objectContaining({ code: 'DATA_INTEGRITY' }),
    );
  });

  test('없는 personId는 빈 결과', () => {
    expect(shiftsWorked(snap(), 'nobody', '2026-11-09', '2026-11-15')).toEqual([]);
    expect(weekHours(snap(), 'nobody', '2026-11-09')).toBe(0);
  });
});
