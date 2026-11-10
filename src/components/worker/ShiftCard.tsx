'use client';

import { formatDate } from '@/i18n';
import type { ShiftCard as ShiftCardData } from '@/server/views/workerView';
import { CalendarIcon, MoonIcon, SunIcon } from './Icons';
import { useWorker } from './WorkerContext';

const STYLE = {
  day: 'bg-[#FACC15] text-gray-900',
  night: 'bg-[#1E3A8A] text-white',
  off: 'bg-gray-200 text-gray-700',
} as const;

/** Today's (large) or tomorrow's (small) shift: colour = shift, then date, shift + time, factory · post. */
export function ShiftCard({ card, title, small }: { card: ShiftCardData; title: string; small?: boolean }) {
  const { lang, t } = useWorker();
  const Icon = card.shift === 'day' ? SunIcon : card.shift === 'night' ? MoonIcon : CalendarIcon;
  const place = [card.factoryName, card.postName].filter(Boolean).join(' · ');

  return (
    <section className={`rounded-3xl ${STYLE[card.shift]} ${small ? 'p-4' : 'p-6'}`}>
      <p className="text-lg font-semibold opacity-80">
        {title} · {formatDate(lang, card.date)}
      </p>
      <div className="mt-2 flex items-center gap-3">
        <Icon size={small ? 32 : 48} />
        <span className={`font-extrabold ${small ? 'text-2xl' : 'text-4xl'}`}>{t(`shift.${card.shift}`)}</span>
      </div>
      {card.start && card.end && (
        <p className={`mt-2 font-bold ${small ? 'text-xl' : 'text-3xl'}`}>{t('shift.time', { start: card.start, end: card.end })}</p>
      )}
      {place && <p className={`mt-1 ${small ? 'text-lg' : 'text-2xl'}`}>{place}</p>}
    </section>
  );
}
