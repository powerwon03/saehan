'use client';

import { randomPin } from '@/lib/personRules';
import { btn, input } from '../common/styles';

/**
 * Initial / reset PIN: prefilled with a random strong PIN (the caller seeds it with randomPin()), shown large so the
 * admin can read it out to the worker, editable, with 「다시 만들기」 for a fresh one.
 */
export function PinInput({ label, value, onChange, error, autoFocus }: { label: string; value: string; onChange: (pin: string) => void; error?: string | null; autoFocus?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor="pin-input" className="text-sm font-semibold text-gray-600">
        {label}
      </label>
      <div className="flex gap-2">
        <input
          id="pin-input"
          className={`${input} w-40 font-mono text-2xl font-bold tracking-[0.3em]`}
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
          inputMode="numeric"
          autoComplete="off"
          maxLength={6}
          autoFocus={autoFocus}
        />
        <button type="button" className={btn} onClick={() => onChange(randomPin())}>
          다시 만들기
        </button>
      </div>
      <p className="text-sm text-gray-600">이 PIN을 근로자에게 알려 주세요.</p>
      {error && (
        <p role="alert" className="text-sm font-semibold text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
