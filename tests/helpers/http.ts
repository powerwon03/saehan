import { signSession, type Session } from '@/server/auth/session';

export type RouteResult = { status: number; json: any; setCookie: string | null };
type Handler = (req: Request, ctx?: any) => Promise<Response> | Response;

/** Invoke an exported route handler with a synthetic Request; optionally authenticated via a signed session cookie. */
export async function callRoute(
  handler: Handler,
  opts: { method?: string; url?: string; body?: unknown; session?: Session; params?: Record<string, string>; headers?: Record<string, string> } = {},
): Promise<RouteResult> {
  const headers = new Headers(opts.headers);
  if (opts.body !== undefined) headers.set('content-type', 'application/json');
  if (opts.session) headers.set('cookie', `otl_session=${signSession(opts.session)}`);
  const req = new Request(opts.url ?? 'http://localhost/api/test', {
    method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const res = await handler(req, opts.params ? { params: Promise.resolve(opts.params) } : undefined);
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null, setCookie: res.headers.get('set-cookie') };
}
