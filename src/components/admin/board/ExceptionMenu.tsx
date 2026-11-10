'use client';

import { useState } from 'react';
import { ABSENCE_KIND, REPORT_KINDS } from '../labels';
import { useBoard } from './BoardContext';
import { replaceActions, type BoardAction } from './logic';
import { PersonPicker } from './PersonPicker';

type Chip = { assignmentId: string; personId: string; name: string; empNo: string };

/** Name-chip menu: 예외 등록 (결근·병가·조퇴·지각), 다른 사람으로 바꾸기 (search, swap), 빼기. */
export function ExceptionMenu({ chip, postId, postLabel, onDone }: { chip: Chip; postId: string; postLabel: string; onDone: () => void }) {
  const { view, run, busy } = useBoard();
  const [picking, setPicking] = useState(false);
  const key = (what: string) => `${what}:${chip.assignmentId}`;
  const inFlight = REPORT_KINDS.some((k) => busy(key(k))) || busy(key('replace')) || busy(key('unassign'));

  const act = async (what: string, ...actions: BoardAction[]) => {
    if (actions.length === 0) return onDone();
    if (await run(key(what), ...actions)) onDone();
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[15px]">
        <span className="font-bold">{chip.name}</span> <span className="text-gray-500">{chip.empNo}</span>
        <span className="text-gray-500"> · {postLabel}</span>
      </p>

      <div>
        <p className="mb-1 text-xs font-semibold text-gray-500">예외 등록</p>
        <div className="grid grid-cols-4 gap-2">
          {REPORT_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              disabled={inFlight}
              onClick={() => void act(kind, { type: 'reportAbsence', personId: chip.personId, kind })}
              className="h-10 rounded-lg border border-red-300 bg-red-50 font-semibold text-red-800 hover:bg-red-100 disabled:opacity-50"
            >
              {ABSENCE_KIND[kind]}
            </button>
          ))}
        </div>
      </div>

      {picking ? (
        <div>
          <p className="mb-1 text-xs font-semibold text-gray-500">바꿀 사람 (같은 교대 다른 자리면 맞바꿈)</p>
          <PersonPicker disabled={inFlight} onPick={(p) => void act('replace', ...replaceActions(view, { ...chip, postId }, p.id))} />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={inFlight}
            onClick={() => setPicking(true)}
            className="h-10 rounded-lg border border-gray-300 font-semibold hover:bg-gray-50 disabled:opacity-50"
          >
            다른 사람으로 바꾸기
          </button>
          <button
            type="button"
            disabled={inFlight}
            onClick={() => void act('unassign', { type: 'unassign', assignmentId: chip.assignmentId })}
            className="h-10 rounded-lg border border-gray-300 font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            빼기
          </button>
        </div>
      )}
    </div>
  );
}
