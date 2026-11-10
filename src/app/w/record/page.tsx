'use client';

import { BigButton } from '@/components/worker/BigButton';
import { BackIcon } from '@/components/worker/Icons';
import { useWorker } from '@/components/worker/WorkerContext';
import type { DictKey } from '@/i18n';
import type { MonthlyRecord } from '@/server/views/monthlyRecord';

const TILES: { field: keyof MonthlyRecord; label: DictKey; unit: DictKey; tone: string }[] = [
  { field: 'workDays', label: 'record.workDays', unit: 'record.unit.days', tone: 'bg-white' },
  { field: 'hours', label: 'record.hours', unit: 'record.unit.hours', tone: 'bg-white' },
  { field: 'dayCount', label: 'record.dayCount', unit: 'record.unit.times', tone: 'bg-[#FACC15] text-gray-900' },
  { field: 'nightCount', label: 'record.nightCount', unit: 'record.unit.times', tone: 'bg-[#1E3A8A] text-white' },
  { field: 'subCount', label: 'record.subCount', unit: 'record.unit.times', tone: 'bg-green-100' },
  { field: 'missedDays', label: 'record.missedDays', unit: 'record.unit.days', tone: 'bg-red-100' },
];

/** This month so far as six large number tiles. */
export default function RecordPage() {
  const { view, t } = useWorker();
  if (!view) return null;

  return (
    <main className="flex flex-col gap-4">
      <BigButton href="/w" tone="white" icon={<BackIcon />}>
        {t('common.back')}
      </BigButton>
      <h1 className="text-3xl font-extrabold">{t('record.title')}</h1>
      <div className="grid grid-cols-2 gap-3">
        {TILES.map(({ field, label, unit, tone }) => (
          <div key={field} className={`flex flex-col gap-1 rounded-2xl p-4 ${tone}`}>
            <span className="text-xl font-semibold">{t(label)}</span>
            <span className="text-5xl font-extrabold">
              {view.month[field]}
              <span className="ml-1 text-xl font-bold">{t(unit)}</span>
            </span>
          </div>
        ))}
      </div>
    </main>
  );
}
