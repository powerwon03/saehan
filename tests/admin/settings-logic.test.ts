import { describe, expect, test } from 'vitest';
import { formFromSettings, settingsPayload, type SettingsValues } from '@/components/admin/settings/logic';

const s: SettingsValues = {
  shiftDayStart: '07:00',
  shiftNightStart: '19:00',
  shiftCreditHours: 8,
  maxWeekHours: 52,
  warnWeekHours: 44,
  requestExpiryMin: 20,
  weights: { samePost: 15, sameProduct: 3, sameFactory: 1, roleMatch: 5, roleMismatch: 20, recentSub: 25 },
  skillRates: [0.3, 0.6, 0.9, 1],
};

describe('settings form ↔ payload', () => {
  test('설정 → 폼 → 같은 전체 객체', () => {
    const f = formFromSettings(s);
    expect(f.requestExpiryMin).toBe('20');
    expect(f.skillRates).toEqual(['30', '60', '90', '100']); // 가동률은 % 로 보여 준다
    expect(settingsPayload(f)).toEqual(s);
  });

  test('바꾼 값은 숫자로, 가동률 %는 비율로', () => {
    const f = formFromSettings(s);
    const p = settingsPayload({ ...f, requestExpiryMin: '30', weights: { ...f.weights, recentSub: '12.5' }, skillRates: ['25', '60', '90', '100'] });
    expect(p.requestExpiryMin).toBe(30);
    expect(p.weights.recentSub).toBe(12.5);
    expect(p.skillRates).toEqual([0.25, 0.6, 0.9, 1]);
  });

  test('숫자가 아닌 칸은 그대로 보내 서버가 BAD_INPUT으로 막는다', () => {
    const f = formFromSettings(s);
    expect(settingsPayload({ ...f, maxWeekHours: '' }).maxWeekHours).toBe('');
    expect(settingsPayload({ ...f, skillRates: ['x', '60', '90', '100'] }).skillRates[0]).toBe('x');
  });
});
