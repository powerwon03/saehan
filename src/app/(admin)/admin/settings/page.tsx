'use client';

import { PageStatus } from '@/components/admin/common/PageStatus';
import { useAdminData } from '@/components/admin/common/useAdminData';
import type { SettingsValues } from '@/components/admin/settings/logic';
import { SettingsForm } from '@/components/admin/settings/SettingsForm';

/** 설정: loaded once (no rev polling, so another change never overwrites what is being typed). */
export default function SettingsPage() {
  const { data, failed, reload } = useAdminData<{ settings: SettingsValues }>('/api/admin/settings', false);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-extrabold">설정</h1>
      {data ? <SettingsForm initial={data.settings} onSaved={reload} /> : <PageStatus failed={failed} onRetry={() => void reload()} />}
    </div>
  );
}
