// Pure helpers for the absence cards (no React, no clock: `now` is passed in).

const SHOWN = 3;
const KST_MS = 9 * 3_600_000;

type Cand = { personId: string; kind: 'idle' | 'rest' };
type Req = { personId: string; status: string };

/** BoardView dates arrive as ISO strings over JSON even though the type says Date. */
const ms = (d: Date | string): number => new Date(d).getTime();

/** First 3 candidates plus every candidate already asked (any request status), in rank order. */
export function visibleCandidates<C extends Cand>(candidates: C[], requests: Req[], showAll: boolean): { shown: C[]; hidden: number } {
  if (showAll) return { shown: candidates, hidden: 0 };
  const asked = new Set(requests.map((r) => r.personId));
  const shown = candidates.filter((c, i) => i < SHOWN || asked.has(c.personId));
  return { shown, hidden: candidates.length - shown.length };
}

/** 「3명에게 동시에 요청」 targets: the first `n` resting candidates never asked for this absence. */
export function bulkTargets(candidates: Cand[], requests: Req[], n = SHOWN): string[] {
  const asked = new Set(requests.map((r) => r.personId));
  return candidates
    .filter((c) => c.kind === 'rest' && !asked.has(c.personId))
    .slice(0, n)
    .map((c) => c.personId);
}

export { minutesLeft } from '@/lib/countdown';

/** Minutes from report to resolution, at least 1. */
export function resolvedMinutes(createdAt: Date | string, resolvedAt: Date | string): number {
  return Math.max(1, Math.round((ms(resolvedAt) - ms(createdAt)) / 60_000));
}

/** Seoul wall-clock HH:MM by fixed +09:00 arithmetic. */
export function seoulHm(d: Date | string): string {
  return new Date(ms(d) + KST_MS).toISOString().slice(11, 16);
}
