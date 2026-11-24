import { put, head } from '@vercel/blob';
import { af, step } from '../../../lib/apifootball';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const STATE = 'cache/football-state.json';
const RESULT = 'cache/football-data.json';

async function readBlob(path) {
  try {
    const meta = await head(path);
    const r = await fetch(`${meta.url}?t=${Date.now()}`, { cache: 'no-store' });
    return r.ok ? { data: await r.json(), uploadedAt: new Date(meta.uploadedAt) } : null;
  } catch { return null; }
}
const writeBlob = (path, data) => put(path, JSON.stringify(data), { access: 'public', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json', cacheControlMaxAge: 60 });

// A napi Claude-feladat hívja. Paraméterek (mind ?key=<DATA_KEY> mellett):
//   status=1  – a fiók napi kerete (nem fogyaszt)
//   step=1    – egy gyűjtési lépés (legfeljebb 8 kérés); addig hívandó kb. percenként, amíg done:true
//   reset=1   – új napi gyűjtés indítása (step=1-gyel együtt)
//   (semmi)   – az utolsó kész eredmény
export async function GET(req) {
  const url = new URL(req.url);
  if (!process.env.DATA_KEY || url.searchParams.get('key') !== process.env.DATA_KEY) {
    return Response.json({ error: 'Nincs jogosultság.' }, { status: 401 });
  }
  try {
    if (url.searchParams.get('status')) {
      const s = await af('/status');
      return Response.json({ subscription: s.response?.subscription, requests: s.response?.requests });
    }
    if (url.searchParams.get('step')) {
      let prev = await readBlob(STATE);
      let state = prev?.data;
      // 6 óránál régebbi vagy kért újraindítás → új gyűjtés
      if (url.searchParams.get('reset') || !state || (prev && Date.now() - prev.uploadedAt.getTime() > 6 * 3600 * 1000)) state = null;
      if (state?.stage === 'done' && !url.searchParams.get('reset')) {
        const res = await readBlob(RESULT);
        return Response.json({ done: true, note: 'A mai gyűjtés már kész. Új gyűjtéshez: reset=1.', data: res?.data || null });
      }
      const out = await step(state);
      await writeBlob(STATE, out.state);
      if (out.done) await writeBlob(RESULT, out.data);
      return Response.json({ done: out.done, usedThisCall: out.usedThisCall, remainingToday: out.remainingToday, pending: out.pendingRequests, nextCallAfterSeconds: out.done ? 0 : 65, data: out.data });
    }
    const res = await readBlob(RESULT);
    return Response.json(res ? { generatedAtBlob: res.uploadedAt, ...res.data } : { error: 'Még nincs kész gyűjtés.' }, { status: res ? 200 : 404 });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
