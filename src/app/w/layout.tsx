'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, store, workerAction } from '@/components/worker/api';
import { BigButton } from '@/components/worker/BigButton';
import { LangMenu } from '@/components/worker/LangMenu';
import { WorkerContext, type WorkerCtx } from '@/components/worker/WorkerContext';
import { useRevPoll } from '@/hooks/useRevPoll';
import { errorKey, isLang, t as translate, type Lang } from '@/i18n';
import type { WorkerView } from '@/server/views/workerView';

const LANG_KEY = 'otl_lang';
type Me = { kind: 'admin' | 'worker'; mustChange: boolean };

/** Session gate (me → login / PIN change), language, the worker view and its 4 s revision polling. */
export default function WorkerLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [lang, setLang] = useState<Lang>('ko');
  const [view, setView] = useState<WorkerView | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const isLogin = pathname === '/w/login';
  const isPin = pathname === '/w/pin';

  useEffect(() => {
    const saved = store.get(LANG_KEY);
    if (isLang(saved)) setLang(saved);
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const reload = useCallback(async () => {
    const r = await api<WorkerView>('/api/worker');
    if (r.ok) {
      setView(r.data);
      setFailed(null);
      if (isLang(r.data.me.lang)) setLang(r.data.me.lang);
      store.set(LANG_KEY, r.data.me.lang);
    } else if (r.status === 401 || r.code === 'FORBIDDEN') router.replace('/w/login');
    else if (r.code === 'MUST_CHANGE_PIN') router.replace('/w/pin');
    else setFailed(r.code);
  }, [router]);

  useEffect(() => {
    if (isLogin) return setView(null);
    let cancelled = false;
    void (async () => {
      const me = await api<Me>('/api/me');
      if (cancelled) return;
      if (!me.ok) return me.status === 401 ? router.replace('/w/login') : setFailed(me.code);
      if (me.data.kind !== 'worker') return router.replace('/w/login');
      if (me.data.mustChange) return isPin ? undefined : router.replace('/w/pin');
      if (!isPin) await reload();
    })();
    return () => {
      cancelled = true;
    };
  }, [pathname, isLogin, isPin, reload, router]);

  useRevPoll(reload, view !== null && !isLogin && !isPin);

  const chooseLang = useCallback(
    (next: Lang) => {
      setLang(next);
      store.set(LANG_KEY, next);
      if (view) void workerAction({ type: 'setLang', lang: next });
    },
    [view],
  );
  const ctx = useMemo<WorkerCtx>(
    () => ({ lang, t: (key, params) => translate(lang, key, params), chooseLang, view, reload }),
    [lang, chooseLang, view, reload],
  );

  const gated = !isLogin && !isPin && !view;
  return (
    <WorkerContext.Provider value={ctx}>
      <div className="mx-auto flex min-h-screen max-w-[480px] flex-col gap-4 bg-gray-50 p-4 text-[18px] text-gray-900">
        <header className="flex items-center justify-between">
          <span className="text-lg font-bold text-gray-500">{ctx.t('app.title')}</span>
          <LangMenu />
        </header>
        {gated ? (
          <div className="flex flex-col gap-4 py-16 text-center text-xl">
            {failed ? (
              <>
                <p role="alert">{ctx.t(errorKey(failed))}</p>
                <BigButton tone="blue" onClick={() => void reload()}>
                  {ctx.t('common.retry')}
                </BigButton>
              </>
            ) : (
              <p>{ctx.t('common.loading')}</p>
            )}
          </div>
        ) : (
          children
        )}
      </div>
    </WorkerContext.Provider>
  );
}
