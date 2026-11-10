import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { timeoutSignal } from '@/hooks/timeoutSignal';

describe('timeoutSignal', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  test('AbortSignal.timeout 이 없는 옛 WebView 에서도 기한이 지나면 중단', () => {
    vi.stubGlobal('AbortSignal', class {}); // no static timeout()
    const t = timeoutSignal(8_000);
    expect(t.signal?.aborted).toBe(false);
    vi.advanceTimersByTime(7_999);
    expect(t.signal?.aborted).toBe(false);
    vi.advanceTimersByTime(1);
    expect(t.signal?.aborted).toBe(true);
  });

  test('clear() 하면 타이머가 풀려 중단되지 않음', () => {
    const t = timeoutSignal(8_000);
    t.clear();
    vi.advanceTimersByTime(10_000);
    expect(t.signal?.aborted).toBe(false);
  });

  test('AbortController 도 없으면 signal 없이 (요청은 그대로 보냄)', () => {
    vi.stubGlobal('AbortController', undefined);
    const t = timeoutSignal(8_000);
    expect(t.signal).toBeUndefined();
    expect(() => t.clear()).not.toThrow();
  });
});
