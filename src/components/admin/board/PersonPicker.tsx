'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { listPersons } from '@/server/admin/persons';
import { errorText } from '../labels';
import { useToast } from '../Toast';
import { useBoard } from './BoardContext';
import { placementOf } from './logic';

export type PersonRow = Awaited<ReturnType<typeof listPersons>>[number];

const DEBOUNCE_MS = 250;

/**
 * Search by 사번 or 이름 (GET /api/admin/persons?q=), pick one result. Only existing people can be picked —
 * there is no free-text save. Each result shows 조, 공장 and where the person sits on this board.
 */
export function PersonPicker({ onPick, disabled }: { onPick: (p: PersonRow) => void; disabled?: boolean }) {
  const { view, factories } = useBoard();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<PersonRow[] | null>(null);

  useEffect(() => {
    const query = q.trim();
    if (query === '') return setRows(null);
    let stale = false;
    const timer = setTimeout(async () => {
      const r = await api<{ persons: PersonRow[] }>(`/api/admin/persons?q=${encodeURIComponent(query)}`);
      if (stale) return;
      if (r.ok) setRows(r.data.persons);
      else toast(errorText(r.code));
    }, DEBOUNCE_MS);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [q, toast]);

  const factoryName = (id: string) => factories.find((f) => f.id === id)?.name ?? '';
  const whereNow = (personId: string) => {
    const at = placementOf(view, personId);
    if (at) return `${at.postCode} ${at.postName}`;
    return view.idle.some((p) => p.personId === personId) ? '대기' : '';
  };

  return (
    <div className="flex flex-col gap-2">
      <input
        type="search"
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="사번 또는 이름"
        aria-label="사번 또는 이름으로 찾기"
        className="h-10 rounded-lg border border-gray-300 px-3 text-[15px] outline-none focus:border-blue-500"
      />
      {rows !== null && rows.length === 0 && <p className="px-1 text-sm text-gray-500">찾는 사람이 없어요</p>}
      {rows !== null && rows.length > 0 && (
        <ul className="max-h-72 overflow-y-auto rounded-lg border border-gray-200">
          {rows.map((p) => {
            const where = whereNow(p.id);
            return (
              <li key={p.id} className="border-b border-gray-100 last:border-b-0">
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onPick(p)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-blue-50 disabled:opacity-50"
                >
                  <span className="font-semibold">{p.name}</span>
                  <span className="text-sm text-gray-500">{p.empNo}</span>
                  <span className="ml-auto flex shrink-0 gap-1 text-xs">
                    <span className="rounded bg-gray-100 px-1.5 py-0.5">{p.crew}조</span>
                    <span className="rounded bg-gray-100 px-1.5 py-0.5">{factoryName(p.factoryId)}</span>
                    {where && <span className="rounded bg-blue-100 px-1.5 py-0.5 text-blue-800">{where}</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
