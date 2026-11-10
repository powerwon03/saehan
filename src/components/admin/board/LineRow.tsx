'use client';

import type { BoardView } from '@/server/views/boardView';
import { useBoard } from './BoardContext';
import { planFromValue, planValue } from './logic';
import { PersonChip } from './PersonChip';
import { VacancySlot } from './VacancySlot';

type Line = BoardView['lines'][number];

/** Shared by the header row and LineRow so the columns line up. */
export const LINE_GRID = 'grid grid-cols-[150px_170px_84px_52px_minmax(0,1fr)] items-center gap-3';

/**
 * One post: code·name, product (제품 마스터 + 쉼 + 무인), 세우기, 필요 인원, name chips and 「빈자리 +」 slots.
 * A fixed post (post.kind 'fixed') has no product and is never stopped: no product select, no 세우기 toggle.
 */
export function LineRow({ line }: { line: Line }) {
  const { post, plan, stopped } = line;
  const fixed = post.kind === 'fixed';
  const postLabel = `${post.code} ${post.name}`;
  const idle = !fixed && (stopped || plan.status !== 'run');

  return (
    <div className={`${LINE_GRID} border-b border-gray-200 px-4 py-2 ${idle ? 'bg-gray-50' : 'bg-white'}`}>
      <div className="min-w-0">
        <p className="font-bold">{post.code}</p>
        <p className="truncate text-sm text-gray-600" title={post.name}>
          {post.name}
        </p>
      </div>

      {fixed ? (
        <>
          <span className="text-sm text-gray-400">고정 자리</span>
          <span />
        </>
      ) : (
        <LineControls line={line} postLabel={postLabel} />
      )}

      <p className="text-center text-lg font-bold">{line.need}</p>

      <div className="flex min-w-0 flex-wrap gap-2">
        {line.people.map((p) => (
          <PersonChip key={p.assignmentId} person={p} postId={post.id} postLabel={postLabel} />
        ))}
        {Array.from({ length: line.vacancies }, (_, i) => (
          <VacancySlot key={i} postId={post.id} postLabel={postLabel} />
        ))}
        {line.people.length === 0 && line.vacancies === 0 && <span className="text-sm text-gray-400">—</span>}
      </div>
    </div>
  );
}

/** Product select and 세우기 toggle of a line post (two grid cells). */
function LineControls({ line, postLabel }: { line: Line; postLabel: string }) {
  const { view, run, busy } = useBoard();
  const { post, plan, stopped } = line;
  const planKey = `plan:${post.id}`;
  const stopKey = `stop:${post.id}`;

  return (
    <>
      <select
        value={planValue(plan)}
        disabled={busy(planKey)}
        onChange={(e) => void run(planKey, { type: 'setPlan', postId: post.id, ...planFromValue(e.target.value) })}
        aria-label={`${postLabel} 제품`}
        className="h-10 min-w-0 rounded-lg border border-gray-300 bg-white px-2 text-[15px] disabled:opacity-50"
      >
        <option value="">제품 없음</option>
        {view.products.map((p) => (
          <option key={p.id} value={p.id}>
            {p.code} {p.name}
          </option>
        ))}
        <option value="off">쉼</option>
        <option value="unmanned">무인</option>
      </select>

      <button
        type="button"
        disabled={busy(stopKey)}
        onClick={() => void run(stopKey, { type: 'toggleStop', postId: post.id })}
        aria-pressed={stopped}
        title={stopped ? '다시 돌리기' : '이 라인 세우기'}
        className={`h-10 rounded-lg border font-semibold disabled:opacity-50 ${
          stopped ? 'border-amber-500 bg-amber-100 text-amber-900' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
        }`}
      >
        {stopped ? '세움' : '세우기'}
      </button>
    </>
  );
}
