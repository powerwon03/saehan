/**
 * An AbortSignal that fires after `ms`, built from AbortController + setTimeout so it also works on old Android
 * WebViews without `AbortSignal.timeout` (calling that missing method would throw on every poll and stop polling
 * silently). Without AbortController at all, `signal` is undefined: the request goes out with no timeout.
 * Call `clear()` once the request settles.
 */
export function timeoutSignal(ms: number): { signal: AbortSignal | undefined; clear: () => void } {
  if (typeof AbortController !== 'function') return { signal: undefined, clear: () => {} };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}
