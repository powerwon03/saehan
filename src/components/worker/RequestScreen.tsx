'use client';

import { useEffect, useState } from 'react';
import type { RespondOutcome } from '@/engine/absence';
import { formatDate, type DictKey } from '@/i18n';
import type { WorkerView } from '@/server/views/workerView';
import { BigButton } from './BigButton';
import { MoonIcon, SunIcon } from './Icons';
import { useWorker } from './WorkerContext';

type SubReq = NonNullable<WorkerView['request']>;

type Props = {
  request: SubReq;
  /** Shift hours if known (derived from the home cards). */
  time?: { start: string; end: string };
  /** Set after answering: the screen shows the result instead of the question. */
  outcome: RespondOutcome | null;
  busy: boolean;
  error: string | null;
  onRespond: (accept: boolean) => void;
  onDone: () => void;
};

const OUTCOME_TEXT: Record<RespondOutcome, DictKey> = {
  accepted: 'request.accepted',
  declined: 'request.declined',
  takenByOther: 'request.takenByOther',
  expired: 'request.expired',
};

function useMinutesLeft(expiresAt: string): number {
  const calc = () => Math.ceil((Date.parse(expiresAt) - Date.now()) / 60_000);
  const [left, setLeft] = useState(calc);
  useEffect(() => {
    setLeft(calc());
    const id = setInterval(() => setLeft(calc()), 30_000);
    return () => clearInterval(id);
  }, [expiresAt]); // calc only reads expiresAt
  return left;
}

/** Full-screen sub request (replaces home): question, slot details, minutes left, two big answers. */
export function RequestScreen({ request, time, outcome, busy, error, onRespond, onDone }: Props) {
  const { lang, t } = useWorker();
  const left = useMinutesLeft(request.expiresAt);
  const night = request.shift === 'night';
  const shown: RespondOutcome | null = outcome ?? (left <= 0 ? 'expired' : null);
  const Icon = night ? MoonIcon : SunIcon;

  return (
    <section className={`flex min-h-[80vh] flex-col gap-5 rounded-3xl p-6 text-white ${night ? 'bg-[#1E3A8A]' : 'bg-[#F97316]'}`}>
      {shown ? (
        <>
          <p className="mt-8 text-center text-3xl font-extrabold leading-snug" role="status">
            {t(OUTCOME_TEXT[shown])}
          </p>
          <div className="mt-auto">
            <BigButton tone={night ? 'navy' : 'orange'} size="lg" onClick={onDone}>
              {t('common.ok')}
            </BigButton>
          </div>
        </>
      ) : (
        <>
          <h1 className="text-3xl font-extrabold leading-snug">{t('request.title')}</h1>
          <div className="rounded-2xl bg-white/15 p-4 text-2xl">
            <p className="font-bold">{formatDate(lang, request.date)}</p>
            <p className="mt-2 flex items-center gap-2 font-bold">
              <Icon size={32} />
              {t(`shift.${request.shift}`)}
              {time && <span className="font-semibold"> {t('shift.time', time)}</span>}
            </p>
            <p className="mt-2">{[request.factoryName, request.postName].filter(Boolean).join(' · ')}</p>
          </div>
          <p className="text-center text-2xl font-bold">{t('request.remaining', { min: left })}</p>
          {error && <p className="rounded-xl bg-white p-3 text-xl font-bold text-red-700" role="alert">{error}</p>}
          <div className="mt-auto flex flex-col gap-4">
            <BigButton tone="green" size="lg" onClick={() => onRespond(true)} disabled={busy}>
              {t('request.accept')}
            </BigButton>
            <BigButton tone="white" size="lg" onClick={() => onRespond(false)} disabled={busy}>
              {t('request.decline')}
            </BigButton>
          </div>
        </>
      )}
    </section>
  );
}
