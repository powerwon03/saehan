'use client';

import { useWorker } from './WorkerContext';

type Props = {
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
  maxLength: number;
  /** PIN: show dots, one slot per digit. */
  masked?: boolean;
  /** 확인 is enabled from this many digits (default maxLength). */
  minLength?: number;
  busy?: boolean;
};

const KEY = 'flex min-h-[64px] items-center justify-center rounded-2xl text-3xl font-bold select-none active:scale-95';

/** 3×4 numeric keypad (1–9, ⌫, 0, 확인) with the entered value above it. No text input anywhere. */
export function PinPad({ value, onChange, onSubmit, maxLength, masked, minLength = maxLength, busy }: Props) {
  const { t } = useWorker();
  const press = (d: string) => value.length < maxLength && onChange(value + d);
  const ready = value.length >= minLength && !busy;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex min-h-[64px] items-center justify-center gap-3 rounded-2xl bg-gray-100 px-4" aria-live="polite">
        {masked
          ? Array.from({ length: maxLength }, (_, i) => (
              <span key={i} className={`h-5 w-5 rounded-full ${i < value.length ? 'bg-gray-900' : 'border-2 border-gray-400'}`} />
            ))
          : <span className="text-4xl font-bold tracking-widest">{value || ' '}</span>}
      </div>
      <div className="grid grid-cols-3 gap-3">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button key={d} type="button" className={`${KEY} bg-white border-2 border-gray-300`} onClick={() => press(d)}>
            {d}
          </button>
        ))}
        <button type="button" className={`${KEY} bg-gray-200`} onClick={() => onChange(value.slice(0, -1))} aria-label={t('pad.backspace')}>
          ⌫
        </button>
        <button type="button" className={`${KEY} bg-white border-2 border-gray-300`} onClick={() => press('0')}>
          0
        </button>
        <button type="button" className={`${KEY} bg-blue-600 text-xl text-white disabled:opacity-40`} onClick={onSubmit} disabled={!ready}>
          {t('pad.confirm')}
        </button>
      </div>
    </div>
  );
}
