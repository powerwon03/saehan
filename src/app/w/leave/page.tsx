'use client';

import { useState } from 'react';
import { workerAction } from '@/components/worker/api';
import { BigButton } from '@/components/worker/BigButton';
import { BackIcon } from '@/components/worker/Icons';
import { useWorker } from '@/components/worker/WorkerContext';
import { addDays } from '@/engine/dates';
import { errorKey, formatDate } from '@/i18n';

const CHIP: Record<string, string> = {
  pending: 'bg-yellow-200 text-yellow-900',
  approved: 'bg-green-200 text-green-900',
  rejected: 'bg-red-200 text-red-900',
  cancelled: 'bg-gray-200 text-gray-700',
};
const STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const;
const statusOf = (s: string) => STATUSES.find((x) => x === s) ?? 'pending';

/** Seoul calendar date now, by fixed +09:00 arithmetic (no Intl time zone). */
const seoulToday = () => new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);

/** Next 14 days as big date buttons (one tap = request), then own requests with status and 취소 while pending. */
export default function LeavePage() {
  const { view, lang, t, reload } = useWorker();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!view) return null;

  const run = async (action: { type: string } & Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    const r = await workerAction(action);
    if (!r.ok) setError(t(errorKey(r.code)));
    await reload();
    setBusy(false);
  };
  const today = seoulToday();
  const days = Array.from({ length: 14 }, (_, i) => addDays(today, i + 1));
  const active = new Map(view.leaves.filter((l) => l.status === 'pending' || l.status === 'approved').map((l) => [l.date, l.status]));

  return (
    <main className="flex flex-col gap-4">
      <BigButton href="/w" tone="white" icon={<BackIcon />}>
        {t('common.back')}
      </BigButton>
      <h1 className="text-3xl font-extrabold">{t('leave.title')}</h1>
      <p className="text-xl">{t('leave.pick')}</p>
      {error && (
        <p className="rounded-xl bg-red-100 p-3 text-xl font-bold text-red-800" role="alert">
          {error}
        </p>
      )}
      <div className="grid grid-cols-2 gap-3">
        {days.map((d) => {
          const status = active.get(d);
          return (
            <button
              key={d}
              type="button"
              disabled={busy || status !== undefined}
              onClick={() => void run({ type: 'requestLeave', date: d })}
              className={`flex min-h-[64px] flex-col items-center justify-center rounded-2xl border-2 text-xl font-bold ${
                status ? `${CHIP[status]} border-transparent` : 'border-gray-300 bg-white active:bg-blue-100'
              }`}
            >
              <span>{formatDate(lang, d, true)}</span>
              {status && <span className="text-lg">{t(`leave.status.${statusOf(status)}`)}</span>}
            </button>
          );
        })}
      </div>

      <h2 className="mt-4 text-2xl font-bold">{t('leave.mine')}</h2>
      {view.leaves.length === 0 && <p className="text-xl text-gray-600">{t('leave.none')}</p>}
      <ul className="flex flex-col gap-3">
        {view.leaves.map((l) => (
          <li key={l.id} className="flex items-center gap-3 rounded-2xl bg-white p-3">
            <span className="flex-1 text-xl font-bold">{formatDate(lang, l.date)}</span>
            <span className={`rounded-full px-3 py-1 text-lg font-bold ${CHIP[statusOf(l.status)]}`}>{t(`leave.status.${statusOf(l.status)}`)}</span>
            {l.status === 'pending' && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void run({ type: 'cancelLeave', leaveId: l.id })}
                className="min-h-[56px] rounded-xl border-2 border-gray-300 px-4 text-lg font-bold"
              >
                {t('leave.cancel')}
              </button>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
