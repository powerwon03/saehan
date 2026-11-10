import { describe, expect, test } from 'vitest';
import {
  cancelAbsence,
  expireRequests,
  placeSub,
  reportAbsence,
  requestSubs,
  respondSub,
} from '@/engine/absence';
import {
  EngineError,
  type Absence,
  type Assignment,
  type Board,
  type Snapshot,
  type SubRequest,
} from '@/engine/types';
import { COMPANY, ctxAt, makePerson, makePost, makeSnapshot } from '../helpers/fixtures';

// 2026-04-22: f1 -> crew A day, B night, C off.
const D = '2026-04-22';
const BEFORE = '2026-04-21T00:00:00Z'; // 04-21 09:00 KST, day shift not yet started
const AFTER = '2026-04-21T23:00:00Z'; // 04-22 08:00 KST, day shift started

const worker = (id: string) => makePerson({ id, empNo: id, crew: 'A' }); // day on D
const idle = worker;
const rest = (id: string) => makePerson({ id, empNo: id, crew: 'C' }); // off on D

const board: Board = {
  companyId: COMPANY,
  date: D,
  shift: 'day',
  factoryId: 'f1',
  status: 'draft',
  stoppedPostIds: [],
  confirmedAt: null,
  confirmedBy: null,
};
const asg = (over: Partial<Assignment> = {}): Assignment => ({
  id: 'as1',
  companyId: COMPANY,
  date: D,
  shift: 'day',
  factoryId: 'f1',
  postId: 'L1',
  personId: 'w1',
  source: 'auto',
  locked: false,
  reason: null,
  flags: [],
  createdAt: new Date('2026-04-20T00:00:00Z'),
  ...over,
});
const absence = (over: Partial<Absence> = {}): Absence => ({
  id: 'ab1',
  companyId: COMPANY,
  date: D,
  shift: 'day',
  factoryId: 'f1',
  personId: 'w1',
  postId: 'L1',
  kind: 'absent',
  reportedBy: 'self',
  reason: null,
  status: 'decided',
  resolvedPersonId: null,
  round: 1,
  restore: asg(),
  createdAt: new Date('2026-04-20T00:00:00Z'),
  resolvedAt: null,
  ...over,
});
const req = (over: Partial<SubRequest> = {}): SubRequest => ({
  id: 'rq1',
  companyId: COMPANY,
  absenceId: 'ab1',
  personId: 'r1',
  round: 1,
  rank: 1,
  status: 'sent',
  sentAt: new Date(BEFORE),
  expiresAt: new Date('2026-04-21T00:20:00Z'),
  respondedAt: null,
  ...over,
});
const snapOf = (over: Partial<Snapshot> = {}) =>
  makeSnapshot({ posts: [makePost({ id: 'L1', code: 'L1' })], ...over });

const upserts = <T>(c: { upsert: Record<string, object[] | undefined> }, t: string) => (c.upsert[t] ?? []) as T[];
const bodyKeys = (c: { messages: { bodyKey: string }[] }) => c.messages.map((m) => m.bodyKey);

