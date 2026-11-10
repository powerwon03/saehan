'use client';

import { useState } from 'react';
import { PageStatus } from '@/components/admin/common/PageStatus';
import { input } from '@/components/admin/common/styles';
import { useAdminData } from '@/components/admin/common/useAdminData';
import { useWrite } from '@/components/admin/common/useWrite';
import { cellIndex, nextLevel } from '@/components/admin/skills/logic';
import { SkillTable } from '@/components/admin/skills/SkillTable';
import { api } from '@/lib/api';
import type { SkillGrid } from '@/server/admin/skillGrid';
import type { factories } from '@/server/db/schema';

/** 숙련도: one factory's people × posts; a click cycles the cell 0→1→2→3→이력 기준 (POST /api/admin/skills). */
export default function SkillsPage() {
  const factoryRows = useAdminData<{ rows: (typeof factories.$inferSelect)[] }>('/api/admin/master/factories', false);
  const [picked, setPicked] = useState<string | null>(null);
  const factoryList = factoryRows.data?.rows ?? [];
  const factoryId = picked ?? factoryList[0]?.id ?? null;

  const grid = useAdminData<SkillGrid>(factoryId ? `/api/admin/skills?factoryId=${factoryId}` : null);
  const { run, busy } = useWrite(grid.reload);

  const cycle = (personId: string, postId: string) => {
    if (!grid.data) return;
    const level = nextLevel(cellIndex(grid.data.cells)(personId, postId));
    void run(`${personId}:${postId}`, () => api('/api/admin/skills', { personId, postId, level }));
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="text-xl font-extrabold">숙련도</h1>
        <select aria-label="공장" value={factoryId ?? ''} onChange={(e) => setPicked(e.target.value)} className={`${input} font-semibold`}>
          {factoryList.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
        <p className="text-sm text-gray-600">
          칸을 누르면 0 → 1 → 2 → 3 → 이력 기준 순서로 바뀌어요. <b className="text-gray-900">굵은 숫자</b>는 직접 넣은 값,{' '}
          <span className="text-gray-500">회색 숫자</span>는 근무 이력·지정 자리로 정해진 값이에요.
        </p>
      </div>
      {grid.data ? (
        <SkillTable grid={grid.data} busy={busy} onCycle={cycle} />
      ) : factoryRows.data && factoryList.length === 0 ? (
        <p className="py-20 text-center text-gray-500">등록된 공장이 없어요. 기준 정보에서 먼저 추가해 주세요</p>
      ) : (
        <PageStatus failed={grid.failed ?? factoryRows.failed} onRetry={() => void Promise.all([factoryRows.reload(), grid.reload()])} />
      )}
    </div>
  );
}
