'use client';

import { useCallback, useEffect, useState } from 'react';
import { PageStatus } from '@/components/admin/common/PageStatus';
import { btnPrimary, input } from '@/components/admin/common/styles';
import { Tabs } from '@/components/admin/common/Tabs';
import { useAdminData } from '@/components/admin/common/useAdminData';
import { useWrite } from '@/components/admin/common/useWrite';
import { isLocked, type AccountRow, type PersonRow } from '@/components/admin/people/logic';
import { PeopleTable } from '@/components/admin/people/PeopleTable';
import { PersonForm } from '@/components/admin/people/PersonForm';
import type { factories, posts } from '@/server/db/schema';

type Active = 'true' | 'false' | 'all';
const FILTERS: { key: Active; label: string }[] = [
  { key: 'true', label: '재직' },
  { key: 'false', label: '퇴사' },
  { key: 'all', label: '전체' },
];
const DEBOUNCE_MS = 250;

/** 근로자: search + 재직/퇴사 filter, 「신규 입사」 and per-row 수정·퇴사·복직·삭제·PIN 재설정·잠금 풀기. */
export default function PeoplePage() {
  const [active, setActive] = useState<Active>('true');
  const [typed, setTyped] = useState('');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<PersonRow | 'new' | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setQ(typed.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [typed]);

  const people = useAdminData<{ persons: PersonRow[] }>(`/api/admin/persons?active=${active}${q ? `&q=${encodeURIComponent(q)}` : ''}`);
  const accounts = useAdminData<{ accounts: AccountRow[] }>('/api/admin/accounts');
  const factoryRows = useAdminData<{ rows: (typeof factories.$inferSelect)[] }>('/api/admin/master/factories', false);
  const postRows = useAdminData<{ rows: (typeof posts.$inferSelect)[] }>('/api/admin/master/posts', false);

  const { reload: reloadPeople } = people;
  const { reload: reloadAccounts } = accounts;
  const reload = useCallback(async () => {
    await Promise.all([reloadPeople(), reloadAccounts()]);
  }, [reloadPeople, reloadAccounts]);
  const { run, busy } = useWrite(reload);

  const factoryList = factoryRows.data?.rows ?? [];
  const factoryName = (id: string) => factoryList.find((f) => f.id === id)?.name ?? '';
  const now = new Date();
  const locked = (personId: string) => isLocked(accounts.data?.accounts.find((a) => a.personId === personId), now);
  const failed = people.failed ?? factoryRows.failed;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="text-xl font-extrabold">근로자</h1>
        <input
          type="search"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder="사번 또는 이름"
          aria-label="사번 또는 이름으로 찾기"
          className={`${input} w-60`}
        />
        <Tabs label="재직 상태" items={FILTERS} value={active} onChange={setActive} />
        <button type="button" disabled={factoryList.length === 0} onClick={() => setEditing('new')} className={`${btnPrimary} ml-auto`}>
          신규 입사
        </button>
      </div>

      {people.data && factoryRows.data ? (
        <PeopleTable rows={people.data.persons} factoryName={factoryName} locked={locked} run={run} busy={busy} onEdit={setEditing} />
      ) : (
        <PageStatus failed={failed} onRetry={() => void Promise.all([people.reload(), factoryRows.reload()])} />
      )}

      {editing && (
        <PersonForm
          key={editing === 'new' ? 'new' : editing.id}
          person={editing === 'new' ? null : editing}
          factoryList={factoryList}
          postList={postRows.data?.rows ?? []}
          onDone={reload}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
