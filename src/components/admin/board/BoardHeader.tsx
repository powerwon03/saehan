'use client';

import { addDays } from '@/engine/dates';
import { formatDate } from '@/i18n';
import { SHIFT } from '../labels';
import { useBoard } from './BoardContext';

/** URL query patch; null removes the key (no date/shift = the server's current shift). */
export type BoardQuery = { date?: string | null; shift?: string | null; factory?: string | null };

const seg = (on: boolean) =>
  `h-10 px-4 font-semibold ${on ? 'bg-slate-800 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`;

/** Factory select, 주간/야간, date ◀ ▶ and 오늘, plus the 결근 panel toggle. */
export function BoardHeader({ go, absenceCount, needsAction, onAbsences }: { go: (q: BoardQuery) => void; absenceCount: number; needsAction: boolean; onAbsences: () => void }) {
  const { view, factories } = useBoard();
  const here = { date: view.date, shift: view.shift };
  const options: { id: string; name: string }[] = factories.length > 0 ? factories : [view.factory];

  return (
    <div className="flex flex-wrap items-center gap-3">
      <select
        value={view.factory.id}
        onChange={(e) => go({ ...here, factory: e.target.value })}
        aria-label="공장"
        className="h-10 rounded-lg border border-gray-300 bg-white px-3 text-[15px] font-semibold"
      >
        {options.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
      </select>

      <div className="flex overflow-hidden rounded-lg border border-gray-300" role="group" aria-label="교대">
        {(['day', 'night'] as const).map((s) => (
          <button key={s} type="button" aria-pressed={view.shift === s} onClick={() => go({ ...here, shift: s })} className={seg(view.shift === s)}>
            {SHIFT[s]}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1">
        <button type="button" aria-label="전날" onClick={() => go({ ...here, date: addDays(view.date, -1) })} className="h-10 w-10 rounded-lg border border-gray-300 bg-white hover:bg-gray-50">
          ◀
        </button>
        <span className="min-w-[170px] text-center text-lg font-bold">
          {view.date.slice(0, 4)}년 {formatDate('ko', view.date)}
        </span>
        <button type="button" aria-label="다음 날" onClick={() => go({ ...here, date: addDays(view.date, 1) })} className="h-10 w-10 rounded-lg border border-gray-300 bg-white hover:bg-gray-50">
          ▶
        </button>
        <button type="button" onClick={() => go({ date: null, shift: null })} className="ml-1 h-10 rounded-lg border border-gray-300 bg-white px-3 font-semibold hover:bg-gray-50">
          오늘
        </button>
      </div>

      <button
        type="button"
        onClick={onAbsences}
        className={`ml-auto flex h-10 items-center gap-2 rounded-lg border px-4 font-semibold ${
          needsAction ? 'border-red-500 bg-red-600 text-white hover:bg-red-700' : 'border-gray-300 bg-white hover:bg-gray-50'
        }`}
      >
        결근 · 대체
        <span className={`rounded-full px-2 text-sm ${needsAction ? 'bg-white text-red-700' : 'bg-gray-200'}`}>{absenceCount}</span>
      </button>
    </div>
  );
}
