'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { send } from '@/lib/api';
import type { ImportPreview } from '@/server/excel/detect';
import { btn, btnPrimary, card } from '../common/styles';
import { errorText } from '../labels';
import { PreviewTable, SampleTable } from './PreviewTable';

type Committed = { kind: 'roster' | 'plan'; counts: ImportPreview['counts'] };

const KIND: Record<ImportPreview['kind'], string> = { roster: '명단', plan: '생산계획', unknown: '알 수 없는 양식' };

function upload<T>(file: File, mode: 'preview' | 'commit') {
  const body = new FormData();
  body.set('file', file);
  body.set('mode', mode);
  return send<T>('POST', '/api/admin/import', body);
}

/** Upload → preview (추가 N · 수정 M · 오류 K + rows, or the sample of an unknown file) → 「저장」 (same file, commit). */
export function ImportPanel() {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [done, setDone] = useState<Committed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setFile(null);
    setPreview(null);
    if (fileInput.current) fileInput.current.value = '';
  };

  const choose = async (f: File | null) => {
    setDone(null);
    setError(null);
    setPreview(null);
    setFile(f);
    if (!f) return;
    setBusy(true);
    const r = await upload<ImportPreview>(f, 'preview');
    setBusy(false);
    if (r.ok) setPreview(r.data);
    else if (r.status === 401) router.replace('/login');
    else setError(r.code);
  };

  const commit = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    const r = await upload<Committed>(file, 'commit');
    setBusy(false);
    if (!r.ok && r.status === 401) return router.replace('/login');
    if (!r.ok) return setError(r.code);
    setDone(r.data);
    reset();
  };

  const known = preview !== null && preview.kind !== 'unknown';
  const savable = known && preview.counts.add + preview.counts.update > 0;

  return (
    <section className={`${card} flex flex-col gap-4 p-5`}>
      <h2 className="font-bold">파일 올리기</h2>
      <div className="flex items-center gap-3">
        <input
          ref={fileInput}
          type="file"
          accept=".xlsx,.xls,.csv"
          disabled={busy}
          onChange={(e) => void choose(e.target.files?.[0] ?? null)}
          aria-label="엑셀 파일"
          className="text-[15px] file:mr-3 file:h-10 file:rounded-lg file:border file:border-gray-300 file:bg-white file:px-4 file:font-semibold"
        />
        {busy && <span className="text-gray-500">처리 중…</span>}
      </div>

      {error && (
        <p role="alert" className="font-semibold text-red-600">
          {errorText(error)}
        </p>
      )}

      {preview && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <span className="rounded bg-slate-800 px-2 py-0.5 text-sm font-semibold text-white">{KIND[preview.kind]}</span>
            {known ? (
              <p className="text-lg font-bold">
                추가 <span className="text-green-700">{preview.counts.add}</span> · 수정 <span className="text-blue-700">{preview.counts.update}</span> · 오류{' '}
                <span className="text-red-700">{preview.counts.error}</span>
              </p>
            ) : (
              <p className="font-semibold text-amber-700">알 수 없는 양식이라 미리보기만 합니다</p>
            )}
            <span className="ml-auto flex gap-2">
              <button type="button" disabled={busy} onClick={reset} className={btn}>
                취소
              </button>
              {known && (
                <button type="button" disabled={busy || !savable} onClick={() => void commit()} className={btnPrimary}>
                  저장
                </button>
              )}
            </span>
          </div>
          {(preview.inherited ?? 0) > 0 && (
            <p className="text-sm text-gray-600">나머지 라인은 직전 계획을 그대로 이어 씁니다 ({preview.inherited}칸)</p>
          )}
          {known && preview.counts.error > 0 && <p className="text-sm text-gray-600">오류 행은 건너뛰고 나머지만 저장해요.</p>}
          {known ? <PreviewTable rows={preview.rows} /> : <SampleTable sample={preview.sample ?? []} />}
        </div>
      )}

      {done && (
        <div role="status" className="rounded-lg bg-green-50 p-4">
          <p className="font-bold text-green-800">
            {KIND[done.kind]} 저장 완료 · 추가 {done.counts.add} · 수정 {done.counts.update} · 건너뜀 {done.counts.error}
          </p>
          {done.kind === 'roster' && done.counts.add > 0 && (
            <p className="mt-1 text-amber-800">새로 등록된 사람은 근로자 화면에서 PIN을 설정해야 로그인할 수 있습니다</p>
          )}
        </div>
      )}
    </section>
  );
}
