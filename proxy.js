import { NextResponse } from 'next/server';

// Egyszerű jelszavas védelem (HTTP Basic Auth). Felhasználónév bármi lehet,
// a jelszó az APP_PASSWORD környezeti változó. A Vercel Cron útvonalát
// a CRON_SECRET védi, ezért azt itt kihagyjuk.
export function proxy(req) {
  const pass = process.env.APP_PASSWORD;
  if (!pass) {
    return new NextResponse(
      'Az APP_PASSWORD környezeti változó nincs beállítva a Vercelen, ezért az oldal zárva van.',
      { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } }
    );
  }
  const auth = req.headers.get('authorization') || '';
  if (auth.startsWith('Basic ')) {
    try {
      const decoded = atob(auth.slice(6));
      const given = decoded.slice(decoded.indexOf(':') + 1);
      if (given === pass) return NextResponse.next();
    } catch {}
  }
  return new NextResponse('Jelszó szükséges.', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Focitipp Agent", charset="UTF-8"' },
  });
}

export const config = {
  matcher: ['/((?!api/cron|_next/static|_next/image|favicon.ico).*)'],
};