describe('reportAbsence', () => {
  const input = { personId: 'w1', date: D, shift: 'day' as const, kind: 'absent' as const, reportedBy: 'self' as const };

  test('같은 사람·날짜·교대 중복 신고는 빈 Changes', () => {
    const snap = snapOf({ persons: [worker('w1')], absences: [absence({ status: 'pending-board' })] });
    expect(reportAbsence(snap, input, ctxAt(BEFORE))).toEqual({ upsert: {}, remove: {}, messages: [] });
  });

  test('취소된 결근이 있으면 새로 신고된다', () => {
    const snap = snapOf({ persons: [worker('w1')], absences: [absence({ status: 'cancelled' })] });
    expect(upserts<Absence>(reportAbsence(snap, input, ctxAt(BEFORE)), 'absences')).toHaveLength(1);
  });

  test('배치표 없으면 pending-board', () => {
    const snap = snapOf({ persons: [worker('w1')] });
    const c = reportAbsence(snap, { ...input, reason: '감기' }, ctxAt(BEFORE));
    const [a] = upserts<Absence>(c, 'absences');
    expect(a).toMatchObject({
      id: 'id-1',
      status: 'pending-board',
      factoryId: 'f1',
      postId: null,
      restore: null,
      round: 1,
      resolvedPersonId: null,
      resolvedAt: null,
      reason: '감기',
    });
    expect(c.messages).toEqual([
      {
        companyId: COMPANY,
        personId: null,
        bodyKey: 'absenceReported',
        params: { absenceId: 'id-1', personId: 'w1', date: D, shift: 'day', postId: null },
        channel: 'admin',
      },
    ]);
  });

  test('배치가 없던 사람(배치표는 있음)은 not-needed', () => {
    const snap = snapOf({ persons: [worker('w1')], boards: [board] });
    const [a] = upserts<Absence>(reportAbsence(snap, input, ctxAt(BEFORE)), 'absences');
    expect(a.status).toBe('not-needed');
    expect(a.reason).toBeNull();
  });

  test('남은 인원 ≥ 필요면 not-needed', () => {
    const snap = snapOf({
      persons: [worker('w1'), worker('w2')],
      boards: [board],
      assignments: [asg(), asg({ id: 'as2', personId: 'w2' })],
    });
    const c = reportAbsence(snap, input, ctxAt(BEFORE)); // need 1, remaining 1
    expect(upserts<Absence>(c, 'absences')[0].status).toBe('not-needed');
  });

  test('남은 인원 < 필요면 decided, 배치 삭제, restore에 원래 배치', () => {
    const snap = snapOf({ persons: [worker('w1')], boards: [board], assignments: [asg()] });
    const c = reportAbsence(snap, input, ctxAt(BEFORE));
    const [a] = upserts<Absence>(c, 'absences');
    expect(a.status).toBe('decided');
    expect(a.postId).toBe('L1');
    expect(a.restore).toEqual(asg());
    expect(c.remove.assignments).toEqual(['as1']);
  });

  test('다른 공장에 배치돼 있어도 그 배치를 삭제하고 그 공장 기준으로 기록', () => {
    const snap = snapOf({
      persons: [worker('w1')],
      boards: [{ ...board, factoryId: 'f2' }],
      posts: [makePost({ id: 'L1' }), makePost({ id: 'P2', factoryId: 'f2', code: 'P2' })],
      assignments: [asg({ factoryId: 'f2', postId: 'P2' })],
    });
    const c = reportAbsence(snap, input, ctxAt(BEFORE));
    expect(upserts<Absence>(c, 'absences')[0]).toMatchObject({ factoryId: 'f2', postId: 'P2', status: 'decided' });
    expect(c.remove.assignments).toEqual(['as1']);
  });
});

describe('requestSubs', () => {
  test('3명 → sent 3건, expiresAt = now+20분, absence in-progress', () => {
    const snap = snapOf({
      persons: [worker('w1'), rest('r1'), rest('r2'), rest('r3')],
      absences: [absence()],
    });
    const c = requestSubs(snap, { absenceId: 'ab1', personIds: ['r1', 'r2', 'r3'] }, ctxAt(BEFORE));
    const rows = upserts<SubRequest>(c, 'subRequests');
    expect(rows.map((r) => [r.personId, r.rank, r.round, r.status])).toEqual([
      ['r1', 1, 1, 'sent'],
      ['r2', 2, 1, 'sent'],
      ['r3', 3, 1, 'sent'],
    ]);
    expect(rows.every((r) => r.expiresAt.toISOString() === '2026-04-21T00:20:00.000Z')).toBe(true);
    expect(upserts<Absence>(c, 'absences')[0].status).toBe('in-progress');
    expect(c.messages).toHaveLength(3);
    expect(c.messages[0]).toMatchObject({
      personId: 'r1',
      bodyKey: 'subRequest',
      channel: 'push',
      params: { absenceId: 'ab1', date: D, shift: 'day', postId: 'L1', expiresAt: '2026-04-21T00:20:00.000Z' },
    });
  });

  test('canWorkExtra 탈락자와 이미 sent인 사람은 건너뛰고, rank는 기존 요청 뒤로 이어진다', () => {
    const snap = snapOf({
      persons: [worker('w1'), rest('r1'), rest('r2'), makePerson({ id: 'b1', empNo: 'b1', crew: 'B' })],
      absences: [absence({ status: 'in-progress' })],
      subRequests: [req()],
    });
    const c = requestSubs(snap, { absenceId: 'ab1', personIds: ['r1', 'b1', 'r2'] }, ctxAt(BEFORE));
    const rows = upserts<SubRequest>(c, 'subRequests');
    expect(rows.map((r) => [r.personId, r.rank])).toEqual([['r2', 2]]);
  });

  test('후보가 없으면 NO_CANDIDATES', () => {
    const snap = snapOf({ persons: [worker('w1'), worker('i1')], absences: [absence()] });
    expect(() => requestSubs(snap, { absenceId: 'ab1', personIds: ['i1'] }, ctxAt(BEFORE))).toThrow(
      expect.objectContaining({ code: 'NO_CANDIDATES' }),
    );
  });

  test('없는 결근 BAD_INPUT, resolved ALREADY_RESOLVED, 그 밖의 상태 BAD_STATE', () => {
    const snap = snapOf({
      persons: [rest('r1')],
      absences: [absence({ id: 'ok' }), absence({ id: 'res', status: 'resolved' }), absence({ id: 'pb', status: 'pending-board' })],
    });
    const code = (id: string) => {
      try {
        requestSubs(snap, { absenceId: id, personIds: ['r1'] }, ctxAt(BEFORE));
      } catch (e) {
        return (e as EngineError).code;
      }
      return null;
    };
    expect([code('nope'), code('res'), code('pb'), code('ok')]).toEqual(['BAD_INPUT', 'ALREADY_RESOLVED', 'BAD_STATE', null]);
  });
});

