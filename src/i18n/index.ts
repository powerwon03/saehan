import type { DateStr, Person } from '@/engine/types';
import { en } from './en';
import { ko } from './ko';
import { mn } from './mn';
import { vi } from './vi';

export type Dict = typeof ko;
export type DictKey = keyof Dict;
export type Lang = Person['lang'];
export type Params = Record<string, string | number>;

export const LANGS: readonly Lang[] = ['ko', 'en', 'mn', 'vi'];
const DICTS: Record<Lang, Record<DictKey, string>> = { ko, en, mn, vi };

export const isLang = (x: unknown): x is Lang => typeof x === 'string' && (LANGS as readonly string[]).includes(x);

/** Translate `key` into `lang` (unknown lang → ko), filling `{name}` holes from `params`. */
export function t(lang: string, key: DictKey, params?: Params): string {
  const text = (isLang(lang) ? DICTS[lang] : ko)[key];
  return params ? text.replace(/\{(\w+)\}/g, (hole, name: string) => (name in params ? String(params[name]) : hole)) : text;
}

/** Dictionary key for a server error code; codes without an entry fall back to error.INTERNAL. */
export function errorKey(code: string): DictKey {
  const key = `error.${code}`;
  return key in ko ? (key as DictKey) : 'error.INTERNAL';
}

function parts(date: DateStr): Params {
  const [y, m, d] = date.split('-').map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // calendar arithmetic only, no time zone involved
  return { month: m, day: d, weekday };
}

/** e.g. ko '11월 10일 (화)'; `short` gives '11/10 (화)'. */
export function formatDate(lang: string, date: DateStr, short = false): string {
  const p = parts(date);
  const weekday = t(lang, `weekday.${p.weekday}` as DictKey);
  return t(lang, short ? 'date.short' : 'date.format', { ...p, weekday });
}
