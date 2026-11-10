import { expect, test } from 'vitest';
import { currentShift, hasShiftStarted, seoulDate, shiftWindow } from '@/engine/time';
import { makeSettings } from '../helpers/fixtures';

const s = makeSettings();

test('서울 날짜', () => expect(seoulDate(new Date('2026-11-09T16:30:00Z'))).toBe('2026-11-10'));

test('주간 창은 07:00~19:00 KST', () => {
  const w = shiftWindow('2026-11-10', 'day', s);
  expect(w.start.toISOString()).toBe('2026-11-09T22:00:00.000Z');
  expect(w.end.toISOString()).toBe('2026-11-10T10:00:00.000Z');
});

test('야간 창은 19:00~다음날 07:00 KST', () => {
  const w = shiftWindow('2026-11-10', 'night', s);
  expect(w.start.toISOString()).toBe('2026-11-10T10:00:00.000Z');
  expect(w.end.toISOString()).toBe('2026-11-10T22:00:00.000Z');
});

// 2026-11-11 02:00 KST = 2026-11-10T17:00Z
test('02:00 KST의 현재 교대는 전날 야간', () =>
  expect(currentShift(new Date('2026-11-10T17:00:00Z'), s)).toEqual({ date: '2026-11-10', shift: 'night' }));

test('낮 시간의 현재 교대는 당일 주간', () =>
  expect(currentShift(new Date('2026-11-10T03:00:00Z'), s)).toEqual({ date: '2026-11-10', shift: 'day' }));

test('06:59 KST 주간 미시작, 07:00 시작', () => {
  expect(hasShiftStarted(new Date('2026-11-10T21:59:00Z'), '2026-11-11', 'day', s)).toBe(false);
  expect(hasShiftStarted(new Date('2026-11-10T22:00:00Z'), '2026-11-11', 'day', s)).toBe(true);
});

test('설정값을 따른다', () => {
  const s2 = makeSettings({ shiftDayStart: '06:30' });
  expect(shiftWindow('2026-11-10', 'day', s2).start.toISOString()).toBe('2026-11-09T21:30:00.000Z');
});