describe('placeSub', () => {
  test('idle: 대기 인원이 결근 자리로 이동, resolved', () => {
    const snap = snapOf({ persons: [worker('w1'), idle('i1')], absences: [absence()] });
    const c = placeSub(snap, { absenceId: 'ab1', personId: 'i1' }, ctxAt(BEFORE));
    expect(upserts<Assignment>(c, 'assignments')).toEqual([
      expect.objectContaining({
        id: 'id-1',
        personId: 'i1',
        postId: 'L1',
        factoryId: 'f1',
        source: 'sub',
        locked: true,
        reason: 'absence:ab1',
      }),
    ]);
    expect(upserts<Absence>(c, 'absences')[0]).toMatchObject({
      status: 'resolved',
      resolvedPersonId: 'i1',
      resolvedAt: new Date(BEFORE),
    });
    expect(c.messages).toEqual([
      expect.objectContaining({ personId: 'i1', bodyKey: 'subAssigned', channel: 'push' }),
    ]);
  });

  test('rest 인원도 canWorkExtra 통과하면 배치되고, 다른 sent 요청은 cancelled + takenByOther', () => {
    const snap = snapOf({
      persons: [worker('w1'), rest('r1'), rest('r2')],
      absences: [absence({ status: 'in-progress' })],
      subRequests: [req({ id: 'rq2', personId: 'r2' })],
    });
    const c = placeSub(snap, { absenceId: 'ab1', personId: 'r1' }, ctxAt(BEFORE));
    expect(upserts<SubRequest>(c, 'subRequests')).toEqual([expect.objectContaining({ id: 'rq2', status: 'cancelled' })]);
    expect(bodyKeys(c).sort()).toEqual(['subAssigned', 'takenByOther']);
    expect(c.messages.find((m) => m.bodyKey === 'takenByOther')).toMatchObject({ personId: 'r2', params: { absenceId: 'ab1' } });
  });

  test('canWorkExtra 실패는 그 사유로 던진다', () => {
    const snap = snapOf({ persons: [worker('w1'), makePerson({ id: 'b1', empNo: 'b1', crew: 'B' })], absences: [absence()] });
    expect(() => placeSub(snap, { absenceId: 'ab1', personId: 'b1' }, ctxAt(BEFORE))).toThrow(
      expect.objectContaining({ code: 'ALREADY_WORKING' }),
    );
  });

  test('resolved → ALREADY_RESOLVED, pending-board → BAD_STATE, 없음 → BAD_INPUT', () => {
    const snap = snapOf({
      persons: [idle('i1')],
      absences: [absence({ id: 'res', status: 'resolved' }), absence({ id: 'pb', status: 'pending-board' })],
    });
    const code = (id: string) => {
      try {
        placeSub(snap, { absenceId: id, personId: 'i1' }, ctxAt(BEFORE));
      } catch (e) {
        return (e as EngineError).code;
      }
      return null;
    };
    expect([code('res'), code('pb'), code('x')]).toEqual(['ALREADY_RESOLVED', 'BAD_STATE', 'BAD_INPUT']);
  });
});

