import type { Candidate } from '@/engine/recommend';
import type { AbsenceKind } from '@/engine/types';
import { errorKey, t } from '@/i18n';
import type { BoardView } from '@/server/views/boardView';

// Admin screens are Korean-only (Ruling R33): labels are literals here; server error codes go through the dictionary.

type Absence = BoardView['absences'][number];

/** Toast text for a server error code. */
export const errorText = (code: string): string => t('ko', errorKey(code));

export const BOARD_STATUS: Record<BoardView['status'], string> = { none: '없음', draft: '작성 중', confirmed: '확정됨' };

export const SHIFT: Record<BoardView['shift'], string> = { day: '주간', night: '야간' };

/** Assignment flags (engine flagsFor). Unknown flags show their code. */
export const FLAG: Record<string, string> = {
  'no-exp': '경험 없음',
  'low-skill': '숙련도 낮음',
  role: '역할 다름',
  gender: '성별',
  hours: '시간 초과',
};

export const ABSENCE_KIND: Record<AbsenceKind, string> = { absent: '결근', sick: '병가', early: '조퇴', late: '지각', leave: '휴무' };

/** Kinds the admin can register from a name chip, in button order. */
export const REPORT_KINDS = ['absent', 'sick', 'early', 'late'] as const satisfies readonly AbsenceKind[];

export const ABSENCE_STATUS: Record<Absence['status'], string> = {
  'pending-board': '배치 전',
  'not-needed': '대체 불필요',
  decided: '대체 필요',
  'in-progress': '요청 중',
  resolved: '해결',
  failed: '다시 고르기',
  cancelled: '취소됨',
};

export const REQUEST_STATUS: Record<Absence['requests'][number]['status'], string> = {
  sent: '답 기다리는 중',
  accepted: '수락',
  declined: '거절',
  expired: '시간 지남',
  cancelled: '취소됨',
};

export const WARNING: Record<Candidate['warnings'][number], string> = {
  lowSkill: '숙련도 낮음',
  role: '역할 다름',
  gender: '성별 확인',
  hours: '시간 초과',
};

export const CANDIDATE_KIND: Record<Candidate['kind'], string> = { idle: '대기', rest: '휴무' };
