import { NextResponse, type NextRequest } from 'next/server';

// Route protection. Anything not in PUBLIC_PATHS requires the
// `access_token` cookie the backend SSO callback sets — without it,
// SSR redirects to /login before any protected content is rendered.
//
// The matcher below already excludes Next.js internals and static
// files, so this only runs for real page requests.
const PUBLIC_PATHS = new Set(['/', '/login']);

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.has(pathname)) {
    return NextResponse.next();
  }

  const token = req.cookies.get('access_token');
  if (!token) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Every path except Next internals, static assets, and public files
    // in /public (identified by having a file extension).
    '/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)',
  ],
};
