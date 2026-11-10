import { describe, expect, test } from 'vitest';
import { cellIndex, nextLevel } from '@/components/admin/skills/logic';

describe('nextLevel', () => {
  test('직접 값 0→1→2→3→이력 기준(null)', () => {
    expect(nextLevel({ level: 0, manual: true })).toBe(1);
    expect(nextLevel({ level: 1, manual: true })).toBe(2);
    expect(nextLevel({ level: 2, manual: true })).toBe(3);
    expect(nextLevel({ level: 3, manual: true })).toBeNull();
  });
  test('이력 기준 칸은 보이는 값과 상관없이 직접 0부터', () => {
    expect(nextLevel({ level: 2, manual: false })).toBe(0);
    expect(nextLevel({ level: 0, manual: false })).toBe(0);
  });
  test('칸이 없으면 이력 기준으로 보고 0', () => {
    expect(nextLevel(undefined)).toBe(0);
  });
});

describe('cellIndex', () => {
  test('사람·자리로 칸을 찾는다', () => {
    const cells = [
      { personId: 'p1', postId: 'a', level: 2 as const, manual: true },
      { personId: 'p1', postId: 'b', level: 0 as const, manual: false },
    ];
    const at = cellIndex(cells);
    expect(at('p1', 'a')).toBe(cells[0]);
    expect(at('p1', 'b')).toBe(cells[1]);
    expect(at('p2', 'a')).toBeUndefined();
  });
});
