'use client';

import { BOARD_STATUS } from '../labels';
import { useBoard } from './BoardContext';

const STATUS_CHIP = { none: 'bg-gray-200 text-gray-700', draft: 'bg-yellow-100 text-yellow-900', confirmed: 'bg-green-100 text-green-800' };

/** 필요 · 출근 · 남음/부족, board status, and the 「자동 배치」 / 「확정」 actions. */
export function Summary() {
  const { view, run, busy } = useBoard();
  const { need, present, diff } = view.summary;
  const confirmed = view.status === 'confirmed';

  const autoAssign = () => {
    if (confirmed && !window.confirm('확정된 배치표예요. 다시 자동 배치할까요?\n직접 정한 자리(고정)는 그대로 둡니다.')) return;
    void run('autoAssign', { type: 'autoAssign' });
  };

  return (
    <div className="flex items-center gap-6 rounded-xl bg-white px-5 py-3 shadow-sm">
      <p className="text-lg">
        필요 <b>{need}</b>
        <span className="mx-2 text-gray-300">·</span>
        출근 <b>{present}</b>
        <span className="mx-2 text-gray-300">·</span>
        <b className={diff >= 0 ? 'text-green-700' : 'text-red-600'}>{diff >= 0 ? `남음 ${diff}` : `부족 ${-diff}`}</b>
      </p>
      <span className={`rounded-full px-3 py-1 text-sm font-semibold ${STATUS_CHIP[view.status]}`}>배치표 {BOARD_STATUS[view.status]}</span>

      <div className="ml-auto flex gap-2">
        <button
          type="button"
          disabled={busy('autoAssign')}
          onClick={autoAssign}
          className="h-10 rounded-lg bg-blue-600 px-5 font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busy('autoAssign') ? '배치 중…' : '자동 배치'}
        </button>
        {confirmed ? (
          <span className="flex h-10 items-center rounded-lg bg-green-100 px-5 font-semibold text-green-800" aria-disabled="true">
            확정됨
          </span>
        ) : (
          <button
            type="button"
            disabled={busy('confirm')}
            onClick={() => void run('confirm', { type: 'confirm' })}
            className="h-10 rounded-lg bg-green-600 px-5 font-semibold text-white hover:bg-green-700 disabled:opacity-50"
          >
            확정
          </button>
        )}
      </div>
    </div>
  );
}
