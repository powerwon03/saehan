'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api';
import { PinPad } from '@/components/worker/PinPad';
import { useWorker } from '@/components/worker/WorkerContext';
import { errorKey } from '@/i18n';

type Step = 'current' | 'next' | 'confirm';
const PROMPT = { current: 'pin.current', next: 'pin.next', confirm: 'pin.confirm' } as const;

/** PIN change on the keypad: current → new → new again. Mismatch or a rejected PIN starts over. */
export default function PinPage() {
  const { t } = useWorker();
  const router = useRouter();
  const [step, setStep] = useState<Step>('current');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const restart = (msg: string) => {
    setStep('current');
    setCurrent('');
    setNext('');
    setValue('');
    setError(msg);
  };

  const submit = async () => {
    setError(null);
    if (step === 'current') {
      setCurrent(value);
      setStep('next');
    } else if (step === 'next') {
      setNext(value);
      setStep('confirm');
    } else if (value !== next) {
      return restart(t('pin.mismatch'));
    } else {
      setBusy(true);
      const r = await api('/api/auth/secret', { current, next });
      setBusy(false);
      if (r.ok) return router.replace('/w');
      return restart(t(errorKey(r.code)));
    }
    setValue('');
  };

  return (
    <main className="flex flex-col gap-4">
      <h1 className="text-3xl font-extrabold">{t('pin.title')}</h1>
      <p className="text-2xl font-bold">{t(PROMPT[step])}</p>
      {step !== 'current' && <p className="text-lg text-gray-600">{t('pin.rule')}</p>}
      <PinPad value={value} onChange={setValue} maxLength={6} masked busy={busy} onSubmit={() => void submit()} />
      {error && (
        <p className="rounded-xl bg-red-100 p-3 text-xl font-bold text-red-800" role="alert">
          {error}
        </p>
      )}
    </main>
  );
}
