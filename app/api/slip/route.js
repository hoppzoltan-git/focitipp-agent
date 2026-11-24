import { callClaude } from '../../../lib/claude';
import { ANALYST, withStats } from '../../../lib/prompts';
import { readDoc } from '../../../lib/store';

export const maxDuration = 120;
export const dynamic = 'force-dynamic';

const TASK = `A csatolt kép(ek) a felhasználó fogadási szelvényét mutatják.
1. Olvasd ki minden tételt: meccs, fogadás típusa, odds; valamint a tétet, az összoddsot és a lehetséges nyereményt, ha látszik. Ha valami olvashatatlan, írd meg.
2. Minden tételnél: ha a meccs szerepel az agent-adatokban, add meg a becsült valószínűséget, a fair oddsot és a várható értéket (valószínűség × odds − 1), és mondd meg, egyezik-e az agent tippjével. Szöglet- és lapfogadásnál használd a szoglet_lap_jatekvezeto adatokat, és jelezd, ha a játékvezető nem megerősített. A kiesett vagy kérdéses kulcsjátékosokat említsd. Ha a meccs nem szerepel, mondd ki, hogy nincs rá adatod, és csak óvatos, általános megjegyzést tegyél.
3. Kötésnél becsüld meg a teljes szelvény bejövési esélyét (az ismert valószínűségek szorzata), és vesd össze az összoddsszal.
4. Zárásként: rövid ítélet (értékes / semleges / túl kockázatos), a leggyengébb láncszem, és mit cserélnél vagy hagynál ki.
Légy tömör (kb. 250 szó), rövid felsorolással.`;

export async function POST(req) {
  try {
    const form = await req.formData();
    const files = form.getAll('images').slice(0, 4);
    if (!files.length) return Response.json({ error: 'Nem érkezett kép.' }, { status: 400 });
    const images = [];
    for (const f of files) {
      if (!f || typeof f.arrayBuffer !== 'function') continue;
      if (f.size > 4 * 1024 * 1024) return Response.json({ error: 'Túl nagy kép (max. 4 MB).' }, { status: 400 });
      const b64 = Buffer.from(await f.arrayBuffer()).toString('base64');
      images.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } });
    }
    const [current, stats] = await Promise.all([readDoc('current'), readDoc('stats')]);
    const ms = (current?.matches || []).map((m) => withStats(m, stats));
    const text = await callClaude({
      system: ANALYST,
      content: [...images, { type: 'text', text: `${TASK}\n\nAGENT-ADATOK (JSON):\n${JSON.stringify(ms)}` }],
      maxTokens: 2500,
    });
    return Response.json({ text });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
