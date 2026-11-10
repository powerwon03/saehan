import { describe, expect, test } from 'vitest';
import { cancelLeave, decideLeave, requestLeave } from '@/engine/leave';
import type { Absence, LeaveRequest } from '@/engine/types';
import { COMPANY, ctxAt, makePerson, makeSnapshot } from '../helpers/fixtures';

// now = 2026-04-21 09:00 KST -> today 04-21. 04-22: crew A works day, crew C off.
const NOW = '2026-04-21T00:00:00Z';
const leave = (over: Partial<LeaveRequest> = {}): LeaveRequest => ({
  id: 'lv1',
  companyId: COMPANY,
  personId: 'a1',
  date: '2026-04-22',
  kind: 'leave',
  status: 'pending',
  createdAt: new Date(NOW),
  decidedAt: null,
  ...over,
});
const people = [makePerson({ id: 'a1', empNo: 'a1', crew: 'A' }), makePerson({ id: 'c1', empNo: 'c1', crew: 'C' })];
const snapOf = (leaves: LeaveRequest[] = []) => makeSnapshot({ persons: people, leaves });

describe('requestLeave', () => {
  test('내일~14일 뒤는 허용, pending 행 생성', () => {
    const c = requestLeave(snapOf(), { personId: 'a1', date: '2026-05-05' }, ctxAt(NOW));
    expect(c.upsert.leaves).toEqual([
      { id: 'id-1', companyId: COMPANY, personId: 'a1', date: '2026-05-05', kind: 'leave', status: 'pending', createdAt: new Date(NOW), decidedAt: null },
    ]);
    expect(requestLeave(snapOf(), { personId: 'a1', date: '2026-04-22', kind: 'annual' }, ctxAt(NOW)).upsert.leaves).toEqual([
      expect.objectContaining({ kind: 'annual' }),
    ]);
  });

  test('15일 뒤 신청 → OUT_OF_RANGE (오늘·과거도)', () => {
    for (const date of ['2026-05-06', '2026-04-21', '2026-04-20']) {
      expect(() => requestLeave(snapOf(), { personId: 'a1', date }, ctxAt(NOW))).toThrow(expect.objectContaining({ code: 'OUT_OF_RANGE' }));
    }
  });

  test('같은 날 pending/approved가 있으면 빈 Changes, rejected면 새로 신청', () => {
    const empty = { upsert: {}, remove: {}, messages: [] };
    expect(requestLeave(snapOf([leave()]), { personId: 'a1', date: '2026-04-22' }, ctxAt(NOW))).toEqual(empty);
    expect(requestLeave(snapOf([leave({ status: 'approved' })]), { personId: 'a1', date: '2026-04-22' }, ctxAt(NOW))).toEqual(empty);
    expect(requestLeave(snapOf([leave({ status: 'rejected' })]), { personId: 'a1', date: '2026-04-22' }, ctxAt(NOW)).upsert.leaves).toHaveLength(1);
  });
});

describe('cancelLeave', () => {
  test('pending만 취소된다', () => {
    const c = cancelLeave(snapOf([leave()]), { leaveId: 'lv1', personId: 'a1' }, ctxAt(NOW));
    expect(c.upsert.leaves).toEqual([leave({ status: 'cancelled', decidedAt: new Date(NOW) })]);
    expect(() => cancelLeave(snapOf([leave({ status: 'approved' })]), { leaveId: 'lv1', personId: 'a1' }, ctxAt(NOW))).toThrow(
      expect.objectContaining({ code: 'BAD_STATE' }),
    );
  });

  test('없으면 BAD_INPUT, 남의 것이면 FORBIDDEN', () => {
    expect(() => cancelLeave(snapOf(), { leaveId: 'x', personId: 'a1' }, ctxAt(NOW))).toThrow(expect.objectContaining({ code: 'BAD_INPUT' }));
    expect(() => cancelLeave(snapOf([leave()]), { leaveId: 'lv1', personId: 'c1' }, ctxAt(NOW))).toThrow(
      expect.objectContaining({ code: 'FORBIDDEN' }),
    );
  });
});

describe('decideLeave', () => {
  test('approve + 정규 근무일 → leave 결근 생성', () => {
    const c = decideLeave(snapOf([leave()]), { leaveId: 'lv1', approve: true }, ctxAt(NOW));
    expect(c.upsert.leaves).toEqual([leave({ status: 'approved', decidedAt: new Date(NOW) })]);
    expect(c.upsert.absences).toEqual([
      expect.objectContaining({ personId: 'a1', date: '2026-04-22', shift: 'day', kind: 'leave', reportedBy: 'support' }),
    ]);
    expect((c.upsert.absences![0] as Absence).status).toBe('pending-board');
    expect(c.messages.map((m) => m.bodyKey)).toEqual(['leaveApproved', 'absenceReported']);
    expect(c.messages[0]).toEqual({ companyId: COMPANY, personId: 'a1', bodyKey: 'leaveApproved', params: { date: '2026-04-22' }, channel: 'push' });
  });

  test('비근무일이면 승인만, 결근 없음', () => {
    const c = decideLeave(snapOf([leave({ personId: 'c1' })]), { leaveId: 'lv1', approve: true }, ctxAt(NOW));
    expect(c.upsert.leaves).toHaveLength(1);
    expect(c.upsert.absences).toBeUndefined();
    expect(c.messages.map((m) => m.bodyKey)).toEqual(['leaveApproved']);
  });

  test('reject → rejected + leaveRejected 메시지, 결근 없음', () => {
    const c = decideLeave(snapOf([leave()]), { leaveId: 'lv1', approve: false }, ctxAt(NOW));
    expect(c.upsert.leaves).toEqual([leave({ status: 'rejected', decidedAt: new Date(NOW) })]);
    expect(c.upsert.absences).toBeUndefined();
    expect(c.messages.map((m) => m.bodyKey)).toEqual(['leaveRejected']);
  });

  test('없으면 BAD_INPUT, pending 아니면 BAD_STATE', () => {
    expect(() => decideLeave(snapOf(), { leaveId: 'x', approve: true }, ctxAt(NOW))).toThrow(expect.objectContaining({ code: 'BAD_INPUT' }));
    expect(() => decideLeave(snapOf([leave({ status: 'approved' })]), { leaveId: 'lv1', approve: true }, ctxAt(NOW))).toThrow(
      expect.objectContaining({ code: 'BAD_STATE' }),
    );
  });
});
