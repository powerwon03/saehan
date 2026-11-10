'use client';

import { useEffect, useRef } from 'react';
import type { BoardView } from '@/server/views/boardView';
import { useBoard } from '../board/BoardContext';
import { ABSENCE_KIND, ABSENCE_STATUS, REQUEST_STATUS } from '../labels';
import { CandidateList } from './CandidateList';
import { minutesLeft, resolvedMinutes, seoulHm } from './logic';

type Absence = BoardView['absences'][number];

const RECOMMENDING: Absence['status'][] = ['decided', 'in-progress', 'failed'];
const STATUS_CHIP: Partial<Record<Absence['status'], string>> = {
  decided: 'bg-red-100 text-red-800',
  failed: 'bg-red-100 text-red-800',
  'in-progress': 'bg-orange-100 text-orange-800',
  resolved: 'bg-green-100 text-green-800',
};
const NOTE: Partial<Record<Absence['status'], string>> = {
  'pending-board': '배치표를 만들기 전에 들어온 신고예요. 자동 배치 때 이 사람은 빠집니다.',
  'not-needed': '남은 인원으로 충분해서 대체가 필요 없어요.',
  failed: '요청에 답한 사람이 없어요. 다시 골라 주세요.',
};

/** One absence: who · which post · reported time · kind · status, request progress, candidates, 「신고 취소」. */
export function AbsenceCard({ absence, now, focused }: { absence: Absence; now: number; focused: boolean }) {
  const { run, busy, view } = useBoard();
  const ref = useRef<HTMLElement>(null);
  const cancelKey = `cancel:${absence.id}`;
  const resolved = absence.status === 'resolved';

  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [focused]);

  const cancel = () => {
    if (!window.confirm(`${absence.person.name}님의 ${ABSENCE_KIND[absence.kind]} 신고를 취소할까요?\n보낸 요청은 취소되고 원래 배치로 돌아갑니다.`)) return;
    void run(cancelKey, { type: 'cancelAbsence', absenceId: absence.id });
  };

  return (
    <article ref={ref} className={`flex flex-col gap-3 rounded-xl border bg-white p-4 shadow-sm ${focused ? 'border-blue-500 ring-2 ring-blue-200' : 'border-gray-200'}`}>
      <header className="flex items-center gap-2">
        <span className="rounded bg-red-600 px-2 py-0.5 text-sm font-bold text-white">{ABSENCE_KIND[absence.kind]}</span>
        <span className="text-[18px] font-bold">{absence.person.name}</span>
        <span className="text-sm text-gray-500">{absence.person.empNo}</span>
        <span className="text-gray-700">· {absence.post ? `${absence.post.code} ${absence.post.name}` : '자리 없음'}</span>
        <span className="text-sm text-gray-500">· {seoulHm(absence.createdAt)} 신고</span>
        <span className={`ml-auto rounded-full px-3 py-0.5 text-sm font-semibold ${STATUS_CHIP[absence.status] ?? 'bg-gray-100 text-gray-700'}`}>
          {ABSENCE_STATUS[absence.status]}
        </span>
      </header>

      {resolved && absence.resolvedAt && (
        <p className="rounded-lg bg-green-50 px-4 py-3 text-[18px] font-bold text-green-800">
          {absence.resolvedPerson?.name ?? ''} 투입 완료 · {resolvedMinutes(absence.createdAt, absence.resolvedAt)}분 만에 해결
        </p>
      )}

      {NOTE[absence.status] && <p className="text-gray-600">{NOTE[absence.status]}</p>}

      {absence.requests.length > 0 && !resolved && (
        <div>
          <p className="mb-1 text-sm font-semibold text-gray-500">요청 현황</p>
          <ul className="flex flex-wrap gap-2">
            {absence.requests.map((r) => (
              <li key={r.id} className={`rounded-lg px-3 py-1 text-sm ${r.status === 'sent' ? 'bg-orange-50 text-orange-800' : 'bg-gray-100 text-gray-600'}`}>
                <b>{r.name}</b> {REQUEST_STATUS[r.status]}
                {r.status === 'sent' && ` · ${minutesLeft(r.expiresAt, now, view.requestExpiryMin)}분 남음`}
              </li>
            ))}
          </ul>
        </div>
      )}

      {RECOMMENDING.includes(absence.status) && absence.post && <CandidateList absence={absence} now={now} />}

      {!resolved && (
        <button
          type="button"
          disabled={busy(cancelKey)}
          onClick={cancel}
          className="self-start text-sm font-semibold text-gray-500 underline-offset-2 hover:text-gray-800 hover:underline disabled:opacity-50"
        >
          신고 취소
        </button>
      )}
    </article>
  );
}
