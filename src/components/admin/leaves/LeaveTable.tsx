'use client';

import type { DateStr, LeaveRequest, ShiftOrOff } from '@/engine/types';
import { formatDate } from '@/i18n';
import { seoulDateTime } from '../common/format';
import { btnSm, btnSmPrimary, card, td, th } from '../common/styles';
import { SHIFT_OR_OFF } from '../labels';

/** One row of GET /api/admin/leaves (createdAt arrives as an ISO string). */
export type LeaveRow = {
  id: string;
  personId: string;
  name: string;
  empNo: string;
  date: DateStr;
  kind: string;
  status: LeaveRequest['status'];
  createdAt: string;
  regularShift: ShiftOrOff;
};

/** 날짜 · 이름(사번) · 그날 근무 · 신청 시각, with 「승인」/「반려」 on pending rows. */
export function LeaveTable({ rows, busy, onDecide }: { rows: LeaveRow[]; busy: (id: string) => boolean; onDecide: (row: LeaveRow, approve: boolean) => void }) {
  if (rows.length === 0) return <p className={`${card} p-10 text-center text-gray-500`}>해당하는 휴무 신청이 없어요</p>;
  const pending = rows.some((r) => r.status === 'pending');

  return (
    <table className={`${card} w-full border-separate border-spacing-0 overflow-hidden`}>
      <thead>
        <tr>
          <th className={th}>날짜</th>
          <th className={th}>이름(사번)</th>
          <th className={th}>그날 근무</th>
          <th className={th}>신청 시각</th>
          {pending && <th className={th} />}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <td className={`${td} font-semibold`}>{formatDate('ko', r.date)}</td>
            <td className={td}>
              {r.name} <span className="text-gray-500">({r.empNo})</span>
            </td>
            <td className={td}>
              <span className={`rounded px-2 py-0.5 text-sm font-semibold ${r.regularShift === 'off' ? 'bg-gray-100 text-gray-600' : 'bg-blue-100 text-blue-800'}`}>
                {SHIFT_OR_OFF[r.regularShift]}
              </span>
            </td>
            <td className={`${td} text-gray-600`}>{seoulDateTime(r.createdAt)}</td>
            {pending && (
              <td className={`${td} text-right whitespace-nowrap`}>
                {r.status === 'pending' && (
                  <span className="inline-flex gap-2">
                    <button type="button" disabled={busy(r.id)} onClick={() => onDecide(r, true)} className={btnSmPrimary}>
                      승인
                    </button>
                    <button type="button" disabled={busy(r.id)} onClick={() => onDecide(r, false)} className={btnSm}>
                      반려
                    </button>
                  </span>
                )}
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
