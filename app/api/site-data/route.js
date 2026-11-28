import { readBlobJson } from '../../../lib/blobdata';

export const dynamic = 'force-dynamic';

// Az oldal ebből olvas (a jelszavas védelem mögött). Ha a tárhely üres, null-t ad,
// és az oldal a repóban lévő public/data/*.json fájlokra esik vissza.
export async function GET() {
  const [current, stats, track] = await Promise.all([readBlobJson('data/current.json'), readBlobJson('data/stats.json'), readBlobJson('data/track.json')]);
  return Response.json({ current, stats, track }, { headers: { 'cache-control': 'no-store' } });
}
