import { settleStep, archiveDay, TRACK } from '../../../lib/learning';
import { readBlobJson } from '../../../lib/blobdata';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Tanulási kör (?key=<DATA_KEY>):
//   step=1                      – a lejátszott meccsek eredményeinek lekérése (legfeljebb 8 kérés), összesítés frissítése
//   archive=blob|repo&day=NAP   – egy meglévő current dokumentum utólagos archiválása (pl. visszamenőleges kiértékeléshez)
//   (semmi)                     – az utolsó összesítés (találati arányok, kalibráció, saját adatbázis)
export async function GET(req) {
  const u = new URL(req.url);
  if (!process.env.DATA_KEY || u.searchParams.get('key') !== process.env.DATA_KEY) return Response.json({ error: 'Nincs jogosultság.' }, { status: 401 });
  try {
    const arch = u.searchParams.get('archive');
    if (arch) {
      const day = u.searchParams.get('day') || undefined;
      if (day && !/^\d{4}-\d{2}-\d{2}$/.test(day)) return Response.json({ error: 'Hibás nap.' }, { status: 400 });
      const cur = arch === 'repo'
        ? await fetch(new URL('/data/current.json', u.origin), { cache: 'no-store', headers: { authorization: 'Basic ' + Buffer.from('x:' + (process.env.APP_PASSWORD || '').trim(), 'utf8').toString('base64') } }).then((r) => (r.ok ? r.json() : null)).catch(() => null)
        : await readBlobJson('data/current.json');
      if (!cur?.matches) return Response.json({ error: 'Nincs archiválható current dokumentum.' }, { status: 404 });
      return Response.json({ ok: true, ...(await archiveDay(cur, day)) });
    }
    if (u.searchParams.get('step')) {
      const out = await settleStep();
      return Response.json({ ...out, nextCallAfterSeconds: out.done ? 0 : 65 });
    }
    return Response.json((await readBlobJson(TRACK)) || { error: 'Még nincs összesítés.' });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
