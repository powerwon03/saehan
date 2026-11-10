'use client';

import { useCallback, useState } from 'react';
import { PageStatus } from '@/components/admin/common/PageStatus';
import { Tabs } from '@/components/admin/common/Tabs';
import { useAdminData } from '@/components/admin/common/useAdminData';
import { useWrite } from '@/components/admin/common/useWrite';
import { fieldsFor, type FactoryRow, type Kind, type PostRow, type ProductRow } from '@/components/admin/master/fields';
import type { Row } from '@/components/admin/master/logic';
import { MasterTable } from '@/components/admin/master/MasterTable';

const TABS: { key: Kind; label: string }[] = [
  { key: 'factories', label: '공장' },
  { key: 'posts', label: '자리' },
  { key: 'products', label: '제품' },
  { key: 'standards', label: '표준 인원' },
];

/** 기준 정보: 공장 / 자리 / 제품 / 표준 인원 tables (all four are loaded: each feeds the others' choices). */
export default function MasterPage() {
  const [kind, setKind] = useState<Kind>('factories');
  const factories = useAdminData<{ rows: FactoryRow[] }>('/api/admin/master/factories');
  const posts = useAdminData<{ rows: PostRow[] }>('/api/admin/master/posts');
  const products = useAdminData<{ rows: ProductRow[] }>('/api/admin/master/products');
  const standards = useAdminData<{ rows: Row[] }>('/api/admin/master/standards');
  const all = [factories, posts, products, standards];

  const [r1, r2, r3, r4] = all.map((d) => d.reload);
  const reload = useCallback(async () => {
    await Promise.all([r1(), r2(), r3(), r4()]);
  }, [r1, r2, r3, r4]);
  const { run, busy } = useWrite(reload);

  // the API orders posts by sort/code across factories and standards by post id: show both grouped by factory
  const factoryList = factories.data?.rows ?? [];
  const factoryRank = (id: string) => factoryList.findIndex((f) => f.id === id);
  const postList = (posts.data?.rows ?? []).toSorted((a, b) => factoryRank(a.factoryId) - factoryRank(b.factoryId));
  const postRank = (id: unknown) => postList.findIndex((p) => p.id === id);
  const refs = { factories: factoryList, posts: postList, products: products.data?.rows ?? [] };
  const rows: Record<Kind, Row[]> = {
    factories: factoryList,
    posts: postList,
    products: refs.products,
    standards: (standards.data?.rows ?? []).toSorted((a, b) => postRank(a.postId) - postRank(b.postId)),
  };
  const ready = all.every((d) => d.data !== null);
  const label = TABS.find((t) => t.key === kind)!.label;

  const postName = (id: unknown) => {
    const p = refs.posts.find((x) => x.id === id);
    return p ? `${p.code} ${p.name}` : '';
  };
  const rowName = (row: Row) => (kind === 'standards' ? `${postName(row.postId)} 표준 인원` : `${String(row.code)} ${String(row.name)}`);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <h1 className="text-xl font-extrabold">기준 정보</h1>
        <Tabs label="표" items={TABS} value={kind} onChange={setKind} />
      </div>
      {ready ? (
        <MasterTable key={kind} kind={kind} title={label} fields={fieldsFor(kind, refs)} rows={rows[kind]} run={run} busy={busy} rowName={rowName} />
      ) : (
        <PageStatus failed={all.find((d) => d.failed)?.failed ?? null} onRetry={() => void reload()} />
      )}
    </div>
  );
}
