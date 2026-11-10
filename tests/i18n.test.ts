import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { en } from '@/i18n/en';
import { ERROR_CODES } from '@/i18n/errorCodes';
import { errorKey, formatDate, t } from '@/i18n/index';
import { ko } from '@/i18n/ko';
import { mn } from '@/i18n/mn';
import { vi } from '@/i18n/vi';

const koKeys = Object.keys(ko).sort();

/** Every .ts/.tsx file under `dir`, recursively. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.tsx?$/.test(name) ? [p] : [];
  });
}

describe('dictionaries', () => {
  test('en/mn/vi 사전이 ko의 모든 키를 갖고 빈 문자열이 없다', () => {
    for (const [name, dict] of Object.entries({ ko, en, mn, vi })) {
      expect(Object.keys(dict).sort(), name).toEqual(koKeys);
      for (const [key, value] of Object.entries(dict)) {
        expect(typeof value === 'string' && value.trim().length > 0, `${name}:${key}`).toBe(true);
      }
    }
  });

  test('각 언어의 {자리표시자}가 ko와 같다', () => {
    const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const [name, dict] of Object.entries({ en, mn, vi })) {
      for (const key of koKeys) {
        const k = key as keyof typeof ko;
        expect(holes(dict[k]), `${name}:${key}`).toEqual(holes(ko[k]));
      }
    }
  });

  test('스펙 고정 문구(ko)', () => {
    expect(ko['home.reportAbsence']).toBe('오늘 못 나와요');
    expect(ko['home.cancelAbsence']).toBe('잘못 눌렀어요');
    expect(ko['request.title']).toBe('오늘 일하러 와 주실 수 있나요?');
    expect(ko['request.accept']).toBe('갈 수 있어요');
    expect(ko['request.decline']).toBe('못 가요');
    expect(ko['request.takenByOther']).toBe('다른 분이 가기로 했습니다');
  });

  test('메시지 bodyKey 전부에 msg.<key>가 있다', () => {
    const bodyKeys = ['absenceReported', 'subRequest', 'takenByOther', 'subAssigned', 'subAccepted', 'subFailed', 'requestCancelled', 'leaveApproved', 'leaveRejected', 'todayWork'];
    for (const k of bodyKeys) expect(Object.keys(ko), k).toContain(`msg.${k}`);
  });
});

describe('error codes', () => {
  test('서버 오류 코드 전부(EngineError·login 코드 목록 상수)에 사전 키가 있다', () => {
    expect(ERROR_CODES.length).toBe(25);
    for (const code of ERROR_CODES) expect(Object.keys(ko), code).toContain(`error.${code}`);
  });

  test("src/의 EngineError('X')·error: 'X' 리터럴이 모두 ERROR_CODES에 있다", () => {
    const found = new Set<string>();
    for (const file of sourceFiles(join(process.cwd(), 'src'))) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/EngineError\(\s*'([A-Z_]+)'|error:\s*'([A-Z_]+)'/g)) found.add(m[1] ?? m[2]);
    }
    expect(found.size).toBeGreaterThan(10); // the grep itself must keep working
    const known = new Set<string>(ERROR_CODES);
    expect([...found].filter((c) => !known.has(c))).toEqual([]);
  });

  test('errorKey는 모르는 코드를 error.INTERNAL로 보낸다', () => {
    expect(errorKey('LOCKED')).toBe('error.LOCKED');
    expect(errorKey('SOMETHING_NEW')).toBe('error.INTERNAL');
  });
});

describe('t()', () => {
  test('{name} 자리표시자를 채우고 모르는 언어는 ko', () => {
    expect(t('ko', 'request.remaining', { min: 7 })).toBe(ko['request.remaining'].replace('{min}', '7'));
    expect(t('xx', 'home.reportAbsence')).toBe('오늘 못 나와요');
    expect(t('en', 'home.reportAbsence')).toBe(en['home.reportAbsence']);
  });

  test('formatDate는 시스템 시간대와 무관하게 요일을 붙인다', () => {
    expect(formatDate('ko', '2026-11-10')).toBe('11월 10일 (화)');
  });
});
