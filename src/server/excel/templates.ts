import type { DateStr } from '@/engine/types';
import { suggestEmpNo } from '@/server/admin/persons';
import { toXlsx } from './detect';
import { PLAN_COLUMNS } from './plan';
import type { Refs } from './refs';
import { ROSTER_HEADERS } from './roster';

/** Header row + one example row built from the company's real factory / post / product codes. */
export function buildTemplate(kind: 'roster' | 'plan', refs: Refs, today: DateStr): Buffer {
  const factory = [...refs.factories].sort((a, b) => a.sort - b.sort || a.code.localeCompare(b.code))[0];
  const posts = refs.posts.filter((p) => p.active).sort((a, b) => a.sort - b.sort || a.code.localeCompare(b.code));
  const post = factory ? (posts.find((p) => p.factoryId === factory.id) ?? posts[0]) : posts[0];
  const product = refs.products.find((p) => p.active) ?? refs.products[0];

  if (kind === 'plan') {
    return toXlsx('생산계획', [[...PLAN_COLUMNS], [today, '주간', factory?.name ?? '', post?.code ?? '', product?.code ?? '', '가동']]);
  }
  const codes = [...new Set(posts.map((p) => p.code))];
  const example: Record<string, string | number> = {
    사번: suggestEmpNo(refs.persons.map((p) => p.empNo)),
    이름: '홍길동',
    소속: '직영',
    조: 'A',
    역할: '',
    성별: '남',
    전화: '',
    공장: factory?.name ?? '',
    언어: '한국어',
    입사일: today,
    퇴사일: '',
    지정자리: '',
  };
  if (codes[0]) example[codes[0]] = 3;
  const headers = [...ROSTER_HEADERS, ...codes];
  return toXlsx('명단', [headers, headers.map((h) => example[h] ?? '')]);
}
