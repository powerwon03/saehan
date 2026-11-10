import type { Weights } from '@/engine/types';
import type { settings } from '@/server/db/schema';

// Pure helpers for the 설정 screen: GET /api/admin/settings ↔ form strings ↔ the full-object PUT body.

export type SettingsValues = Omit<typeof settings.$inferSelect, 'companyId'>;

export const WEIGHT_KEYS = ['samePost', 'sameProduct', 'sameFactory', 'roleMatch', 'roleMismatch', 'recentSub'] as const satisfies readonly (keyof Weights)[];
const NUMBER_KEYS = ['shiftCreditHours', 'maxWeekHours', 'warnWeekHours', 'requestExpiryMin'] as const;

export type SettingsForm = {
  shiftDayStart: string;
  shiftNightStart: string;
  shiftCreditHours: string;
  maxWeekHours: string;
  warnWeekHours: string;
  requestExpiryMin: string;
  weights: Record<keyof Weights, string>;
  /** 가동률 in percent (0–100), shown as % on screen. */
  skillRates: [string, string, string, string];
};

/** A number field the form could not parse stays the typed text, so the server answers BAD_INPUT. */
type Num = number | string;
export type SettingsPayload = {
  shiftDayStart: string;
  shiftNightStart: string;
  shiftCreditHours: Num;
  maxWeekHours: Num;
  warnWeekHours: Num;
  requestExpiryMin: Num;
  weights: Record<keyof Weights, Num>;
  skillRates: [Num, Num, Num, Num];
};

const num = (s: string): Num => {
  const t = s.trim();
  return t !== '' && Number.isFinite(Number(t)) ? Number(t) : t;
};
const pct = (r: number) => String(Math.round(r * 1000) / 10); // 0.3 → '30' (no 30.000000000000004)
const ratio = (s: string): Num => {
  const n = num(s);
  return typeof n === 'number' ? Math.round(n * 10) / 1000 : n;
};

export function formFromSettings(s: SettingsValues): SettingsForm {
  return {
    shiftDayStart: s.shiftDayStart,
    shiftNightStart: s.shiftNightStart,
    shiftCreditHours: String(s.shiftCreditHours),
    maxWeekHours: String(s.maxWeekHours),
    warnWeekHours: String(s.warnWeekHours),
    requestExpiryMin: String(s.requestExpiryMin),
    weights: Object.fromEntries(WEIGHT_KEYS.map((k) => [k, String(s.weights[k])])) as SettingsForm['weights'],
    skillRates: s.skillRates.map(pct) as SettingsForm['skillRates'],
  };
}

export function settingsPayload(f: SettingsForm): SettingsPayload {
  const out = {
    shiftDayStart: f.shiftDayStart,
    shiftNightStart: f.shiftNightStart,
    weights: Object.fromEntries(WEIGHT_KEYS.map((k) => [k, num(f.weights[k])])) as SettingsPayload['weights'],
    skillRates: f.skillRates.map(ratio) as SettingsPayload['skillRates'],
  } as SettingsPayload;
  for (const k of NUMBER_KEYS) out[k] = num(f[k]);
  return out;
}
