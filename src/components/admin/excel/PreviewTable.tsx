import type { ImportPreview } from '@/server/excel/detect';
import { card, td, th } from '../common/styles';

const ACTION: Record<ImportPreview['rows'][number]['action'], { label: string; cls: string }> = {
  add: { label: '추가', cls: 'bg-green-100 text-green-800' },
  update: { label: '수정', cls: 'bg-blue-100 text-blue-800' },
  error: { label: '오류', cls: 'bg-red-100 text-red-800' },
};

/** Preview rows: 행 · 구분 (추가/수정/오류 colours) · 키 · 오류 사유; error rows are red. */
export function PreviewTable({ rows }: { rows: ImportPreview['rows'] }) {
  if (rows.length === 0) return <p className={`${card} p-8 text-center text-gray-500`}>읽을 행이 없어요</p>;
  return (
    <div className={`${card} max-h-[520px] overflow-auto`}>
      <table className="w-full border-separate border-spacing-0 text-[14px]">
        <thead className="sticky top-0">
          <tr>
            <th className={th}>행</th>
            <th className={th}>구분</th>
            <th className={th}>키</th>
            <th className={th}>오류 사유</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.row} className={r.action === 'error' ? 'bg-red-50 text-red-900' : ''}>
              <td className={`${td} text-gray-500`}>{r.row}</td>
              <td className={td}>
                <span className={`rounded px-2 py-0.5 text-sm font-semibold ${ACTION[r.action].cls}`}>{ACTION[r.action].label}</span>
              </td>
              <td className={`${td} font-mono`}>{r.key}</td>
              <td className={td}>{r.errors.join(', ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Unknown format: the first rows as they are (first row = header style). */
export function SampleTable({ sample }: { sample: string[][] }) {
  if (sample.length === 0) return <p className={`${card} p-8 text-center text-gray-500`}>파일이 비어 있어요</p>;
  return (
    <div className={`${card} max-h-[520px] overflow-auto`}>
      <table className="w-full border-separate border-spacing-0 text-[14px]">
        <tbody>
          {sample.map((cells, i) => (
            <tr key={i} className={i === 0 ? 'bg-gray-50 font-semibold' : ''}>
              {cells.map((c, j) => (
                <td key={j} className={`${td} whitespace-nowrap`}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
