import { NextResponse, type NextRequest } from 'next/server'
import { createHmac, timingSafeEqual } from 'node:crypto'

// Node runtime (not the default Edge) so we can use `node:crypto` to
// verify the session cookie's HMAC — same algorithm as
// src/lib/auth/session.ts, duplicated here on purpose rather than
// imported: importing session.ts would pull in the Drizzle/pg client,
// which is unnecessary weight for a check that's deliberately signature-
// only (no DB round trip). The DB-backed "does this session still
// exist / hasn't expired" check happens downstream, in
// getCurrentAccount() / the /admin layout — same split Supabase's
// middleware + server-client pairing had.
export const runtime = 'nodejs'

const SESSION_COOKIE_NAME = 'divarytalk_session'

function hasValidSessionCookie(request: NextRequest): boolean {
  const raw = request.cookies.get(SESSION_COOKIE_NAME)?.value
  if (!raw) return false

  const dot = raw.lastIndexOf('.')
  if (dot < 0) return false
  const sessionId = raw.slice(0, dot)
  const providedSig = raw.slice(dot + 1)

  const secret = process.env.SESSION_SECRET
  if (!secret) return false

  const expectedSig = createHmac('sha256', secret).update(sessionId).digest('hex')
  const a = Buffer.from(providedSig)
  const b = Buffer.from(expectedSig)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function middleware(request: NextRequest) {
  const authed = hasValidSessionCookie(request)

  // Auth pages — redirect to dashboard if already logged in.
  if (
    authed &&
    (request.nextUrl.pathname === '/login' || request.nextUrl.pathname === '/forgot-password')
  ) {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    url.search = ''
    return NextResponse.redirect(url)
  }

  // Protected pages — redirect to login if not authenticated.
  const protectedPaths = [
    '/dashboard',
    '/inbox',
    '/contacts',
    '/pipelines',
    '/broadcasts',
    '/automations',
    '/settings',
    '/admin',
  ]
  if (!authed && protectedPaths.some((path) => request.nextUrl.pathname.startsWith(path))) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // API routes that need auth (not webhooks).
  if (
    !authed &&
    request.nextUrl.pathname.startsWith('/api/whatsapp/') &&
    !request.nextUrl.pathname.includes('/webhook')
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
