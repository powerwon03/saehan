'use client';

import { useCallback, useState } from 'react';
import { Popover } from '../Popover';
import { useBoard } from './BoardContext';
import { PersonPicker } from './PersonPicker';

const RECOMMENDING = ['decided', 'in-progress', 'failed'];

/**
 * Red dashed 「빈자리 +」. When an open absence card exists for this post, clicking opens that card (its ranked
 * recommendations); otherwise a panel to place one of the idle people (바로 배치) or anyone found by search.
 */
export function VacancySlot({ postId, postLabel }: { postId: string; postLabel: string }) {
  const { view, run, busy, showAbsence } = useBoard();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const absence = view.absences.find((a) => a.post?.id === postId && RECOMMENDING.includes(a.status));
  const key = `assign:${postId}`;

  const place = async (personId: string) => {
    if (await run(key, { type: 'assign', postId, personId })) close();
  };

  return (
    <Popover
      open={open}
      onClose={close}
      trigger={
        <button
          type="button"
          onClick={() => (absence ? showAbsence(absence.id) : setOpen((o) => !o))}
          className="h-[52px] rounded-lg border-2 border-dashed border-red-400 px-3 font-semibold text-red-600 hover:bg-red-50"
        >
          빈자리 +
        </button>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-[15px] font-bold">빈자리 · {postLabel}</p>
        <div>
          <p className="mb-1 text-xs font-semibold text-gray-500">대기 인원</p>
          {view.idle.length === 0 ? (
            <p className="text-sm text-gray-500">대기 인원이 없어요</p>
          ) : (
            <ul className="max-h-48 overflow-y-auto rounded-lg border border-gray-200">
              {view.idle.map((p) => (
                <li key={p.personId} className="flex items-center gap-2 border-b border-gray-100 px-3 py-1.5 last:border-b-0">
                  <span className="font-semibold">{p.name}</span>
                  <span className="text-sm text-gray-500">{p.empNo}</span>
                  <button
                    type="button"
                    disabled={busy(key)}
                    onClick={() => void place(p.personId)}
                    className="ml-auto h-8 rounded-md bg-blue-600 px-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    바로 배치
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <p className="mb-1 text-xs font-semibold text-gray-500">다른 사람 찾기</p>
          <PersonPicker disabled={busy(key)} onPick={(p) => void place(p.id)} />
        </div>
      </div>
    </Popover>
  );
}
