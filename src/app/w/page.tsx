'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { RespondOutcome } from '@/engine/absence';
import { api, store, workerAction } from '@/components/worker/api';
import { BigButton } from '@/components/worker/BigButton';
import { AlertIcon, CalendarIcon, ChartIcon } from '@/components/worker/Icons';
import { RequestScreen } from '@/components/worker/RequestScreen';
import { ShiftCard } from '@/components/worker/ShiftCard';
import { useWorker } from '@/components/worker/WorkerContext';
import { errorKey } from '@/i18n';
import type { ShiftCard as Card, WorkerView } from '@/server/views/workerView';

type SubReq = NonNullable<WorkerView['request']>;
const TAKEN_SEEN_KEY = 'otl_taken_seen';

/** Shift hours from whichever home card has a shift (day runs dayStart→nightStart, night the reverse). */
function shiftTime(view: WorkerView, shift: SubReq['shift']): { start: string; end: string } | undefined {
  const c = [view.today, view.tomorrow].find((x) => x.start && x.end);
  if (!c?.start || !c.end) return undefined;
  return c.shift === shift ? { start: c.start, end: c.end } : { start: c.end, end: c.start };
}

const started = (c: Card) => !!c.start && Date.parse(`${c.date}T${c.start}:00+09:00`) <= Date.now();

export default function HomePage() {
  const { view, t, reload } = useWorker();
  const router = useRouter();
  const [answered, setAnswered] = useState<{ request: SubReq; outcome: RespondOutcome } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [takenSeen, setTakenSeen] = useState(() => (typeof window === 'undefined' ? null : store.get(TAKEN_SEEN_KEY)));
  const [menu, setMenu] = useState(false);
  if (!view) return null;

  const run = async <T,>(action: { type: string } & Record<string, unknown>, done?: (data: T) => void) => {
    setBusy(true);
    setError(null);
    const r = await workerAction<T>(action);
    if (r.ok) done?.(r.data);
    else setError(t(errorKey(r.code)));
    await reload();
    setBusy(false);
  };
  const seeTaken = () => {
    store.set(TAKEN_SEEN_KEY, view.today.date);
    setTakenSeen(view.today.date);
  };

  const shownRequest = answered?.request ?? view.request;
  if (shownRequest)
    return (
      <RequestScreen
        request={shownRequest}
        time={shiftTime(view, shownRequest.shift)}
        outcome={answered?.outcome ?? null}
        busy={busy}
        error={error}
        onRespond={(accept) =>
          void run<{ outcome: RespondOutcome }>({ type: 'respond', requestId: shownRequest.id, accept }, ({ outcome }) => {
            setAnswered({ request: shownRequest, outcome });
            if (outcome === 'takenByOther') seeTaken();
          })
        }
        onDone={() => {
          setAnswered(null);
          setError(null);
        }}
      />
    );

  const { today, myAbsence } = view;
  return (
    <main className="flex flex-col gap-4">
      {view.requestOutcome === 'takenByOther' && takenSeen !== today.date && (
        <div className="flex flex-col gap-3 rounded-2xl bg-orange-100 p-4 text-xl font-bold text-orange-900" role="status">
          <p>{t('request.takenByOther')}</p>
          <BigButton tone="white" onClick={seeTaken}>
            {t('common.ok')}
          </BigButton>
        </div>
      )}

      <ShiftCard card={today} title={t('home.today')} />

      {myAbsence && (
        <div className="flex flex-col gap-3 rounded-2xl border-4 border-red-500 bg-white p-4">
          <p className="flex items-center gap-2 text-xl font-bold text-red-700">
            <AlertIcon />
            {t(`absence.status.${myAbsence.status}`)}
          </p>
          {myAbsence.reportedBy === 'self' && !started(today) && (
            <BigButton tone="white" disabled={busy} onClick={() => void run({ type: 'cancelAbsence', absenceId: myAbsence.id })}>
              {t('home.cancelAbsence')}
            </BigButton>
          )}
        </div>
      )}

      {view.canReportAbsence && (
        <BigButton tone="red" size="lg" disabled={busy} onClick={() => void run({ type: 'reportAbsence' })}>
          {t('home.reportAbsence')}
        </BigButton>
      )}

      {error && (
        <p className="rounded-xl bg-red-100 p-3 text-xl font-bold text-red-800" role="alert">
          {error}
        </p>
      )}

      <ShiftCard card={view.tomorrow} title={t('home.tomorrow')} small />

      <div className="grid grid-cols-2 gap-3">
        <BigButton href="/w/leave" tone="white" icon={<CalendarIcon />}>
          {t('home.leave')}
        </BigButton>
        <BigButton href="/w/record" tone="white" icon={<ChartIcon />}>
          {t('home.record')}
        </BigButton>
      </div>

      <div className="mt-4 flex flex-col gap-2">
        <BigButton tone="gray" onClick={() => setMenu((m) => !m)}>
          {t('common.menu')}
        </BigButton>
        {menu && (
          <BigButton
            tone="white"
            onClick={async () => {
              await api('/api/auth/logout', {});
              router.replace('/w/login');
            }}
          >
            {t('common.logout')}
          </BigButton>
        )}
      </div>
    </main>
  );
}
