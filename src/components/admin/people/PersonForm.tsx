'use client';

import { useEffect, useState } from 'react';
import { api, send } from '@/lib/api';
import { strongEnough, suggestEmpNo } from '@/lib/personRules';
import type { factories, posts } from '@/server/db/schema';
import { Drawer } from '../common/Drawer';
import { Field } from '../common/Field';
import { btnPrimary, input } from '../common/styles';
import { AFFILIATION, CREWS, GENDER, LANG_NAME, errorText } from '../labels';
import { useToast } from '../Toast';
import { createPayload, emptyForm, formFromPerson, patchPayload, type PersonForm as Form, type PersonRow } from './logic';

type FactoryRow = typeof factories.$inferSelect;
type PostRow = typeof posts.$inferSelect;

/**
 * 「신규 입사」 (person = null: 사번 prefilled with the suggestion, 초기 PIN) or 수정 (same form without PIN).
 * Errors show inline; on success the drawer closes and the list refetches.
 */
export function PersonForm({
  person,
  factoryList,
  postList,
  onDone,
  onClose,
}: {
  person: PersonRow | null;
  factoryList: FactoryRow[];
  postList: PostRow[];
  onDone: () => Promise<void>;
  onClose: () => void;
}) {
  const toast = useToast();
  const creating = person === null;
  const [form, setForm] = useState<Form>(() => (person ? formFromPerson(person) : emptyForm(factoryList[0]?.id ?? '', '')));
  const [error, setError] = useState<{ code: string; pin?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  // 사번 suggestion = same rule as the server, over everyone (retired too: their numbers stay taken)
  useEffect(() => {
    if (!creating) return;
    let stale = false;
    void api<{ persons: PersonRow[] }>('/api/admin/persons?active=all').then((r) => {
      if (!stale && r.ok) setForm((f) => (f.empNo === '' ? { ...f, empNo: suggestEmpNo(r.data.persons.map((p) => p.empNo)) } : f));
    });
    return () => {
      stale = true;
    };
  }, [creating]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const factoryPosts = postList.filter((p) => p.factoryId === form.factoryId && (p.active || p.id === form.fixedPostId));

  const save = async () => {
    if (creating && !strongEnough('worker', form.pin)) return setError({ code: 'WEAK_SECRET', pin: true });
    setBusy(true);
    setError(null);
    const r = creating
      ? await send<{ person: PersonRow }>('POST', '/api/admin/persons', createPayload(form))
      : await send<{ person: PersonRow }>('PATCH', `/api/admin/persons/${person.id}`, patchPayload(form));
    setBusy(false);
    if (!r.ok) return setError({ code: r.code, pin: r.code === 'WEAK_SECRET' });
    if (creating) toast(`${r.data.person.name} · 사번 ${r.data.person.empNo}로 등록했어요`);
    await onDone();
    onClose();
  };

  const canSave = form.name.trim() !== '' && form.factoryId !== '' && (creating || form.empNo.trim() !== '');

  return (
    <Drawer title={creating ? '신규 입사' : `${person.name} 수정`} onClose={onClose}>
      <form
        className="grid grid-cols-2 gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label={creating ? '사번 (비우면 자동)' : '사번'}>
          <input className={input} value={form.empNo} onChange={(e) => set('empNo', e.target.value)} maxLength={30} />
        </Field>
        <Field label="이름">
          <input className={input} value={form.name} onChange={(e) => set('name', e.target.value)} maxLength={100} required />
        </Field>
        <Field label="공장">
          <select className={input} value={form.factoryId} onChange={(e) => setForm((f) => ({ ...f, factoryId: e.target.value, fixedPostId: '' }))}>
            {factoryList.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="조">
          <select className={input} value={form.crew} onChange={(e) => set('crew', e.target.value as Form['crew'])}>
            {CREWS.map((c) => (
              <option key={c} value={c}>
                {c}조
              </option>
            ))}
          </select>
        </Field>
        <Field label="소속">
          <select className={input} value={form.affiliation} onChange={(e) => set('affiliation', e.target.value as Form['affiliation'])}>
            {Object.entries(AFFILIATION).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="역할">
          <input className={input} value={form.role} onChange={(e) => set('role', e.target.value)} maxLength={100} placeholder="예: 성형, 포장" />
        </Field>
        <Field label="성별">
          <select className={input} value={form.gender} onChange={(e) => set('gender', e.target.value as Form['gender'])}>
            <option value="">—</option>
            {Object.entries(GENDER).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="언어">
          <select className={input} value={form.lang} onChange={(e) => set('lang', e.target.value as Form['lang'])}>
            {Object.entries(LANG_NAME).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="전화">
          <input className={input} type="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} maxLength={100} />
        </Field>
        <Field label="입사일">
          <input className={input} type="date" value={form.hiredAt} onChange={(e) => set('hiredAt', e.target.value)} />
        </Field>
        <Field label="지정 자리" wide>
          <select className={input} value={form.fixedPostId} onChange={(e) => set('fixedPostId', e.target.value)}>
            <option value="">없음</option>
            {factoryPosts.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} {p.name}
              </option>
            ))}
          </select>
        </Field>
        {creating && (
          <Field label="초기 PIN (숫자 6자리)" error={error?.pin ? errorText(error.code) : null}>
            <input
              className={input}
              value={form.pin}
              onChange={(e) => set('pin', e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
            />
          </Field>
        )}
        {creating && <p className="col-span-2 text-sm text-gray-500">처음 로그인할 때 본인이 PIN을 바꾸게 돼요.</p>}
        {error && !error.pin && (
          <p role="alert" className="col-span-2 text-sm font-semibold text-red-600">
            {errorText(error.code)}
          </p>
        )}
        <div className="col-span-2 flex justify-end">
          <button type="submit" disabled={busy || !canSave} className={btnPrimary}>
            {creating ? '등록' : '저장'}
          </button>
        </div>
      </form>
    </Drawer>
  );
}
