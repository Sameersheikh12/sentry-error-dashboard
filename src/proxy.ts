import { NextResponse, type NextRequest } from 'next/server'

const COOKIE = 'dashboard-access'

/**
 * A shared secret is the whole gate — deliberately not a user system. It only engages when
 * DASHBOARD_ACCESS_SECRET is set; local development stays frictionless.
 */
export function proxy(request: NextRequest) {
  const secret = process.env.DASHBOARD_ACCESS_SECRET
  if (!secret) return NextResponse.next()

  if (request.cookies.get(COOKIE)?.value === secret) return NextResponse.next()

  if (request.nextUrl.searchParams.get('access') === secret) {
    const url = request.nextUrl.clone()
    url.searchParams.delete('access')
    const response = NextResponse.redirect(url)
    response.cookies.set(COOKIE, secret, { httpOnly: true, sameSite: 'lax', secure: true })
    return response
  }

  return new NextResponse('Access denied. Append ?access=<shared secret> to this URL.', {
    status: 401,
  })
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
