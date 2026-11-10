'use client';

import { useState } from 'react';
import type { BoardView } from '@/server/views/boardView';
import { useBoard } from '../board/BoardContext';
import { CANDIDATE_KIND, REQUEST_STATUS, WARNING } from '../labels';
import { bulkTargets, minutesLeft, visibleCandidates } from './logic';

type Absence = BoardView['absences'][number];
type Candidate = Absence['candidates'][number];

const BTN = 'h-[42px] shrink-0 rounded-lg px-4 font-semibold disabled:opacity-50';

/**
 * Ranked substitutes for one absence: first 3 (+ everyone already asked) and 「후보 N명 더 보기」.
 * idle → 「바로 배치」; resting → 「요청」 and 「배치」 (after a phone call, with a confirm dialog).
 */
export function CandidateList({ absence, now }: { absence: Absence; now: number }) {
  const { run, busy } = useBoard();
  const [showAll, setShowAll] = useState(false);
  const { candidates, requests } = absence;
  const { shown, hidden } = visibleCandidates(candidates, requests, showAll);
  const bulk = bulkTargets(candidates, requests);
  const key = (what: string) => `${what}:${absence.id}`;
  const anyBusy = ['place', 'request', 'bulk'].some((w) => busy(key(w)));
  const postLabel = absence.post ? `${absence.post.code} ${absence.post.name}` : '';

  const place = (c: Candidate, phoned: boolean) => {
    if (phoned && !window.confirm(`전화로 확인하셨나요?\n${c.name}님을 ${postLabel}에 배치합니다.`)) return;
    void run(key('place'), { type: 'placeSub', absenceId: absence.id, personId: c.personId });
  };
  const request = (personIds: string[], what: 'request' | 'bulk') =>
    void run(key(what), { type: 'requestSubs', absenceId: absence.id, personIds });

  if (candidates.length === 0) return <p className="rounded-lg bg-gray-50 p-3 text-gray-600">추천할 사람이 없어요. 배치 화면의 「빈자리 +」에서 직접 찾아 넣어 주세요.</p>;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-gray-500">추천 {candidates.length}명</p>
        {bulk.length > 0 && (
          <button type="button" disabled={anyBusy} onClick={() => request(bulk, 'bulk')} className={`${BTN} bg-orange-500 text-white hover:bg-orange-600`}>
            {bulk.length}명에게 동시에 요청
          </button>
        )}
      </div>

      <ol className="flex flex-col divide-y divide-gray-100 rounded-lg border border-gray-200">
        {shown.map((c) => (
          <CandidateRow
            key={c.personId}
            c={c}
            rank={candidates.indexOf(c) + 1}
            req={[...requests].reverse().find((r) => r.personId === c.personId)}
            now={now}
            disabled={anyBusy}
            onPlace={place}
            onRequest={() => request([c.personId], 'request')}
          />
        ))}
      </ol>

      {(hidden > 0 || showAll) && candidates.length > 3 && (
        <button type="button" onClick={() => setShowAll((s) => !s)} className="h-[42px] rounded-lg border border-gray-300 font-semibold text-gray-700 hover:bg-gray-50">
          {showAll ? '접기' : `후보 ${hidden}명 더 보기`}
        </button>
      )}
    </div>
  );
}

function CandidateRow({
  c,
  rank,
  req,
  now,
  disabled,
  onPlace,
  onRequest,
}: {
  c: Candidate;
  rank: number;
  req: Absence['requests'][number] | undefined;
  now: number;
  disabled: boolean;
  onPlace: (c: Candidate, phoned: boolean) => void;
  onRequest: () => void;
}) {
  const reasons = c.reasons.map((r) => (r === 'exp' ? '업무 경험' : r === 'product' ? '같은 제품' : c.factoryName));
  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      <span className="w-6 text-center text-lg font-bold text-gray-400">{rank}</span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2">
          <span className="text-[18px] font-bold">{c.name}</span>
          <span className="text-sm text-gray-500">{c.empNo}</span>
          <span className={`rounded px-1.5 text-xs font-semibold leading-5 ${c.kind === 'idle' ? 'bg-blue-100 text-blue-800' : 'bg-gray-200 text-gray-700'}`}>
            {CANDIDATE_KIND[c.kind]}
          </span>
        </p>
        <p className="mt-0.5 flex flex-wrap gap-x-2 text-sm">
          {reasons.map((r) => (
            <span key={r} className="text-green-700">
              {r}
            </span>
          ))}
          {c.warnings.map((w) => (
            <span key={w} className="text-amber-700">
              ⚠ {w === 'hours' ? `이번 주 ${c.weekHours}시간` : WARNING[w]}
            </span>
          ))}
        </p>
      </div>
      {req && (
        <span className={`shrink-0 text-sm font-semibold ${req.status === 'sent' ? 'text-orange-600' : 'text-gray-500'}`}>
          {REQUEST_STATUS[req.status]}
          {req.status === 'sent' && ` · ${minutesLeft(req.expiresAt, now)}분 남음`}
        </span>
      )}
      {c.kind === 'idle' ? (
        <button type="button" disabled={disabled} onClick={() => onPlace(c, false)} className={`${BTN} bg-blue-600 text-white hover:bg-blue-700`}>
          바로 배치
        </button>
      ) : (
        <>
          {req?.status !== 'sent' && (
            <button type="button" disabled={disabled} onClick={onRequest} className={`${BTN} border border-orange-400 bg-white text-orange-700 hover:bg-orange-50`}>
              요청
            </button>
          )}
          <button type="button" disabled={disabled} onClick={() => onPlace(c, true)} className={`${BTN} border border-gray-300 bg-white hover:bg-gray-50`}>
            배치
          </button>
        </>
      )}
    </li>
  );
}
