/**
 * Every error code the server can send as `{ error: CODE }` (EngineError codes, auth/login codes, guard codes)
 * plus the eligibility reasons shown next to candidates. Each one needs an `error.<CODE>` dictionary key;
 * tests/i18n.test.ts greps src/ so a new code cannot ship without being listed here.
 */
export const ERROR_CODES = [
  'ALREADY_RESOLVED',
  'BAD_INPUT',
  'BAD_STATE',
  'CANNOT_REPORT',
  'DATA_INTEGRITY',
  'DUPLICATE_CODE',
  'FORBIDDEN',
  'HAS_HISTORY',
  'IN_USE',
  'NO_CANDIDATES',
  'OUT_OF_RANGE',
  'SHIFT_STARTED',
  'UNKNOWN_FORMAT',
  'WEAK_SECRET',
  'INVALID',
  'LOCKED',
  'UNAUTHENTICATED',
  'MUST_CHANGE_PIN',
  'INTERNAL',
  'INACTIVE',
  'OFF_OR_ABSENT',
  'ALREADY_WORKING',
  'NIGHT_BEFORE_DAY',
  'DAY_AFTER_NIGHT',
  'WEEK_HOURS',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];