describe('respondSub', () => {
  const sentSnap = (over: Partial<Snapshot> = {}) =>
    snapOf({
      persons: [worker('w1'), rest('r1'), rest('r2'), rest('r3')],
      absences: [absence({ status: 'in-progress' })],
      subRequests: [req(), req({ id: 'rq2', personId: 'r2', rank: 2 }), req({ id: 'rq3', personId: 'r3', rank: 3 })],
      ...over,
    });

  test('먼저 수락한 1명: sub 배치 locked, resolved, 나머지 cancelled + takenByOther 메시지', () => {
    const { changes: c, outcome } = respondSub(sentSnap(), { requestId: 'rq1', personId: 'r1', accept: true }, ctxAt('2026-04-21T00:05:00Z'));
    expect(outcome).toBe('accepted');
    expect(upserts<Assignment>(c, 'assignments')).toEqual([
      expect.objectContaining({ personId: 'r1', postId: 'L1', source: 'sub', locked: true, reason: 'absence:ab1' }),
    ]);
    expect(upserts<Absence>(c, 'absences')[0]).toMatchObject({ status: 'resolved', resolvedPersonId: 'r1' });
    const rows = upserts<SubRequest>(c, 'subRequests');
    expect(rows.map((r) => [r.id, r.status])).toEqual([
      ['rq2', 'cancelled'],
      ['rq3', 'cancelled'],
      ['rq1', 'accepted'],
    ]);
    expect(rows.find((r) => r.id === 'rq1')!.respondedAt).toEqual(new Date('2026-04-21T00:05:00Z'));
    expect(bodyKeys(c).sort()).toEqual(['subAccepted', 'takenByOther', 'takenByOther']);
    expect(c.messages.find((m) => m.bodyKey === 'subAccepted')).toMatchObject({ personId: null, channel: 'admin', params: { absenceId: 'ab1', personId: 'r1' } });
  });

  test('resolved 뒤 늦은 수락 → takenByOther, 배치 변화 없음', () => {
    const snap = sentSnap({ absences: [absence({ status: 'resolved', resolvedPersonId: 'r2' })] });
    const { changes: c, outcome } = respondSub(snap, { requestId: 'rq1', personId: 'r1', accept: true }, ctxAt('2026-04-21T00:05:00Z'));
    expect(outcome).toBe('takenByOther');
    expect(c.upsert.assignments).toBeUndefined();
    expect(upserts<SubRequest>(c, 'subRequests')).toEqual([expect.objectContaining({ id: 'rq1', status: 'cancelled' })]);
  });

  test('absence가 cancelled여도 takenByOther', () => {
    const snap = sentSnap({ absences: [absence({ status: 'cancelled' })] });
    expect(respondSub(snap, { requestId: 'rq1', personId: 'r1', accept: true }, ctxAt('2026-04-21T00:05:00Z')).outcome).toBe('takenByOther');
  });

  test('이미 처리된 요청은 빈 Changes + 상태별 outcome', () => {
    const snap = sentSnap({
      subRequests: [
        req({ id: 'c', status: 'cancelled' }),
        req({ id: 'e', status: 'expired' }),
        req({ id: 'a', status: 'accepted' }),
        req({ id: 'd', status: 'declined' }),
      ],
    });
    const out = (id: string) => respondSub(snap, { requestId: id, personId: 'r1', accept: true }, ctxAt(BEFORE));
    expect(['c', 'e', 'a', 'd'].map((id) => out(id).outcome)).toEqual(['takenByOther', 'expired', 'accepted', 'declined']);
    expect(out('c').changes).toEqual({ upsert: {}, remove: {}, messages: [] });
  });

  test('본인 요청이 아니면 FORBIDDEN, 없는 요청 BAD_INPUT', () => {
    expect(() => respondSub(sentSnap(), { requestId: 'rq1', personId: 'r2', accept: true }, ctxAt(BEFORE))).toThrow(
      expect.objectContaining({ code: 'FORBIDDEN' }),
    );
    expect(() => respondSub(sentSnap(), { requestId: 'zz', personId: 'r2', accept: true }, ctxAt(BEFORE))).toThrow(
      expect.objectContaining({ code: 'BAD_INPUT' }),
    );
  });

  test('만료 시각이 지난 응답 → expired, 다른 sent가 남으면 absence 유지', () => {
    const { changes: c, outcome } = respondSub(sentSnap(), { requestId: 'rq1', personId: 'r1', accept: true }, ctxAt('2026-04-21T00:20:00Z'));
    expect(outcome).toBe('expired');
    expect(upserts<SubRequest>(c, 'subRequests')).toEqual([expect.objectContaining({ id: 'rq1', status: 'expired', respondedAt: null })]);
    expect(c.upsert.absences).toBeUndefined();
  });

  test('마지막 sent가 만료 응답이면 absence failed, round 2', () => {
    const snap = sentSnap({ subRequests: [req()] });
    const { changes: c } = respondSub(snap, { requestId: 'rq1', personId: 'r1', accept: false }, ctxAt('2026-04-21T00:30:00Z'));
    expect(upserts<Absence>(c, 'absences')[0]).toMatchObject({ status: 'failed', round: 2 });
    expect(bodyKeys(c)).toEqual(['subFailed']);
  });

  test('거절: declined + respondedAt, 다른 sent가 남으면 absence 그대로', () => {
    const { changes: c, outcome } = respondSub(sentSnap(), { requestId: 'rq1', personId: 'r1', accept: false }, ctxAt('2026-04-21T00:05:00Z'));
    expect(outcome).toBe('declined');
    expect(upserts<SubRequest>(c, 'subRequests')).toEqual([
      expect.objectContaining({ id: 'rq1', status: 'declined', respondedAt: new Date('2026-04-21T00:05:00Z') }),
    ]);
    expect(c.upsert.absences).toBeUndefined();
  });

  test('모두 거절 후 expireRequests → failed, round 2', () => {
    // r2, r3 already declined; r1 declines last -> failed immediately
    const snap = sentSnap({
      subRequests: [req(), req({ id: 'rq2', personId: 'r2', status: 'declined' }), req({ id: 'rq3', personId: 'r3', status: 'declined' })],
    });
    const { changes: c } = respondSub(snap, { requestId: 'rq1', personId: 'r1', accept: false }, ctxAt('2026-04-21T00:05:00Z'));
    expect(upserts<Absence>(c, 'absences')[0]).toMatchObject({ status: 'failed', round: 2 });
    expect(c.messages).toEqual([
      { companyId: COMPANY, personId: null, bodyKey: 'subFailed', params: { absenceId: 'ab1' }, channel: 'admin' },
    ]);
  });

  test('수락 시점에 canWorkExtra 재검사 실패 → 그 사유로 던진다', () => {
    const snap = sentSnap({ assignments: [asg({ id: 'x', personId: 'r1', postId: 'L9' })] });
    expect(() => respondSub(snap, { requestId: 'rq1', personId: 'r1', accept: true }, ctxAt('2026-04-21T00:05:00Z'))).toThrow(
      expect.objectContaining({ code: 'ALREADY_WORKING' }),
    );
  });
});

