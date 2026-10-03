import { NextRequest, NextResponse } from 'next/server';
import { readSessionToken, SESSION_COOKIE } from '@/lib/auth';

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (pathname === '/api/health' || pathname.startsWith('/api/auth/')) return NextResponse.next();

  let session = null;
  try {
    session = readSessionToken(request.cookies.get(SESSION_COOKIE)?.value);
  } catch {
    session = null;
  }

  if (!session) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
    }
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('next', `${pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(loginUrl);
  }

  const isApi = pathname.startsWith('/api/');
  const isEntryPage = pathname.startsWith('/entries/daily') || pathname.startsWith('/entries/purchases');
  const isEntryApi = pathname.startsWith('/api/daily') || pathname.startsWith('/api/purchases');
  const isSettingsRead = pathname === '/api/settings' && request.method === 'GET';
  const isFinanceOrSettingsPage = pathname.startsWith('/finance') || pathname.startsWith('/settings');
  const isFinanceOrSettingsApi = pathname.startsWith('/api/finance') || pathname.startsWith('/api/settings');
  const isAdminPage = pathname === '/' || pathname.startsWith('/overview') || pathname.startsWith('/dashboard') || pathname.startsWith('/import-export');
  const isAdminApi = isApi && !isEntryApi && !isSettingsRead && !isFinanceOrSettingsApi;

  if (session.role === 'owner') {
    if (pathname === '/') return NextResponse.redirect(new URL('/dashboard/monthly', request.url));
    return NextResponse.next();
  }

  if (session.role === 'admin') {
    if (isFinanceOrSettingsPage || isFinanceOrSettingsApi) {
      if (isApi) return NextResponse.json({ error: 'This section is available to owners only.' }, { status: 403 });
      return NextResponse.redirect(new URL('/overview?access=restricted', request.url));
    }
    if (pathname === '/') return NextResponse.redirect(new URL('/overview', request.url));
    if (isEntryPage || isEntryApi || isSettingsRead || isAdminPage || isAdminApi) return NextResponse.next();
    if (isApi) return NextResponse.json({ error: 'This account does not have access to this resource.' }, { status: 403 });
    return NextResponse.redirect(new URL('/overview?access=restricted', request.url));
  }

  if (session.role === 'staff') {
    if (pathname === '/') return NextResponse.redirect(new URL('/entries/daily', request.url));
    if (isEntryApi && request.method === 'DELETE') return NextResponse.json({ error: 'Only admins and owners can delete entries.' }, { status: 403 });
    if (isEntryPage || isEntryApi || isSettingsRead) return NextResponse.next();
    if (isApi) {
      return NextResponse.json({ error: 'This action is not available to staff.' }, { status: 403 });
    }
    return NextResponse.redirect(new URL('/entries/daily', request.url));
  }

  if (isApi) {
    return NextResponse.json({ error: 'This account does not have access to this resource.' }, { status: 403 });
  }
  return NextResponse.redirect(new URL('/login?access=restricted', request.url));
}

export const config = {
  matcher: ['/', '/overview/:path*', '/dashboard/:path*', '/finance/:path*', '/entries/:path*', '/settings/:path*', '/import-export/:path*', '/api/:path*']
};