import { callClaude, extractJson, WEB_SEARCH } from './claude';
import { FIXTURES_PROMPT, MATCH_PROMPT } from './prompts';
import { writeDoc } from './store';

const SYSTEM = 'Te egy alapos futballelemző kutató vagy. Mindent magyarul írsz. Fogadást soha nem teszel, csak elemzést készítesz. A végső válaszod mindig csak a kért JSON.';

function budapestNow() {
  const d = new Date();
  const s = d.toLocaleString('sv-SE', { timeZone: 'Europe/Budapest' }).replace(' ', 'T');
  return s.slice(0, 16);
}

// Teljes napi frissítés: meccslista, majd meccsenként párhuzamos kutatás.
export async function runRefresh() {
  const now = budapestNow();
  const fxText = await callClaude({ system: SYSTEM, content: FIXTURES_PROMPT(now), tools: [WEB_SEARCH(5)], maxTokens: 3000 });
  const fx = extractJson(fxText);
  const list = (fx.matches || []).slice(0, 10);
  if (!list.length) throw new Error('Nem találtam meccset az időablakban.');

  const results = await Promise.allSettled(
    list.map(async (m) => {
      const t = await callClaude({ system: SYSTEM, content: MATCH_PROMPT(m, now), tools: [WEB_SEARCH(7)], maxTokens: 6000 });
      const j = extractJson(t);
      if (!j.match) throw new Error('hiányzó match');
      j.match.id = m.id;
      return j;
    })
  );
  const ok = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  if (!ok.length) throw new Error('Egyik meccs elemzése sem sikerült.');

  const updatedAt = new Date().toISOString();
  const current = { updatedAt, title: fx.title || 'Focitipp Agent', subtitle: fx.subtitle || '', matches: ok.map((x) => x.match) };
  const stats = {
    updatedAt,
    note: 'A szöglet-, lap- és játékvezetői adatok webes forrásokból származnak, a minták gyakran kicsik.',
    byId: Object.fromEntries(ok.filter((x) => x.stats).map((x) => [x.match.id, x.stats])),
  };
  await writeDoc('current', current);
  await writeDoc('stats', stats);
  return { matches: ok.length, failed: results.length - ok.length };
}
