// Pure person/account rules shared by the server and the admin screens (no DB, no Node APIs).

/** Next employee number: the numerically largest trailing number + 1, same prefix and zero-padded width. */
export function suggestEmpNo(existing: string[]): string {
  let best: { prefix: string; digits: string; n: bigint } | null = null;
  for (const e of existing) {
    const m = /^(.*?)(\d+)$/.exec(e);
    if (!m) continue;
    const n = BigInt(m[2]);
    if (!best || n > best.n) best = { prefix: m[1], digits: m[2], n };
  }
  if (!best) return '0001';
  // BigInt(1), not `1n`: next build's file tracer (@vercel/nft) takes `best` for its initial null and would
  // compute `undefined + 1n` itself, throwing "Cannot mix BigInt" and failing the build (tests/build/trace.test.ts).
  const next = best.n + BigInt(1);
  return best.prefix + next.toString().padStart(best.digits.length, '0');
}

/** Worker PIN: 6 digits, not all-same, not 123456/654321 (admin: 8+ chars). */
export function strongEnough(kind: 'admin' | 'worker', next: string): boolean {
  if (kind === 'admin') return next.length >= 8;
  if (!/^\d{6}$/.test(next)) return false;
  if (/^(\d)\1{5}$/.test(next)) return false;
  return next !== '123456' && next !== '654321';
}
