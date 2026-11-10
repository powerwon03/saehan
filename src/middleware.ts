import { NextResponse, type NextRequest } from 'next/server';

// Edge runtime: cookie presence only. The HMAC is verified in the API guards (and server components).
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (req.cookies.has('otl_session')) return NextResponse.next();
  const isAdmin = pathname === '/admin' || pathname.startsWith('/admin/');
  const isWorker = pathname === '/w' || (pathname.startsWith('/w/') && pathname !== '/w/login');
  if (isAdmin) return NextResponse.redirect(new URL('/login', req.url));
  if (isWorker) return NextResponse.redirect(new URL('/w/login', req.url));
  return NextResponse.next();
}

export const config = { matcher: ['/admin', '/admin/:path*', '/w', '/w/:path*'] };
