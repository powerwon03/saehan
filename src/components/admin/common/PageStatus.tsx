'use client';

import { errorText } from '../labels';

/** Loading text, or the error with 「다시 해 보기」 (board page style). */
export function PageStatus({ failed, onRetry }: { failed: string | null; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-4 py-20 text-gray-600">
      {failed ? (
        <>
          <p role="alert">{errorText(failed)}</p>
          <button type="button" onClick={onRetry} className="h-10 rounded-lg border border-gray-300 bg-white px-4 font-semibold">
            다시 해 보기
          </button>
        </>
      ) : (
        <p>불러오는 중…</p>
      )}
    </div>
  );
}
