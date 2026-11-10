import { signSession, type Session } from '@/server/auth/session';

/** `json` is null for non-JSON bodies (downloads); `body` always has the raw bytes. */
export type RouteResult = { status: number; json: any; setCookie: string | null; headers: Headers; body: Buffer };
type Handler = (req: Request, ctx?: any) => Promise<Response> | Response;

/** Invoke an exported route handler with a synthetic Request (a FormData body is sent as multipart, anything else as JSON); optionally authenticated via a signed session cookie. */
export async function callRoute(
  handler: Handler,
  opts: { method?: string; url?: string; body?: unknown; session?: Session; params?: Record<string, string>; headers?: Record<string, string> } = {},
): Promise<RouteResult> {
  const headers = new Headers(opts.headers);
  const isForm = opts.body instanceof FormData;
  if (opts.body !== undefined && !isForm) headers.set('content-type', 'application/json');
  if (opts.session) headers.set('cookie', `otl_session=${signSession(opts.session)}`);
  const req = new Request(opts.url ?? 'http://localhost/api/test', {
    method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
    headers,
    body: opts.body === undefined ? undefined : isForm ? (opts.body as FormData) : JSON.stringify(opts.body),
  });
  const res = await handler(req, opts.params ? { params: Promise.resolve(opts.params) } : undefined);
  const body = Buffer.from(await res.arrayBuffer());
  const isJson = (res.headers.get('content-type') ?? '').includes('json');
  return { status: res.status, json: isJson && body.length ? JSON.parse(body.toString('utf8')) : null, setCookie: res.headers.get('set-cookie'), headers: res.headers, body };
}
