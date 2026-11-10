import { describe, expect, test } from 'vitest';
import { cellText, formFromRow, payloadFromForm, type FieldSpec } from '@/components/admin/master/logic';

const fields: FieldSpec[] = [
  { key: 'code', label: '코드', type: 'text' },
  { key: 'role', label: '역할', type: 'text', nullable: true },
  { key: 'kind', label: '종류', type: 'select', options: [{ value: 'line', label: '라인' }, { value: 'fixed', label: '고정' }], initial: 'line' },
  { key: 'productId', label: '제품', type: 'select', nullable: true, emptyLabel: '없음(라인 기본)', options: [{ value: 'pr1', label: 'P1 컵' }] },
  { key: 'need', label: '인원', type: 'int', initial: '1' },
  { key: 'priority', label: '우선순위', type: 'int', optional: true },
  { key: 'unmanned', label: '무인', type: 'bool' },
  { key: 'active', label: '사용', type: 'bool', initial: true },
  { key: 'cycleBaseDate', label: '기준일', type: 'date' },
];

describe('master form ↔ payload', () => {
  test('새 행: 초기값', () => {
    expect(formFromRow(fields, null)).toEqual({ code: '', role: '', kind: 'line', productId: '', need: '1', priority: '', unmanned: false, active: true, cycleBaseDate: '' });
  });

  test('행 → 폼 → 같은 값의 payload', () => {
    const row = { id: 'x', code: 'L-1', role: null, kind: 'fixed', productId: 'pr1', need: 2, priority: 0, unmanned: true, active: false, cycleBaseDate: '2025-04-27' };
    const form = formFromRow(fields, row);
    expect(form).toMatchObject({ role: '', need: '2', priority: '0', productId: 'pr1' });
    expect(payloadFromForm(fields, form)).toEqual({ code: 'L-1', role: null, kind: 'fixed', productId: 'pr1', need: 2, priority: 0, unmanned: true, active: false, cycleBaseDate: '2025-04-27' });
  });

  test('빈 칸: nullable은 null, optional은 빠지고, 글자는 다듬는다', () => {
    const form = { ...formFromRow(fields, null), code: ' P-9 ', need: '3' };
    const p = payloadFromForm(fields, form);
    expect(p).toMatchObject({ code: 'P-9', role: null, productId: null, need: 3 });
    expect(p).not.toHaveProperty('priority');
  });

  test('숫자가 아니면 NaN 대신 원래 글자를 보내 서버가 BAD_INPUT으로 막는다', () => {
    expect(payloadFromForm(fields, { ...formFromRow(fields, null), need: '2.5' }).need).toBe(2.5);
    expect(payloadFromForm(fields, { ...formFromRow(fields, null), need: 'abc' }).need).toBe('abc');
  });
});

describe('cellText', () => {
  test('선택은 이름, 참거짓은 예/빈칸, null은 —', () => {
    const row = { kind: 'fixed', productId: null, unmanned: true, active: false, role: null, need: 2 };
    expect(cellText(fields[2], row)).toBe('고정');
    expect(cellText(fields[3], row)).toBe('없음(라인 기본)');
    expect(cellText(fields[6], row)).toBe('예');
    expect(cellText(fields[7], row)).toBe('');
    expect(cellText(fields[1], row)).toBe('—');
    expect(cellText(fields[4], row)).toBe('2');
  });
});
