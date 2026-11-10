'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { RevProvider } from '@/components/admin/common/RevContext';
import { errorText } from '@/components/admin/labels';
import { ToastProvider } from '@/components/admin/Toast';
import { api } from '@/lib/api';

type Me = { kind: 'admin' | 'worker'; name: string; companyName: string };

const MENU = [
  { href: '/admin', label: '배치' },
  { href: '/admin/leaves', label: '휴무 승인' },
  { href: '/admin/people', label: '근로자' },
  { href: '/admin/skills', label: '숙련도' },
  { href: '/admin/master', label: '기준 정보' },
  { href: '/admin/excel', label: '엑셀' },
  { href: '/admin/settings', label: '설정' },
];

/**
 * Admin shell: session gate (GET /api/me → admin only), left menu, company name and 로그아웃 at the top right,
 * and the page's one shared /api/rev poller (RevProvider).
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const r = await api<Me>('/api/me');
      if (cancelled) return;
      if (!r.ok) return r.status === 401 ? router.replace('/login') : setFailed(r.code);
      if (r.data.kind !== 'admin') return router.replace('/login');
      setMe(r.data);
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const logout = async () => {
    await api('/api/auth/logout', {});
    router.replace('/login');
  };

  if (!me)
    return (
      <p role={failed ? 'alert' : undefined} className="p-10 text-center text-gray-600">
        {failed ? errorText(failed) : '불러오는 중…'}
      </p>
    );

  return (
    <ToastProvider>
      <RevProvider>
        <div className="flex min-h-screen min-w-[1100px] bg-gray-100 text-[15px] text-gray-900">
          <aside className="sticky top-0 flex h-screen w-[220px] shrink-0 flex-col bg-slate-900 text-slate-200">
            <p className="px-6 py-4 text-lg font-extrabold text-white">원터치 라인</p>
            <nav className="flex flex-col gap-1 px-3">
              {MENU.map((m) => {
                const active = m.href === '/admin' ? pathname === '/admin' : pathname.startsWith(m.href);
                return (
                  <Link
                    key={m.href}
                    href={m.href}
                    aria-current={active ? 'page' : undefined}
                    className={`rounded-lg px-3 py-2.5 font-semibold ${active ? 'bg-slate-700 text-white' : 'hover:bg-slate-800'}`}
                  >
                    {m.label}
                  </Link>
                );
              })}
            </nav>
          </aside>
          <div className="flex min-w-0 flex-1 flex-col">
            <header className="sticky top-0 z-10 flex h-14 items-center justify-end gap-4 border-b border-gray-200 bg-white px-6">
              <span className="font-semibold">{me.companyName}</span>
              <span className="text-gray-500">{me.name}</span>
              <button type="button" onClick={() => void logout()} className="h-9 rounded-lg border border-gray-300 px-3 font-semibold hover:bg-gray-50">
                로그아웃
              </button>
            </header>
            <main className="min-w-0 flex-1 p-6">{children}</main>
          </div>
        </div>
      </RevProvider>
    </ToastProvider>
  );
}
