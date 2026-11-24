const API = 'https://api.anthropic.com/v1/messages';
export const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';

export const WEB_SEARCH = (maxUses = 6) => ({ type: 'web_search_20250305', name: 'web_search', max_uses: maxUses });

// Egy Claude-hívás; a hosszú webes keresést (pause_turn) legfeljebb 4-szer folytatja.
export async function callClaude({ system, content, tools, maxTokens = 4000, model = MODEL }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('Az ANTHROPIC_API_KEY nincs beállítva a Vercelen.');
  const messages = [{ role: 'user', content }];
  let last;
  for (let i = 0; i < 5; i++) {
    const r = await fetch(API, {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: maxTokens, system, messages, ...(tools ? { tools } : {}) }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(`Claude API hiba (${r.status}): ${j?.error?.message || 'ismeretlen'}`);
    last = j;
    if (j.stop_reason === 'pause_turn') {
      messages.push({ role: 'assistant', content: j.content });
      continue;
    }
    break;
  }
  return (last?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
}

// A válaszból kiveszi a JSON-t (kódblokkból vagy az első {…}/[…] részből).
export function extractJson(text) {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = [fence?.[1], text];
  for (const c of candidates) {
    if (!c) continue;
    try { return JSON.parse(c.trim()); } catch {}
    const s = Math.min(...['{', '['].map((ch) => { const i = c.indexOf(ch); return i < 0 ? Infinity : i; }));
    const e = Math.max(c.lastIndexOf('}'), c.lastIndexOf(']'));
    if (s !== Infinity && e > s) { try { return JSON.parse(c.slice(s, e + 1)); } catch {} }
  }
  throw new Error('A válaszban nem volt értelmezhető JSON.');
}