describe('expireRequests', () => {
  test('20분 지나면 expired; 모두 만료되면 failed, round 2', () => {
    const snap = snapOf({
      absences: [absence({ status: 'in-progress' })],
      subRequests: [req(), req({ id: 'rq2', personId: 'r2' })],
    });
    const c = expireRequests(snap, ctxAt('2026-04-21T00:20:00Z'));
    expect(upserts<SubRequest>(c, 'subRequests').map((r) => [r.id, r.status])).toEqual([
      ['rq1', 'expired'],
      ['rq2', 'expired'],
    ]);
    expect(upserts<Absence>(c, 'absences')).toEqual([expect.objectContaining({ status: 'failed', round: 2 })]);
    expect(bodyKeys(c)).toEqual(['subFailed']);
  });

  test('하나라도 sent 남으면 in-progress 유지', () => {
    const snap = snapOf({
      absences: [absence({ status: 'in-progress' })],
      subRequests: [req(), req({ id: 'rq2', personId: 'r2', expiresAt: new Date('2026-04-21T01:00:00Z') })],
    });
    const c = expireRequests(snap, ctxAt('2026-04-21T00:21:00Z'));
    expect(upserts<SubRequest>(c, 'subRequests').map((r) => r.id)).toEqual(['rq1']);
    expect(c.upsert.absences).toBeUndefined();
    expect(c.messages).toEqual([]);
  });

  test('만료 전이면 빈 Changes, absence가 in-progress가 아니면 상태 불변', () => {
    const snap = snapOf({ absences: [absence({ status: 'in-progress' })], subRequests: [req()] });
    expect(expireRequests(snap, ctxAt(BEFORE))).toEqual({ upsert: {}, remove: {}, messages: [] });
    const resolved = snapOf({ absences: [absence({ status: 'resolved' })], subRequests: [req()] });
    expect(expireRequests(resolved, ctxAt('2026-04-21T00:30:00Z')).upsert.absences).toBeUndefined();
  });
});

