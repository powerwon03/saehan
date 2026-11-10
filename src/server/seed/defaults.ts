import type { Settings } from '@/engine/types';

/** Company settings defaults (global constraints). Mirrors the column defaults in db/schema.ts. */
export const DEFAULT_SETTINGS: Omit<Settings, 'companyId'> = {
  shiftDayStart: '07:00',
  shiftNightStart: '19:00',
  shiftCreditHours: 8,
  maxWeekHours: 52,
  warnWeekHours: 44,
  requestExpiryMin: 20,
  skillRates: [0.3, 0.6, 0.9, 1.0],
  weights: { samePost: 15, sameProduct: 3, sameFactory: 1, roleMatch: 5, roleMismatch: 20, recentSub: 25 },
};
