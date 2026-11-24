import { readDoc } from '../../../lib/store';

export const dynamic = 'force-dynamic';

export async function GET() {
  const [current, stats] = await Promise.all([readDoc('current'), readDoc('stats')]);
  return Response.json({ current, stats }, { headers: { 'cache-control': 'no-store' } });
}
