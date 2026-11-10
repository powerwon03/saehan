'use client';

import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { send } from '@/lib/api';
import { Field } from '../common/Field';
import { btnPrimary, card, input } from '../common/styles';
import { errorText } from '../labels';
import { useToast } from '../Toast';
import { WEIGHT_KEYS, formFromSettings, settingsPayload, type SettingsForm as Form, type SettingsValues } from './logic';

const WEIGHT_LABEL: Record<(typeof WEIGHT_KEYS)[number], string> = {
  samePost: '같은 자리 경험',
  sameProduct: '같은 제품 경험',
  sameFactory: '같은 공장',
  roleMatch: '역할 같음',
  roleMismatch: '역할 다름 (감점)',
  recentSub: '최근 대체 근무 (감점)',
};
const SKILL_NAME = ['0 없음', '1 보조 필요', '2 단독 가능', '3 숙련·지도 가능'];

function Group({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <section className={`${card} p-5`}>
      <h2 className="text-lg font-bold">{title}</h2>
      <p className="mb-4 text-sm text-amber-700">회사 확인 전 가정값 · {hint}</p>
      <div className="grid grid-cols-3 gap-4">{children}</div>
    </section>
  );
}

/** Every setting in five groups, saved as one full object (PUT); BAD_INPUT shows next to the 저장 button. */
export function SettingsForm({ initial, onSaved }: { initial: SettingsValues; onSaved: () => Promise<void> }) {
  const router = useRouter();
  const toast = useToast();
  const [form, setForm] = useState<Form>(() => formFromSettings(initial));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof Omit<Form, 'weights' | 'skillRates'>, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setBusy(true);
    setError(null);
    const r = await send('PUT', '/api/admin/settings', settingsPayload(form));
    setBusy(false);
    if (!r.ok && r.status === 401) return router.replace('/login');
    if (!r.ok) return setError(r.code);
    toast('설정을 저장했어요');
    await onSaved();
  };

  const num = (k: keyof Omit<Form, 'weights' | 'skillRates' | 'shiftDayStart' | 'shiftNightStart'>, label: string) => (
    <Field label={label}>
      <input className={input} inputMode="decimal" value={form[k]} onChange={(e) => set(k, e.target.value)} />
    </Field>
  );

  return (
    <form
      className="flex max-w-[900px] flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <Group title="교대 시간" hint="주간이 야간보다 먼저 시작해야 해요">
        <Field label="주간 시작">
          <input className={input} type="time" value={form.shiftDayStart} onChange={(e) => set('shiftDayStart', e.target.value)} />
        </Field>
        <Field label="야간 시작">
          <input className={input} type="time" value={form.shiftNightStart} onChange={(e) => set('shiftNightStart', e.target.value)} />
        </Field>
      </Group>

      <Group title="근로시간" hint="인정 1~12시간, 주 최대 40~68시간, 주의 ≤ 주 최대">
        {num('shiftCreditHours', '1회 인정 시간')}
        {num('maxWeekHours', '주 최대 시간')}
        {num('warnWeekHours', '주의 표시 시간')}
      </Group>

      <Group title="대체 요청" hint="5~120분">
        {num('requestExpiryMin', '요청 기한 (분)')}
      </Group>

      <Group title="배치 가중치" hint="0 이상">
        {WEIGHT_KEYS.map((k) => (
          <Field key={k} label={WEIGHT_LABEL[k]}>
            <input
              className={input}
              inputMode="decimal"
              value={form.weights[k]}
              onChange={(e) => setForm((f) => ({ ...f, weights: { ...f.weights, [k]: e.target.value } }))}
            />
          </Field>
        ))}
      </Group>

      <Group title="숙련도 가동률 (%)" hint="0~100, 단계가 높을수록 같거나 커야 해요">
        {form.skillRates.map((v, i) => (
          <Field key={i} label={SKILL_NAME[i]}>
            <input
              className={input}
              inputMode="decimal"
              value={v}
              onChange={(e) => setForm((f) => ({ ...f, skillRates: f.skillRates.map((x, j) => (j === i ? e.target.value : x)) as Form['skillRates'] }))}
            />
          </Field>
        ))}
      </Group>

      <div className="flex items-center justify-end gap-4">
        {error && (
          <p role="alert" className="font-semibold text-red-600">
            {errorText(error)}{error === 'BAD_INPUT' && ' — 각 칸의 범위를 확인해 주세요'}
          </p>
        )}
        <button type="submit" disabled={busy} className={btnPrimary}>
          저장
        </button>
      </div>
    </form>
  );
}
