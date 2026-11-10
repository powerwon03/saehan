'use client';

import { useState } from 'react';
import { send } from '@/lib/api';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { btnPrimary, btnSm, btnSmDanger, card, td, th } from '../common/styles';
import type { RunWrite } from '../common/useWrite';
import { useToast } from '../Toast';
import type { Kind } from './fields';
import { cellText, type FieldSpec, type Row } from './logic';
import { MasterForm } from './MasterForm';

/** One 기준 정보 table with 추가 / 수정 / 삭제. Rows with active === false (hidden) are greyed. */
export function MasterTable({
  kind,
  title,
  fields,
  rows,
  run,
  busy,
  rowName,
}: {
  kind: Kind;
  title: string;
  fields: FieldSpec[];
  rows: Row[];
  run: RunWrite;
  busy: (key: string) => boolean;
  rowName: (row: Row) => string;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState<Row | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Row | null>(null);
  const path = `/api/admin/master/${kind}`;
  const cols = fields.filter((f) => !f.formOnly);

  const save = (payload: Row) => {
    const row = editing === 'new' ? null : editing;
    // inline errors in the form, so quiet
    return run(`save:${kind}`, () => (row ? send('PATCH', path, { ...payload, id: row.id }) : send('POST', path, payload)), { quiet: true });
  };
  const remove = async (row: Row) => {
    setDeleting(null);
    const r = await run<{ softDeleted?: boolean }>(String(row.id), () => send('DELETE', `${path}?id=${encodeURIComponent(String(row.id))}`));
    if (r.ok) toast(r.data.softDeleted ? '사용 중이라 숨김 처리했습니다' : '지웠어요');
  };

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center">
        <p className="text-gray-600">{rows.length}개</p>
        <button type="button" onClick={() => setEditing('new')} className={`${btnPrimary} ml-auto`}>
          {title} 추가
        </button>
      </div>
      {rows.length === 0 ? (
        <p className={`${card} p-10 text-center text-gray-500`}>아직 등록된 {title} 정보가 없어요</p>
      ) : (
        <table className={`${card} w-full border-separate border-spacing-0 overflow-hidden text-[14px]`}>
          <thead>
            <tr>
              {cols.map((f) => (
                <th key={f.key} className={th}>
                  {f.label}
                </th>
              ))}
              <th className={th} />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={String(row.id)} className={row.active === false ? 'bg-gray-50 text-gray-400' : ''}>
                {cols.map((f) => (
                  <td key={f.key} className={td}>
                    {cellText(f, row)}
                  </td>
                ))}
                <td className={`${td} text-right whitespace-nowrap`}>
                  <span className="inline-flex gap-2">
                    <button type="button" onClick={() => setEditing(row)} className={btnSm}>
                      수정
                    </button>
                    <button type="button" disabled={busy(String(row.id))} onClick={() => setDeleting(row)} className={btnSmDanger}>
                      삭제
                    </button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {editing && (
        <MasterForm
          key={editing === 'new' ? 'new' : String(editing.id)}
          title={editing === 'new' ? `${title} 추가` : `${title} 수정 · ${rowName(editing)}`}
          fields={fields}
          row={editing === 'new' ? null : editing}
          save={save}
          onClose={() => setEditing(null)}
        />
      )}
      {deleting && (
        <ConfirmDialog title={`${rowName(deleting)} 삭제`} confirmLabel="삭제" danger onCancel={() => setDeleting(null)} onConfirm={() => void remove(deleting)}>
          {kind === 'factories'
            ? '자리나 사람이 있는 공장은 지울 수 없어요.'
            : kind === 'standards'
              ? '이 표준 인원을 지울까요?'
              : '쓰고 있으면 지우지 않고 숨김(사용 안 함) 처리해요.'}
        </ConfirmDialog>
      )}
    </section>
  );
}
