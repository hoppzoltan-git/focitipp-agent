import { gunzipSync } from 'node:zlib';
import { writeBlob, listPrefix, deletePrefix } from '../../../lib/blobdata';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const DOCS = new Set(['current', 'stats']);

// A napi Claude-feladat ezen keresztül tölti fel az adatokat (GET, mert csak URL-t tud hívni):
//   ?key=<DATA_KEY>&doc=current|stats&run=<azonosító>&part=<1..n>&total=<n>&d=<gzip+base64url darab>
// Ha minden darab megérkezett, összerakja, ellenőrzi a JSON-t, és élesíti: data/<doc>.json
export async function GET(req) {
  const u = new URL(req.url);
  const q = (k) => u.searchParams.get(k) || '';
  if (!process.env.DATA_KEY || q('key') !== process.env.DATA_KEY) return Response.json({ error: 'Nincs jogosultság.' }, { status: 401 });
  const doc = q('doc'), run = q('run'), part = Number(q('part')), total = Number(q('total')), d = q('d');
  if (!DOCS.has(doc) || !/^[A-Za-z0-9_-]{1,40}$/.test(run) || !(part >= 1 && part <= total && total <= 40) || !d) {
    return Response.json({ error: 'Hibás paraméterek.' }, { status: 400 });
  }
  try {
    const prefix = `ingest/${run}/${doc}/`;
    await writeBlob(`${prefix}${String(part).padStart(3, '0')}`, d, 'text/plain');
    const blobs = await listPrefix(prefix);
    if (blobs.length < total) return Response.json({ ok: true, received: blobs.length, total, done: false });

    const chunks = [];
    for (let i = 1; i <= total; i++) {
      const b = blobs.find((x) => x.pathname === `${prefix}${String(i).padStart(3, '0')}`);
      if (!b) return Response.json({ ok: true, received: blobs.length, total, done: false, missing: i });
      const r = await fetch(`${b.url}?t=${Date.now()}`, { cache: 'no-store' });
      chunks.push((await r.text()).trim());
    }
    const b64 = chunks.join('').replace(/-/g, '+').replace(/_/g, '/');
    const json = gunzipSync(Buffer.from(b64, 'base64')).toString('utf8');
    const parsed = JSON.parse(json);
    if (doc === 'current' && !Array.isArray(parsed.matches)) throw new Error('A current dokumentumból hiányzik a matches tömb.');
    if (doc === 'stats' && typeof parsed.byId !== 'object') throw new Error('A stats dokumentumból hiányzik a byId.');
    await writeBlob(`data/${doc}.json`, JSON.stringify(parsed));
    await deletePrefix(prefix).catch(() => {});
    return Response.json({ ok: true, done: true, doc, bytes: json.length, matches: parsed.matches?.length, published: true });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
