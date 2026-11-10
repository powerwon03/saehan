'use client';

import { useEffect, useRef, useState } from 'react';
import type { RespondOutcome } from '@/engine/absence';
import { formatDate, type DictKey } from '@/i18n';
import { minutesLeft } from '@/lib/countdown';
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
  /** The local countdown reached 0: the page reloads its view so a stale request cannot keep this screen up. */
  onExpired: () => void;
};

const OUTCOME_TEXT: Record<RespondOutcome, DictKey> = {
  accepted: 'request.accepted',
  declined: 'request.declined',
  takenByOther: 'request.takenByOther',
  expired: 'request.expired',
  cancelled: 'request.cancelled',
};

const TICK_MS = 5_000;

/** Clock re-read every few seconds; calls `onExpired` once when `expiresAt` is reached. */
function useExpiryClock(expiresAt: string, onExpired: () => void): number {
  const [now, setNow] = useState(() => Date.now());
  const expiredRef = useRef(onExpired);
  expiredRef.current = onExpired;
  useEffect(() => {
    let fired = false;
    const tick = () => {
      const t = Date.now();
      setNow(t);
      if (t >= Date.parse(expiresAt) && !fired) {
        fired = true;
        expiredRef.current();
      }
    };
    tick();
    const id = setInterval(tick, TICK_MS);
    return () => clearInterval(id);
  }, [expiresAt]);
  return now;
}

/** Full-screen sub request (replaces home): question, slot details, minutes left, two big answers. */
export function RequestScreen({ request, time, outcome, busy, error, onRespond, onDone, onExpired }: Props) {
  const { lang, t } = useWorker();
  const now = useExpiryClock(request.expiresAt, onExpired);
  const left = minutesLeft(request.expiresAt, now, request.expiryMin);
  const night = request.shift === 'night';
  const shown: RespondOutcome | null = outcome ?? (now >= Date.parse(request.expiresAt) ? 'expired' : null);
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
