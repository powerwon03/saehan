'use client';

import { useState } from 'react';
import { ConfirmDialog } from '@/components/admin/common/ConfirmDialog';
import { PageStatus } from '@/components/admin/common/PageStatus';
import { Tabs } from '@/components/admin/common/Tabs';
import { useAdminData } from '@/components/admin/common/useAdminData';
import { useWrite } from '@/components/admin/common/useWrite';
import { LeaveTable, type LeaveRow } from '@/components/admin/leaves/LeaveTable';
import { formatDate } from '@/i18n';
import { api } from '@/lib/api';

type Status = LeaveRow['status'];
const TABS: { key: Status; label: string }[] = [
  { key: 'pending', label: '대기' },
  { key: 'approved', label: '승인' },
  { key: 'rejected', label: '반려' },
  { key: 'cancelled', label: '취소' },
];

/** 휴무 승인: requests by status; approving a work day asks first (it becomes an absence with substitutes). */
export default function LeavesPage() {
  const [status, setStatus] = useState<Status>('pending');
  const { data, failed, reload } = useAdminData<LeaveRow[]>(`/api/admin/leaves?status=${status}`);
  const { run, busy } = useWrite(reload);
  const [confirming, setConfirming] = useState<LeaveRow | null>(null);

  const decide = (row: LeaveRow, approve: boolean) => run(row.id, () => api('/api/admin/leaves', { leaveId: row.id, approve }));
  const onDecide = (row: LeaveRow, approve: boolean) => {
    if (approve && row.regularShift !== 'off') setConfirming(row);
    else void decide(row, approve);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <h1 className="text-xl font-extrabold">휴무 승인</h1>
        <Tabs label="상태" items={TABS} value={status} onChange={setStatus} />
      </div>
      {data ? <LeaveTable rows={data} busy={busy} onDecide={onDecide} /> : <PageStatus failed={failed} onRetry={() => void reload()} />}
      {confirming && (
        <ConfirmDialog
          title={`${confirming.name} · ${formatDate('ko', confirming.date)} 휴무 승인`}
          confirmLabel="승인"
          busy={busy(confirming.id)}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            const row = confirming;
            setConfirming(null);
            void decide(row, true);
          }}
        >
          승인하면 그날 결근 처리되고 대체 추천이 뜹니다
        </ConfirmDialog>
      )}
    </div>
  );
}
