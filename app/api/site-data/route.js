import { readBlobJson } from '../../../lib/blobdata';

export const dynamic = 'force-dynamic';

// Az oldal ebből olvas (a jelszavas védelem mögött). Ha a tárhely üres, null-t ad,
// és az oldal a repóban lévő public/data/*.json fájlokra esik vissza.
export async function GET() {
  const [current, stats] = await Promise.all([readBlobJson('data/current.json'), readBlobJson('data/stats.json')]);
  return Response.json({ current, stats }, { headers: { 'cache-control': 'no-store' } });
}
