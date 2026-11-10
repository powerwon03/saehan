'use client';

import type { SkillGrid } from '@/server/admin/skillGrid';
import { card } from '../common/styles';
import { cellIndex, type Level } from './logic';

const LEVEL_BG: Record<Level, string> = { 0: 'bg-white', 1: 'bg-amber-100', 2: 'bg-emerald-200', 3: 'bg-emerald-300' };
const LEVEL_NAME: Record<Level, string> = { 0: '없음', 1: '보조 필요', 2: '단독 가능', 3: '숙련·지도 가능' };

/**
 * People (rows) × posts (columns). Header row and the name column stay put while the grid scrolls inside its
 * own box. Manual values are bold, history-based ones grey; a click asks the parent to cycle the cell.
 */
export function SkillTable({ grid, busy, onCycle }: { grid: SkillGrid; busy: (key: string) => boolean; onCycle: (personId: string, postId: string) => void }) {
  if (grid.persons.length === 0 || grid.posts.length === 0)
    return <p className={`${card} p-10 text-center text-gray-500`}>이 공장에 재직 중인 사람이나 사용 중인 자리가 없어요</p>;
  const at = cellIndex(grid.cells);

  return (
    <div className={`${card} max-h-[calc(100vh-190px)] overflow-auto`}>
      <table className="border-separate border-spacing-0 text-[14px]">
        <thead>
          <tr>
            <th className="sticky top-0 left-0 z-20 border-r border-b border-gray-200 bg-gray-50 px-3 py-2 text-left font-semibold text-gray-500">이름</th>
            {grid.posts.map((p) => (
              <th key={p.id} title={p.name} className="sticky top-0 z-10 min-w-[64px] border-b border-gray-200 bg-gray-50 px-2 py-2 text-center font-semibold whitespace-nowrap">
                {p.code}
                {p.kind === 'fixed' && <span className="block text-xs font-normal text-gray-400">고정</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.persons.map((person) => (
            <tr key={person.id}>
              <th scope="row" className="sticky left-0 z-10 border-r border-b border-gray-100 bg-white px-3 py-1 text-left font-normal whitespace-nowrap">
                <span className="font-semibold">{person.name}</span> <span className="text-gray-500">{person.empNo}</span>
                <span className="ml-1 text-xs text-gray-400">{person.crew}조</span>
              </th>
              {grid.posts.map((post) => {
                const cell = at(person.id, post.id);
                const level = cell?.level ?? 0;
                const key = `${person.id}:${post.id}`;
                const how = cell?.manual ? '직접 입력' : '이력 기준';
                return (
                  <td key={post.id} className="border-b border-gray-100 p-0.5">
                    <button
                      type="button"
                      disabled={busy(key)}
                      onClick={() => onCycle(person.id, post.id)}
                      title={`${person.name} · ${post.code}: ${level} ${LEVEL_NAME[level]} (${how})`}
                      aria-label={`${person.name} ${post.code} 숙련도 ${level} ${how}`}
                      className={`h-9 w-full rounded text-[16px] hover:ring-2 hover:ring-blue-400 disabled:opacity-50 ${LEVEL_BG[level]} ${
                        cell?.manual ? 'font-extrabold text-gray-900' : 'font-normal text-gray-500'
                      }`}
                    >
                      {level}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
