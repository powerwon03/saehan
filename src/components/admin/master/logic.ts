// Pure helpers for the 기준 정보 screen: one field list per table drives the columns, the form and the payload.

export type FieldSpec = {
  key: string;
  label: string;
  type: 'text' | 'int' | 'date' | 'bool' | 'select';
  options?: { value: string; label: string }[];
  /** Blank → null (clears the column). */
  nullable?: boolean;
  /** Blank → left out of the payload (the server default or the current value stays). */
  optional?: boolean;
  /** Label of the blank choice of a nullable select. */
  emptyLabel?: string;
  /** Value of the control for a new row. */
  initial?: string | boolean;
  /** Hidden from the table (still in the form). */
  formOnly?: boolean;
};

export type Row = Record<string, unknown>;
export type FormState = Record<string, string | boolean>;

/** Form values for a row (null = new row: each field's `initial`, else blank / false). */
export function formFromRow(fields: FieldSpec[], row: Row | null): FormState {
  const out: FormState = {};
  for (const f of fields) {
    if (!row) out[f.key] = f.initial ?? (f.type === 'bool' ? false : '');
    else if (f.type === 'bool') out[f.key] = row[f.key] === true;
    else out[f.key] = row[f.key] === null || row[f.key] === undefined ? '' : String(row[f.key]);
  }
  return out;
}

/**
 * Request body from form values. Text is trimmed; numbers are parsed (a non-number is sent as typed so the
 * server's validation answers BAD_INPUT instead of a silent NaN/null).
 */
export function payloadFromForm(fields: FieldSpec[], form: FormState): Row {
  const out: Row = {};
  for (const f of fields) {
    const v = form[f.key];
    if (f.type === 'bool') {
      out[f.key] = v === true;
      continue;
    }
    const s = String(v ?? '').trim();
    if (s === '') {
      if (f.nullable) out[f.key] = null;
      else if (!f.optional) out[f.key] = s;
      continue;
    }
    out[f.key] = f.type === 'int' && Number.isFinite(Number(s)) ? Number(s) : s;
  }
  return out;
}

/** Table cell text: option label for selects, 예/'' for booleans, — for empty. */
export function cellText(f: FieldSpec, row: Row): string {
  const v = row[f.key];
  if (f.type === 'bool') return v === true ? '예' : '';
  if (v === null || v === undefined || v === '') return f.type === 'select' && f.emptyLabel ? f.emptyLabel : '—';
  if (f.type === 'select') return f.options?.find((o) => o.value === v)?.label ?? String(v);
  return String(v);
}
