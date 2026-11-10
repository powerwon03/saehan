import type { factories, posts, products } from '@/server/db/schema';
import { APPROVAL, GENDER, POST_KIND } from '../labels';
import type { FieldSpec } from './logic';

export type FactoryRow = typeof factories.$inferSelect;
export type PostRow = typeof posts.$inferSelect;
export type ProductRow = typeof products.$inferSelect;
export type Kind = 'factories' | 'posts' | 'products' | 'standards';

const options = (labels: Record<string, string>) => Object.entries(labels).map(([value, label]) => ({ value, label }));

/** Columns/form fields of each 기준 정보 table, in the order of ruling T16 (options come from the other tables). */
export function fieldsFor(kind: Kind, refs: { factories: FactoryRow[]; posts: PostRow[]; products: ProductRow[] }): FieldSpec[] {
  const factoryName = (id: string) => refs.factories.find((f) => f.id === id)?.name ?? '';
  switch (kind) {
    case 'factories':
      return [
        { key: 'name', label: '이름', type: 'text' },
        { key: 'code', label: '코드', type: 'text' },
        { key: 'approval', label: '결재 방식', type: 'select', options: options(APPROVAL), initial: 'confirm' },
        { key: 'leaderPhone', label: '반장 전화', type: 'text', nullable: true },
        { key: 'cycleBaseDate', label: '달력 기준일 (A조 주간 첫날)', type: 'date' },
      ];
    case 'posts':
      return [
        { key: 'factoryId', label: '공장', type: 'select', options: refs.factories.map((f) => ({ value: f.id, label: f.name })), initial: refs.factories[0]?.id ?? '' },
        { key: 'code', label: '코드', type: 'text' },
        { key: 'name', label: '이름', type: 'text' },
        { key: 'kind', label: '종류', type: 'select', options: options(POST_KIND), initial: 'line' },
        { key: 'role', label: '역할', type: 'text', nullable: true },
        { key: 'unmanned', label: '무인', type: 'bool' },
        { key: 'priority', label: '우선순위', type: 'int', initial: '0' },
        { key: 'defaultNeed', label: '기본 인원', type: 'int', initial: '1' },
        { key: 'sort', label: '순서', type: 'int', initial: '0' },
        { key: 'active', label: '사용', type: 'bool', initial: true },
      ];
    case 'products':
      return [
        { key: 'code', label: '코드', type: 'text' },
        { key: 'name', label: '이름', type: 'text' },
        { key: 'urgent', label: '긴급', type: 'bool' },
        { key: 'active', label: '사용', type: 'bool', initial: true },
      ];
    case 'standards':
      return [
        {
          key: 'postId',
          label: '자리',
          type: 'select',
          options: refs.posts.map((p) => ({ value: p.id, label: `${factoryName(p.factoryId)} · ${p.code} ${p.name}` })),
          initial: refs.posts[0]?.id ?? '',
        },
        {
          key: 'productId',
          label: '제품',
          type: 'select',
          nullable: true,
          emptyLabel: '없음 (라인 기본)',
          options: refs.products.map((p) => ({ value: p.id, label: `${p.code} ${p.name}` })),
        },
        { key: 'need', label: '인원', type: 'int', initial: '1' },
        { key: 'gender', label: '성별 조건', type: 'select', nullable: true, emptyLabel: '없음', options: options(GENDER) },
      ];
  }
}
