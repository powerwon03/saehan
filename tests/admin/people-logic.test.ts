import { describe, expect, test } from 'vitest';
import { createPayload, emptyForm, formFromPerson, isLocked, patchPayload, type PersonRow } from '@/components/admin/people/logic';

const person: PersonRow = {
  id: 'p1',
  companyId: 'c1',
  empNo: '1001',
  name: '홍길동',
  affiliation: 'partner',
  crew: 'B',
  role: '포장',
  gender: 'F',
  phone: '010-1234-5678',
  factoryId: 'f1',
  lang: 'vi',
  fixedPostId: 'post1',
  active: true,
  hiredAt: '2025-03-02',
  leftAt: null,
};

describe('person form ↔ payload', () => {
  test('새 사람: 빈 칸은 null, 사번 비우면 서버가 정함', () => {
    const f = { ...emptyForm('f1', ''), name: ' 김철수 ', pin: '482915' };
    expect(createPayload(f)).toEqual({
      name: '김철수',
      affiliation: 'direct',
      crew: 'A',
      role: null,
      gender: null,
      phone: null,
      factoryId: 'f1',
      lang: 'ko',
      fixedPostId: null,
      hiredAt: null,
      pin: '482915',
    });
    expect(createPayload({ ...f, empNo: ' 1002 ' }).empNo).toBe('1002');
  });

  test('수정: 사람 → 폼 → PATCH는 PIN 없이 같은 값', () => {
    const f = formFromPerson(person);
    expect(f.pin).toBe('');
    expect(patchPayload(f)).toEqual({
      empNo: '1001',
      name: '홍길동',
      affiliation: 'partner',
      crew: 'B',
      role: '포장',
      gender: 'F',
      phone: '010-1234-5678',
      factoryId: 'f1',
      lang: 'vi',
      fixedPostId: 'post1',
      hiredAt: '2025-03-02',
    });
  });

  test('수정에서 지운 칸은 null로 보냄', () => {
    const f = { ...formFromPerson(person), role: ' ', gender: '' as const, phone: '', fixedPostId: '', hiredAt: '' };
    expect(patchPayload(f)).toMatchObject({ role: null, gender: null, phone: null, fixedPostId: null, hiredAt: null });
  });
});

describe('isLocked', () => {
  const now = new Date('2026-11-10T03:00:00Z');
  test('잠금 시각이 미래면 잠김', () => {
    expect(isLocked({ lockedUntil: '2026-11-10T03:05:00.000Z' }, now)).toBe(true);
    expect(isLocked({ lockedUntil: '2026-11-10T02:59:00.000Z' }, now)).toBe(false);
    expect(isLocked({ lockedUntil: null }, now)).toBe(false);
    expect(isLocked(undefined, now)).toBe(false);
  });
});
