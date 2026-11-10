'use client';

import { useEffect, useState } from 'react';
import type { BoardView } from '@/server/views/boardView';
import { useBoard } from '../board/BoardContext';
import { AbsenceCard } from './AbsenceCard';

type Absence = BoardView['absences'][number];

/** Cards needing a decision first, then requests in flight, then the rest (server order kept within a group). */
const ORDER: Absence['status'][] = ['decided', 'failed', 'in-progress', 'pending-board', 'not-needed', 'resolved'];
const TICK_MS = 15_000;

/** Re-render every 15 s so 「N분 남음」 counts down between board refetches. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** Right-hand 720px panel (spec: 추천 창 너비 720px) with one card per absence of this factory·date·shift. */
export function AbsencePanel({ focusId, onClose }: { focusId: string | null; onClose: () => void }) {
  const { view } = useBoard();
  const now = useNow();
  const absences = [...view.absences].sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status));

  return (
    <aside className="fixed top-14 right-0 bottom-0 z-20 flex w-[720px] flex-col border-l border-gray-200 bg-gray-50 shadow-2xl" aria-label="결근 · 대체">
      <div className="flex items-center justify-between border-b border-gray-200 bg-white px-5 py-3">
        <h2 className="text-lg font-bold">결근 · 대체 ({absences.length})</h2>
        <button type="button" onClick={onClose} className="h-[42px] rounded-lg border border-gray-300 px-4 font-semibold hover:bg-gray-50">
          닫기
        </button>
      </div>
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
        {absences.length === 0 && <p className="py-10 text-center text-gray-500">이 교대에 결근 신고가 없어요</p>}
        {absences.map((a) => (
          <AbsenceCard key={a.id} absence={a} now={now} focused={a.id === focusId} />
        ))}
      </div>
    </aside>
  );
}
