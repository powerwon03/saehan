import { describe, expect, test } from 'vitest';
import { seoulDateTime } from '@/components/admin/common/format';

describe('seoulDateTime', () => {
  test('UTC 시각을 서울 MM/DD HH:mm 으로 (날짜 넘어감 포함)', () => {
    expect(seoulDateTime('2026-11-10T03:05:00.000Z')).toBe('11/10 12:05');
    expect(seoulDateTime('2026-11-10T16:30:00.000Z')).toBe('11/11 01:30');
    expect(seoulDateTime('2026-12-31T15:00:00Z')).toBe('01/01 00:00');
  });
  test('읽을 수 없으면 빈 글자', () => {
    expect(seoulDateTime('nope')).toBe('');
  });
});
