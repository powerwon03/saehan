'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { api } from '@/components/worker/api';
import { BigButton } from '@/components/worker/BigButton';
import { PinPad } from '@/components/worker/PinPad';
import { useWorker } from '@/components/worker/WorkerContext';
import { errorKey } from '@/i18n';

type LoginReply = { ok: true; mustChange: boolean };

/** Two steps on one page, both on the keypad: 사번, then a masked 6-digit PIN. */
function Login() {
  const { t } = useWorker();
  const router = useRouter();
  const company = useSearchParams().get('company');
  const [step, setStep] = useState<'empNo' | 'pin'>('empNo');
  const [empNo, setEmpNo] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const r = await api<LoginReply>('/api/auth/login', { ...(company ? { company } : {}), kind: 'worker', loginId: empNo, secret: pin });
    setBusy(false);
    setPin('');
    if (r.ok) return router.replace(r.data.mustChange ? '/w/pin' : '/w');
    const msg = t(errorKey(r.code));
    const until = typeof r.body.lockedUntil === 'string' ? Date.parse(r.body.lockedUntil) : NaN;
    const min = Math.max(1, Math.ceil((until - Date.now()) / 60_000));
    setError(r.code === 'LOCKED' && !Number.isNaN(until) ? `${msg}\n${t('login.lockedMinutes', { min })}` : msg);
  };

  return (
    <main className="flex flex-col gap-4">
      <h1 className="text-3xl font-extrabold">{t('login.title')}</h1>
      {step === 'empNo' ? (
        <>
          <p className="text-2xl font-bold">{t('login.empNo')}</p>
          <PinPad value={empNo} onChange={setEmpNo} maxLength={10} minLength={1} onSubmit={() => setStep('pin')} />
        </>
      ) : (
        <>
          <p className="text-2xl font-bold">{t('login.pin')}</p>
          <PinPad value={pin} onChange={setPin} maxLength={6} masked busy={busy} onSubmit={() => void submit()} />
          {error && (
            <p className="whitespace-pre-line rounded-xl bg-red-100 p-3 text-xl font-bold text-red-800" role="alert">
              {error}
            </p>
          )}
          <BigButton
            tone="white"
            onClick={() => {
              setStep('empNo');
              setPin('');
              setError(null);
            }}
          >
            {t('login.changeEmpNo')} ({empNo})
          </BigButton>
        </>
      )}
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <Login />
    </Suspense>
  );
}
