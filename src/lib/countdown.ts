// 「N분 남음」 for sub requests, shared by the admin absence panel and the worker request screen (no clock: `now` is passed in).

/**
 * Whole minutes left until `expiresAt`, rounded down and clamped to [0, maxMin] (the company's request expiry), so a
 * fresh request or a device clock running behind never shows more time than the request was given.
 */
export function minutesLeft(expiresAt: Date | string, now: number, maxMin: number): number {
  const min = Math.floor((new Date(expiresAt).getTime() - now) / 60_000);
  return Math.min(maxMin, Math.max(0, min));
}
