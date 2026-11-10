import * as XLSX from 'xlsx';
import { EngineError, type DateStr } from '@/engine/types';

export const MAX_BYTES = 5 * 1024 * 1024;
export const MAX_DATA_ROWS = 5000;

export const ROSTER_REQUIRED = ['사번', '이름', '조', '공장'] as const;
export const PLAN_HEADERS = ['날짜', '교대', '공장', '라인', '제품', '상태'] as const;

export type Cell = unknown;
export type SheetRows = Cell[][];

export type ImportPreview = {
  kind: 'roster' | 'plan' | 'unknown';
  rows: { row: number; action: 'add' | 'update' | 'error'; key: string; errors: string[] }[];
  counts: { add: number; update: number; error: number };
  sample?: string[][];
};

export function detectKind(headers: string[]): 'roster' | 'plan' | 'unknown' {
  const h = new Set(headers.map((x) => x.trim()));
  if (PLAN_HEADERS.every((x) => h.has(x))) return 'plan';
  if (ROSTER_REQUIRED.every((x) => h.has(x))) return 'roster';
  return 'unknown';
}

/** First sheet as rows of cells (row 0 = header row). Over-size input or too many data rows → BAD_INPUT. */
export function readSheetRows(buf: Buffer): SheetRows {
  if (buf.length > MAX_BYTES) throw new EngineError('BAD_INPUT', 'file too large');
  let rows: SheetRows;
  try {
    const wb = XLSX.read(buf, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) throw new Error('no sheet');
    rows = XLSX.utils.sheet_to_json<Cell[]>(ws, { header: 1, raw: true, defval: null });
  } catch {
    throw new EngineError('BAD_INPUT', 'unreadable workbook');
  }
  if (rows.length - 1 > MAX_DATA_ROWS) throw new EngineError('BAD_INPUT', 'too many rows');
  return rows;
}

export const headersOf = (rows: SheetRows): string[] => (rows[0] ?? []).map((c) => text(c));

/** Trimmed text of a cell; blank / null → ''. Numbers print without a trailing .0. */
export function text(c: Cell): string {
  if (c === null || c === undefined) return '';
  if (c instanceof Date) return Number.isNaN(c.getTime()) ? '' : localDate(c);
  return String(c).trim();
}

/** Workbooks are read without cellDates (date cells arrive as serials; SheetJS Dates are local midnight, not UTC). */
const localDate = (d: Date): DateStr =>
  `${String(d.getFullYear()).padStart(4, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const real = (s: string): DateStr | null => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s) ? s : null;
};

/** Date cell / Excel serial / 'YYYY-MM-DD' | 'YYYY.MM.DD' | 'YYYY/MM/DD' → DateStr, else null. */
export function parseDate(c: Cell): DateStr | null {
  if (c instanceof Date) return Number.isNaN(c.getTime()) ? null : localDate(c);
  if (typeof c === 'number') {
    if (!Number.isFinite(c) || c < 1 || c > 2958465) return null;
    return new Date(Math.floor(c - 25569) * 86_400_000).toISOString().slice(0, 10);
  }
  const m = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/.exec(text(c));
  if (!m) return null;
  return real(`${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`);
}

export function headerIndex(rows: SheetRows): Map<string, number> {
  const idx = new Map<string, number>();
  headersOf(rows).forEach((h, i) => {
    if (h && !idx.has(h)) idx.set(h, i);
  });
  return idx;
}

export function summarize(kind: ImportPreview['kind'], rows: ImportPreview['rows']): ImportPreview {
  const counts = { add: 0, update: 0, error: 0 };
  for (const r of rows) counts[r.action]++;
  return { kind, rows, counts };
}

/** A data row is skipped when every cell is blank. */
export const isBlankRow = (r: Cell[]): boolean => r.every((c) => text(c) === '');

export function toXlsx(sheetName: string, aoa: (string | number)[][]): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), sheetName);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