describe('cancelAbsence', () => {
  const base = (over: Partial<Snapshot> = {}) =>
    snapOf({ persons: [worker('w1'), rest('r1')], boards: [board], absences: [absence({ status: 'in-progress' })], subRequests: [req()], ...over });

  test('해결 전이면 원래 배치 복원 + sent 요청 cancelled', () => {
    const c = cancelAbsence(base(), { absenceId: 'ab1', by: 'admin' }, ctxAt(AFTER));
    expect(upserts<Assignment>(c, 'assignments')).toEqual([asg()]);
    expect(upserts<SubRequest>(c, 'subRequests')).toEqual([expect.objectContaining({ id: 'rq1', status: 'cancelled', respondedAt: null })]);
    expect(upserts<Absence>(c, 'absences')[0].status).toBe('cancelled');
    expect(c.messages).toEqual([
      { companyId: COMPANY, personId: 'r1', bodyKey: 'requestCancelled', params: { absenceId: 'ab1' }, channel: 'push' },
    ]);
  });

  test('그 자리에 이미 다른 사람이 있으면 복원 생략', () => {
    const snap = base({ assignments: [asg({ id: 'other', personId: 'i1' })] });
    const c = cancelAbsence(snap, { absenceId: 'ab1', by: 'self' }, ctxAt(BEFORE));
    expect(c.upsert.assignments).toBeUndefined();
    expect(upserts<Absence>(c, 'absences')[0].status).toBe('cancelled');
  });

  test('restore가 없으면 복원 없음', () => {
    const snap = base({ absences: [absence({ restore: null, postId: null, status: 'pending-board' })] });
    const c = cancelAbsence(snap, { absenceId: 'ab1', by: 'self' }, ctxAt(BEFORE));
    expect(c.upsert.assignments).toBeUndefined();
  });

  test('resolved면 EngineError ALREADY_RESOLVED', () => {
    const snap = base({ absences: [absence({ status: 'resolved' })] });
    expect(() => cancelAbsence(snap, { absenceId: 'ab1', by: 'admin' }, ctxAt(BEFORE))).toThrow(EngineError);
    expect(() => cancelAbsence(snap, { absenceId: 'ab1', by: 'admin' }, ctxAt(BEFORE))).toThrow(
      expect.objectContaining({ code: 'ALREADY_RESOLVED' }),
    );
  });

  test('이미 cancelled면 빈 Changes, 없으면 BAD_INPUT', () => {
    const snap = base({ absences: [absence({ status: 'cancelled' })] });
    expect(cancelAbsence(snap, { absenceId: 'ab1', by: 'self' }, ctxAt(BEFORE))).toEqual({ upsert: {}, remove: {}, messages: [] });
    expect(() => cancelAbsence(snap, { absenceId: 'nope', by: 'self' }, ctxAt(BEFORE))).toThrow(
      expect.objectContaining({ code: 'BAD_INPUT' }),
    );
  });

  test('by self: 교대 시작 후 SHIFT_STARTED, admin은 가능', () => {
    expect(() => cancelAbsence(base(), { absenceId: 'ab1', by: 'self' }, ctxAt(AFTER))).toThrow(
      expect.objectContaining({ code: 'SHIFT_STARTED' }),
    );
    expect(upserts<Absence>(cancelAbsence(base(), { absenceId: 'ab1', by: 'admin' }, ctxAt(AFTER)), 'absences')).toHaveLength(1);
  });
});
