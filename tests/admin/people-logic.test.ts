import { describe, expect, test } from 'vitest';
import { createPayload, emptyForm, formFromPerson, isLocked, patchPayload, type PersonRow } from '@/components/admin/people/logic';
import { randomPin, strongEnough } from '@/lib/personRules';

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

  test('수정: 바꾼 칸만 PATCH로 보낸다 (안 바꾼 언어는 절대 보내지 않음)', () => {
    const f = formFromPerson(person);
    expect(f.pin).toBe('');
    expect(patchPayload(f, person)).toEqual({});
    expect(patchPayload({ ...f, name: ' 홍길순 ', crew: 'C' }, person)).toEqual({ name: '홍길순', crew: 'C' });
    expect(patchPayload({ ...f, lang: 'en' }, person)).toEqual({ lang: 'en' });
    expect(patchPayload({ ...f, empNo: ' 1009 ' }, person)).toEqual({ empNo: '1009' });
    expect(patchPayload({ ...f, factoryId: 'f2', fixedPostId: '' }, person)).toEqual({ factoryId: 'f2', fixedPostId: null });
  });

  test('수정에서 지운 칸은 null로 보냄', () => {
    const f = { ...formFromPerson(person), role: ' ', gender: '' as const, phone: '', fixedPostId: '', hiredAt: '' };
    expect(patchPayload(f, person)).toEqual({ role: null, gender: null, phone: null, fixedPostId: null, hiredAt: null });
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

describe('randomPin', () => {
  test('6자리 숫자이고 strongEnough를 통과, 매번 다르다', () => {
    const pins = Array.from({ length: 200 }, () => randomPin());
    for (const pin of pins) {
      expect(pin).toMatch(/^\d{6}$/);
      expect(strongEnough('worker', pin)).toBe(true);
    }
    expect(new Set(pins).size).toBeGreaterThan(190);
  });

  test('약한 PIN이 나오면 다시 뽑고, 250 이상 바이트는 버린다 (치우침 없음)', () => {
    const draws = [
      [0, 0, 0, 0, 0, 0], // 000000: all the same → rejected
      [251, 4, 8, 2, 9, 1, 7], // 251 dropped → 482917
    ];
    const fake = (buf: Uint8Array) => {
      const next = draws.shift() ?? [];
      buf.fill(255);
      buf.set(next.slice(0, buf.length));
      return buf;
    };
    expect(randomPin(fake)).toBe('482917');
  });
});
