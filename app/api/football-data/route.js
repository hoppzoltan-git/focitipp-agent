import { put, head } from '@vercel/blob';
import { af, collect } from '../../../lib/apifootball';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const CACHE = 'cache/football-data.json';
const TTL_MS = 3 * 60 * 60 * 1000; // 3 óra, hogy kíméljük a napi 100 kéréses keretet

// A napi Claude-feladat hívja: ?key=<DATA_KEY>[&fresh=1][&status=1]
export async function GET(req) {
  const url = new URL(req.url);
  if (!process.env.DATA_KEY || url.searchParams.get('key') !== process.env.DATA_KEY) {
    return Response.json({ error: 'Nincs jogosultság.' }, { status: 401 });
  }
  try {
    if (url.searchParams.get('status')) {
      const s = await af('/status');
      return Response.json({ account: s.response?.account?.firstname ? 'ok' : null, subscription: s.response?.subscription, requests: s.response?.requests });
    }
    if (!url.searchParams.get('fresh')) {
      try {
        const meta = await head(CACHE);
        if (Date.now() - new Date(meta.uploadedAt).getTime() < TTL_MS) {
          const r = await fetch(`${meta.url}?t=${Date.now()}`, { cache: 'no-store' });
          if (r.ok) return Response.json({ cached: true, ...(await r.json()) });
        }
      } catch {}
    }
    const data = await collect();
    try {
      await put(CACHE, JSON.stringify(data), { access: 'public', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json', cacheControlMaxAge: 60 });
    } catch {}
    return Response.json({ cached: false, ...data });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
