'use client';

import { card, td, th } from '../common/styles';
import type { RunWrite } from '../common/useWrite';
import { AFFILIATION, LANG_NAME } from '../labels';
import type { PersonRow } from './logic';
import { RowActions } from './RowActions';

/** 사번 · 이름 · 공장 · 조 · 역할 · 소속 · 언어 · 전화 · 상태 (+ 잠김) and the row menu. */
export function PeopleTable({
  rows,
  factoryName,
  locked,
  run,
  busy,
  onEdit,
}: {
  rows: PersonRow[];
  factoryName: (id: string) => string;
  locked: (personId: string) => boolean;
  run: RunWrite;
  busy: (key: string) => boolean;
  onEdit: (p: PersonRow) => void;
}) {
  if (rows.length === 0) return <p className={`${card} p-10 text-center text-gray-500`}>찾는 사람이 없어요</p>;

  return (
    <table className={`${card} w-full border-separate border-spacing-0 text-[14px]`}>
      <thead>
        <tr>
          {['사번', '이름', '공장', '조', '역할', '소속', '언어', '전화', '상태', ''].map((h, i) => (
            <th key={i} className={`${th} ${i === 0 ? 'rounded-tl-xl' : ''} ${i === 9 ? 'rounded-tr-xl' : ''}`}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((p) => (
          <tr key={p.id} className={p.active ? '' : 'text-gray-500'}>
            <td className={`${td} font-mono`}>{p.empNo}</td>
            <td className={`${td} font-semibold`}>{p.name}</td>
            <td className={td}>{factoryName(p.factoryId)}</td>
            <td className={td}>{p.crew}</td>
            <td className={td}>{p.role ?? ''}</td>
            <td className={td}>{AFFILIATION[p.affiliation]}</td>
            <td className={td}>{LANG_NAME[p.lang]}</td>
            <td className={`${td} whitespace-nowrap`}>{p.phone ?? ''}</td>
            <td className={`${td} whitespace-nowrap`}>
              {p.active ? (
                <span className="rounded bg-green-100 px-2 py-0.5 text-sm font-semibold text-green-800">재직</span>
              ) : (
                <span className="rounded bg-gray-100 px-2 py-0.5 text-sm font-semibold text-gray-600">퇴사 {p.leftAt ?? ''}</span>
              )}
              {locked(p.id) && <span className="ml-1 rounded bg-red-100 px-2 py-0.5 text-sm font-semibold text-red-700">잠김</span>}
            </td>
            <td className={`${td} text-right`}>
              <RowActions person={p} locked={locked(p.id)} run={run} busy={busy(p.id)} onEdit={() => onEdit(p)} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
