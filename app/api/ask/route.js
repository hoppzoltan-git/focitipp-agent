import { callClaude } from '../../../lib/claude';
import { ANALYST, withStats } from '../../../lib/prompts';
import { readDoc } from '../../../lib/store';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function POST(req) {
  try {
    const { matchId, question } = await req.json();
    const [current, stats] = await Promise.all([readDoc('current'), readDoc('stats')]);
    const m = current?.matches?.find((x) => x.id === matchId);
    if (!m) return Response.json({ error: 'Ez a meccs nincs az adatok között.' }, { status: 404 });
    const q = String(question || '').slice(0, 1000).trim() || 'Adj részletes tippet erre a meccsre: 1X2, gólszám, mindkét csapat szerez-e gólt, szöglet és lapok.';
    const text = await callClaude({
      system: ANALYST + ' Légy tömör: legfeljebb kb. 200 szó, rövid felsorolással, ha segít.',
      content: `MECCSADATOK (JSON):\n${JSON.stringify(withStats(m, stats))}\n\nKÉRDÉS: ${q}`,
      maxTokens: 1500,
    });
    return Response.json({ text });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
