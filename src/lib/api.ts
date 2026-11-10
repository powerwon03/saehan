export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; code: string; body: Record<string, unknown> };

/** JSON fetch for the worker and admin screens. A network failure becomes code 'NETWORK' (status 0). */
export async function api<T>(path: string, body?: unknown): Promise<ApiResult<T>> {
  try {
    const res = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.ok) return { ok: true, data: json as T };
    return { ok: false, status: res.status, code: typeof json.error === 'string' ? json.error : 'INTERNAL', body: json };
  } catch {
    return { ok: false, status: 0, code: 'NETWORK', body: {} };
  }
}

const COMPANY_KEY = 'otl_company';

/**
 * Company code for login: `?company=` when present (and remembered), else the last one remembered, so that
 * logout / 401 redirects to a bare login URL keep the company. Not a secret. null → server default.
 */
export function loginCompany(fromQuery: string | null): string | null {
  if (fromQuery) {
    store.set(COMPANY_KEY, fromQuery);
    return fromQuery;
  }
  return store.get(COMPANY_KEY);
}

/** localStorage that never throws (private mode, disabled storage). */
export const store = {
  get(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* storage unavailable: nothing to keep */
    }
  },
};
