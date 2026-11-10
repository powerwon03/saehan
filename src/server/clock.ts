let override: Date | null = null;

/** Current time for route handlers. Tests pin it with setNowForTests. */
export const nowFn = (): Date => (override ? new Date(override.getTime()) : new Date());

export function setNowForTests(d: Date | null): void {
  override = d;
}
