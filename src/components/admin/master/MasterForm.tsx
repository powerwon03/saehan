'use client';

import { useState } from 'react';
import type { ApiResult } from '@/lib/api';
import { Drawer } from '../common/Drawer';
import { Field } from '../common/Field';
import { btnPrimary, input } from '../common/styles';
import { errorText } from '../labels';
import { formFromRow, payloadFromForm, type FieldSpec, type FormState, type Row } from './logic';

/** Add (row null) or edit one master row; the server's error (BAD_INPUT, DUPLICATE_CODE…) shows inline. */
export function MasterForm({
  title,
  fields,
  row,
  save,
  onClose,
}: {
  title: string;
  fields: FieldSpec[];
  row: Row | null;
  save: (payload: Row) => Promise<ApiResult<unknown>>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<FormState>(() => formFromRow(fields, row));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    setBusy(true);
    setError(null);
    const r = await save(payloadFromForm(fields, form));
    setBusy(false);
    if (r.ok) onClose();
    else setError(r.code);
  };

  return (
    <Drawer title={title} onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {fields.map((f) => {
          const v = form[f.key];
          if (f.type === 'bool')
            return (
              <label key={f.key} className="flex items-center gap-2 font-semibold">
                <input type="checkbox" className="h-5 w-5" checked={v === true} onChange={(e) => set(f.key, e.target.checked)} />
                {f.label}
              </label>
            );
          return (
            <Field key={f.key} label={f.label}>
              {f.type === 'select' ? (
                <select className={input} value={String(v)} onChange={(e) => set(f.key, e.target.value)}>
                  {f.nullable && <option value="">{f.emptyLabel ?? '없음'}</option>}
                  {f.options?.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className={input}
                  type={f.type === 'date' ? 'date' : 'text'}
                  inputMode={f.type === 'int' ? 'numeric' : undefined}
                  value={String(v)}
                  onChange={(e) => set(f.key, e.target.value)}
                  maxLength={100}
                />
              )}
            </Field>
          );
        })}
        {error && (
          <p role="alert" className="text-sm font-semibold text-red-600">
            {errorText(error)}
          </p>
        )}
        <div className="flex justify-end">
          <button type="submit" disabled={busy} className={btnPrimary}>
            {row ? '저장' : '추가'}
          </button>
        </div>
      </form>
    </Drawer>
  );
}
