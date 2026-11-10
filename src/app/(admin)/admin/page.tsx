'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AbsencePanel } from '@/components/admin/absence/AbsencePanel';
import { BoardContext, type BoardCtx, type FactoryRow } from '@/components/admin/board/BoardContext';
import { BoardHeader, type BoardQuery } from '@/components/admin/board/BoardHeader';
import { useRevChange } from '@/components/admin/common/RevContext';
import { LINE_GRID, LineRow } from '@/components/admin/board/LineRow';
import type { BoardAction } from '@/components/admin/board/logic';
import { Summary } from '@/components/admin/board/Summary';
import { errorText } from '@/components/admin/labels';
import { useToast } from '@/components/admin/Toast';
import { api } from '@/lib/api';
import type { BoardView } from '@/server/views/boardView';

/** Absence statuses that want the supervisor's decision: a new one (or one that came back) opens the panel. */
const NEEDS_ACTION: BoardView['absences'][number]['status'][] = ['decided', 'failed'];

/** 배치: one factory · date · shift board (state in `?date&shift&factory`), refetched on every revision change. */
function Board() {
  const router = useRouter();
  const params = useSearchParams();
  const query = params.toString();
  const toast = useToast();
  const [view, setView] = useState<BoardView | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [factories, setFactories] = useState<FactoryRow[]>([]);
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [panel, setPanel] = useState<{ open: boolean; focusId: string | null }>({ open: false, focusId: null });
  const loadSeq = useRef(0);
  const seen = useRef(new Set<string>());

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    const r = await api<BoardView>(`/api/admin/board${query ? `?${query}` : ''}`);
    if (seq !== loadSeq.current) return; // a newer load (other date/factory) superseded this one
    if (r.ok) {
      setView(r.data);
      setFailed(null);
    } else if (r.status === 401) router.replace('/login');
    else setFailed(r.code);
  }, [query, router]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    void api<{ rows: FactoryRow[] }>('/api/admin/master/factories').then((r) => r.ok && setFactories(r.data.rows));
  }, []);
  useRevChange(load, view !== null);

  useEffect(() => {
    if (!view) return;
    const fresh = view.absences.filter((a) => NEEDS_ACTION.includes(a.status) && !seen.current.has(`${a.id}:${a.status}`));
    for (const a of view.absences) seen.current.add(`${a.id}:${a.status}`);
    if (fresh.length > 0) setPanel({ open: true, focusId: fresh[0].id });
  }, [view]);

  const go = useCallback(
    (patch: BoardQuery) => {
      const next = new URLSearchParams(query);
      for (const [k, v] of Object.entries(patch)) {
        if (v) next.set(k, v);
        else next.delete(k);
      }
      const qs = next.toString();
      router.replace(qs ? `/admin?${qs}` : '/admin');
    },
    [query, router],
  );

  const run = useCallback(
    async (key: string, ...actions: BoardAction[]) => {
      if (!view) return false;
      const slot = { date: view.date, shift: view.shift, factoryId: view.factory.id };
      setPending((s) => new Set(s).add(key));
      let ok = true;
      for (const action of actions) {
        const r = await api('/api/admin/board', { ...action, ...slot });
        if (r.ok) continue;
        ok = false;
        if (r.status === 401) router.replace('/login');
        else toast(errorText(r.code));
        break;
      }
      await load();
      setPending((s) => {
        const next = new Set(s);
        next.delete(key);
        return next;
      });
      return ok;
    },
    [view, load, router, toast],
  );

  const ctx = useMemo<BoardCtx | null>(
    () =>
      view && {
        view,
        factories,
        run,
        busy: (key) => pending.has(key),
        showAbsence: (id) => setPanel({ open: true, focusId: id }),
      },
    [view, factories, run, pending],
  );

  if (!ctx)
    return (
      <div className="flex flex-col items-center gap-4 py-20 text-gray-600">
        {failed ? (
          <>
            <p role="alert">{errorText(failed)}</p>
            <button type="button" onClick={() => void load()} className="h-10 rounded-lg border border-gray-300 bg-white px-4 font-semibold">
              다시 해 보기
            </button>
          </>
        ) : (
          <p>불러오는 중…</p>
        )}
      </div>
    );

  const { absences } = ctx.view;
  return (
    <BoardContext.Provider value={ctx}>
      <div className="flex flex-col gap-4">
        <BoardHeader
          go={go}
          absenceCount={absences.length}
          needsAction={absences.some((a) => NEEDS_ACTION.includes(a.status))}
          onAbsences={() => setPanel((p) => ({ open: !p.open, focusId: null }))}
        />
        <Summary />
        <section className="rounded-xl border border-gray-200 bg-white shadow-sm" aria-label="라인별 배치">
          <div className={`${LINE_GRID} rounded-t-xl border-b border-gray-200 bg-gray-50 px-4 py-2 text-sm font-semibold text-gray-500`}>
            <span>라인</span>
            <span>제품</span>
            <span>세우기</span>
            <span className="text-center">필요</span>
            <span>이름</span>
          </div>
          {ctx.view.lines.length === 0 && <p className="p-8 text-center text-gray-500">이 공장에 등록된 자리가 없어요</p>}
          {ctx.view.lines.map((l) => (
            <LineRow key={l.post.id} line={l} />
          ))}
        </section>
      </div>
      {panel.open && <AbsencePanel focusId={panel.focusId} onClose={() => setPanel({ open: false, focusId: null })} />}
    </BoardContext.Provider>
  );
}

export default function BoardPage() {
  return (
    <Suspense>
      <Board />
    </Suspense>
  );
}
