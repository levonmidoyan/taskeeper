import { NextResponse, type NextRequest } from 'next/server';
import { REQUEST_PATH_HEADER } from '@/lib/request-path';

/*
 * Server components can't read the request URL, so a signed-out visitor bounced to
 * sign-in would lose where they were going (a shared task link, say). This hands the
 * path and query down as a request header for signInRedirect() to put in ?redirectTo=.
 */
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set(REQUEST_PATH_HEADER, request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // Pages only: not the auth API, Next's own assets, or files in public/.
  matcher: ['/((?!api/|_next/|auth/|.*\\.[a-z0-9]+$).*)'],
};
