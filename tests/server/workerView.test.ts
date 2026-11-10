import { describe, expect, test } from 'vitest';
import { workerView } from '@/server/views/workerView';
import { makePerson, makeSnapshot } from '../helpers/fixtures';

describe('workerView calendarDate', () => {
  // 1공장 base 2025-04-27: A조 2025-05-03 is a night shift (cycle position 6)
  const snap = makeSnapshot({ persons: [makePerson({ crew: 'A' })] });

  test('야간 근무 중 02:00 KST: today는 어제 야간, calendarDate는 달력 날짜', () => {
    const v = workerView(snap, 'p1', new Date('2025-05-03T17:00:00Z')); // 2025-05-04 02:00 KST
    expect(v.today).toMatchObject({ date: '2025-05-03', shift: 'night' });
    expect(v.calendarDate).toBe('2025-05-04');
  });

  test('낮에는 두 날짜가 같다', () => {
    const v = workerView(snap, 'p1', new Date('2025-05-04T03:00:00Z')); // 2025-05-04 12:00 KST
    expect(v.today.date).toBe('2025-05-04');
    expect(v.calendarDate).toBe('2025-05-04');
  });
});
