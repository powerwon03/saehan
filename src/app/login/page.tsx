'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { errorText } from '@/components/admin/labels';
import { t } from '@/i18n';
import { api, loginCompany } from '@/lib/api';

type LoginReply = { ok: true; mustChange: boolean };

/** Admin (PC) login: 아이디 + 비밀번호; company from `?company=` (or the remembered one), else the server default. */
function Login() {
  const router = useRouter();
  const query = useSearchParams().get('company');
  const [loginId, setLoginId] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!loginId.trim() || !secret) return;
    setBusy(true);
    setError(null);
    const company = loginCompany(query);
    const r = await api<LoginReply>('/api/auth/login', { ...(company ? { company } : {}), kind: 'admin', loginId: loginId.trim(), secret });
    setBusy(false);
    if (r.ok) return router.replace('/admin');
    setSecret('');
    if (r.code === 'INVALID') return setError('아이디나 비밀번호가 맞지 않아요'); // the dictionary text speaks of 사번/PIN
    const until = typeof r.body.lockedUntil === 'string' ? Date.parse(r.body.lockedUntil) : NaN;
    const min = Math.max(1, Math.ceil((until - Date.now()) / 60_000));
    setError(r.code === 'LOCKED' && !Number.isNaN(until) ? `${errorText('LOCKED')} · ${t('ko', 'login.lockedMinutes', { min })}` : errorText(r.code));
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-100 text-gray-900">
      <form onSubmit={(e) => void submit(e)} className="flex w-[380px] flex-col gap-4 rounded-2xl bg-white p-8 shadow-lg">
        <div>
          <h1 className="text-2xl font-extrabold">원터치 라인</h1>
          <p className="text-gray-500">관리자 로그인</p>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-semibold">아이디</span>
          <input
            value={loginId}
            onChange={(e) => setLoginId(e.target.value)}
            autoComplete="username"
            autoFocus
            className="h-11 rounded-lg border border-gray-300 px-3 outline-none focus:border-blue-500"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-semibold">비밀번호</span>
          <input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            autoComplete="current-password"
            className="h-11 rounded-lg border border-gray-300 px-3 outline-none focus:border-blue-500"
          />
        </label>
        {error && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 font-semibold text-red-700">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy || !loginId.trim() || !secret} className="h-12 rounded-lg bg-blue-600 text-lg font-bold text-white hover:bg-blue-700 disabled:opacity-50">
          {busy ? '확인 중…' : '로그인'}
        </button>
      </form>
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
