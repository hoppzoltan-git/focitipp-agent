// Tanulási kör: a napi tippek archiválása, kiértékelése a valós eredményekkel,
// és ebből összesítés (találati arány, kalibráció, megtérülés, saját csapat-/játékvezető-adatbázis).
import { readBlobJson, writeBlob, listPrefix } from './blobdata';
import { af, beginBudget, hasRoom } from './apifootball';

const DAYS = 'history/days/';
const LEDGER = 'history/ledger.json';
export const TRACK = 'data/track.json';

const budapestDay = (iso) => new Date(iso || Date.now()).toLocaleDateString('sv-SE', { timeZone: 'Europe/Budapest' });
const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const frac = (p) => { const n = num(p); return n === null ? null : n > 1 ? n / 100 : n; };
const r2 = (x) => (x === null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);

// Szöveges magyar tipp → strukturált fogadás (ha a futás nem adott 'bet' mezőt)
const norm = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
export function parsePick(pick, home, away) {
  const p = norm(pick);
  if (!p) return null;
  const line = (() => { const m = String(pick).match(/(\d+)[,.](5)/); return m ? Number(`${m[1]}.${m[2]}`) : null; })();
  const side = /(felett|folott|over|tobb mint)/.test(p) ? 'over' : /(alatt|under|kevesebb)/.test(p) ? 'under' : null;
  if (line !== null && side) {
    if (/szoglet|corner/.test(p)) return { type: 'CORNERS', sel: side, line };
    if (/lap|card/.test(p)) return { type: 'CARDS', sel: side, line };
    if (/gol|goal/.test(p)) return { type: 'OU', sel: side, line };
  }
  if (/mindket csapat|btts/.test(p)) return { type: 'BTTS', sel: /(nem|no)\b/.test(p) && !/igen/.test(p) ? 'no' : 'yes' };
  if (/\b1x\b/.test(p)) return { type: 'DC', sel: '1X' };
  if (/\bx2\b/.test(p)) return { type: 'DC', sel: 'X2' };
  if (/\b12\b/.test(p)) return { type: 'DC', sel: '12' };
  if (/dontetlen/.test(p) && !/(nem|vagy)/.test(p)) return { type: '1X2', sel: 'D' };
  const hn = norm(home), an = norm(away);
  const first = (n) => n.split(' ').filter((w) => w.length > 2)[0] || n;
  const hit = (n) => n && (p.includes(n) || p.includes(first(n)));
  if (/(gyozelem|nyer|gyoz)/.test(p) && !/vagy/.test(p)) {
    if (hit(hn) && !hit(an)) return { type: '1X2', sel: 'H' };
    if (hit(an) && !hit(hn)) return { type: '1X2', sel: 'A' };
  }
  if (/(vagy dontetlen|nem kap ki|nem veszit)/.test(p)) {
    if (hit(hn) && !hit(an)) return { type: 'DC', sel: '1X' };
    if (hit(an) && !hit(hn)) return { type: 'DC', sel: 'X2' };
  }
  return null;
}
const withBet = (t, text, home, away) => t?.bet || parsePick(text, home, away);

// --- 1) Archiválás: az ingest hívja, amikor a current dokumentum élesedik ---
export async function archiveDay(current, dayOverride) {
  const stats = (await readBlobJson('data/stats.json')) || {};
  const byId = stats.byId || {};
  const day = dayOverride || budapestDay(current.updatedAt);
  const snap = {
    day,
    savedAt: new Date().toISOString(),
    matches: (current.matches || []).map((m) => ({
      id: m.id, fixtureId: num(m.fixtureId), comp: m.comp, kickoff: m.kickoff,
      home: m.home?.name, away: m.away?.name, prob: m.prob || null,
      tip: m.tip ? { pick: m.tip.pick, conf: m.tip.conf, bet: withBet(m.tip, m.tip.pick, m.home?.name, m.away?.name) } : null,
      corners: byId[m.id]?.corners ? { exp: num(byId[m.id].corners.exp), line: num(byId[m.id].corners.line), tip: byId[m.id].corners.tip, conf: byId[m.id].corners.conf, bet: withBet(byId[m.id].corners, byId[m.id].corners.tip, m.home?.name, m.away?.name) } : null,
      cards: byId[m.id]?.cards ? { exp: num(byId[m.id].cards.exp), line: num(byId[m.id].cards.line), tip: byId[m.id].cards.tip, conf: byId[m.id].cards.conf, bet: withBet(byId[m.id].cards, byId[m.id].cards.tip, m.home?.name, m.away?.name) } : null,
      referee: byId[m.id]?.referee?.name || null,
    })),
    slips: (current.slips || []).map((s) => ({ title: s.title, badge: s.badge, legs: (s.legs || []).map((l) => { const mm = (current.matches || []).find((x) => x.id === l.matchId); return { matchId: l.matchId, pick: l.pick, odds: num(l.odds), prob: frac(l.prob), bet: withBet(l, l.pick, mm?.home?.name, mm?.away?.name) }; }) })),
  };
  await writeBlob(`${DAYS}${day}.json`, JSON.stringify(snap));
  return { day, archivedMatches: snap.matches.length, withFixtureId: snap.matches.filter((m) => m.fixtureId).length };
}

// --- 2) Eredmények lekérése (lépésenként, a napi keretet kímélve) ---
const FINISHED = new Set(['FT', 'AET', 'PEN']);
const DEAD = new Set(['PST', 'CANC', 'ABD', 'AWD', 'WO']);

function slimResult(f) {
  const st = {};
  for (const t of f.statistics || []) {
    const side = t.team?.id === f.teams.home.id ? 0 : 1;
    for (const s of t.statistics || []) {
      const k = s.type === 'Corner Kicks' ? 'corners' : s.type === 'Yellow Cards' ? 'yellow' : s.type === 'Red Cards' ? 'red' : null;
      if (k) { (st[k] ||= [0, 0])[side] = Number(s.value) || 0; }
    }
  }
  const ft = f.score?.fulltime;
  return {
    fid: f.fixture.id, status: f.fixture.status?.short, date: f.fixture.date, league: f.league?.name,
    referee: f.fixture.referee || null, home: f.teams.home.name, away: f.teams.away.name,
    goals: ft && ft.home !== null ? [ft.home, ft.away] : [f.goals?.home, f.goals?.away],
    corners: st.corners || null, yellow: st.yellow || null, red: st.red || null,
    hasStats: !!(f.statistics && f.statistics.length),
  };
}

export async function loadAll() {
  const ledger = (await readBlobJson(LEDGER)) || { results: {}, tries: {} };
  const blobs = (await listPrefix(DAYS)).sort((a, b) => a.pathname.localeCompare(b.pathname));
  const days = [];
  for (const b of blobs) {
    const r = await fetch(`${b.url}?t=${Date.now()}`, { cache: 'no-store' }).catch(() => null);
    if (r?.ok) days.push(await r.json());
  }
  return { ledger, days };
}

const sameTeam = (a, b) => { const x = norm(a), y = norm(b); if (!x || !y) return false; if (x === y || x.includes(y) || y.includes(x)) return true; const wx = x.split(' ').filter((w) => w.length > 3), wy = new Set(y.split(' ').filter((w) => w.length > 3)); return wx.some((w) => wy.has(w)); };

export async function settleStep({ maxCalls = 8 } = {}) {
  const { ledger, days } = await loadAll();
  const now = Date.now();
  ledger.dateLists ||= {};
  // Hiányzó API-Football azonosítók pótlása: dátumonként 1 kérés, csapatnév-egyeztetéssel
  const needDates = new Set();
  for (const d of days) for (const m of d.matches) if (!m.fixtureId && m.kickoff && now > Date.parse(m.kickoff) + 2.5 * 3600e3) needDates.add(budapestDay(m.kickoff));
  let resolved = 0;
  const dirty = new Set();
  if (needDates.size) await beginBudget();
  for (const date of needDates) {
    if ((!ledger.dateLists[date] || (ledger.dateLists[date].error && (ledger.dateLists[date].tries || 0) < 2)) && hasRoom(maxCalls)) {
      try {
        const r = await af('/fixtures', { date, timezone: 'Europe/Budapest' });
        ledger.dateLists[date] = (r.response || []).filter((f) => [2, 3, 848, 39, 140].includes(f.league?.id)).map((f) => ({ fid: f.fixture.id, home: f.teams.home.name, away: f.teams.away.name }));
      } catch (e) { ledger.dateLists[date] = { error: e.message, tries: (ledger.dateLists[date]?.tries || 0) + 1 }; }
    }
    const list = Array.isArray(ledger.dateLists[date]) ? ledger.dateLists[date] : [];
    for (const d of days) for (const m of d.matches) {
      if (m.fixtureId || budapestDay(m.kickoff) !== date) continue;
      const f = list.find((x) => sameTeam(x.home, m.home) && sameTeam(x.away, m.away));
      if (f) { m.fixtureId = f.fid; resolved++; dirty.add(d.day); }
    }
  }
  for (const d of days) if (dirty.has(d.day)) await writeBlob(`${DAYS}${d.day}.json`, JSON.stringify(d));
  const want = new Map();
  for (const d of days) for (const m of d.matches) {
    if (!m.fixtureId) continue;
    const res = ledger.results[m.fixtureId];
    const final = res && (DEAD.has(res.status) || (FINISHED.has(res.status) && res.hasStats));
    const ko = Date.parse(m.kickoff);
    if (!final && Number.isFinite(ko) && now > ko + 2.5 * 3600e3 && (ledger.tries[m.fixtureId] || 0) < 4) want.set(m.fixtureId, ko);
  }
  const queue = [...want.keys()];
  const errors = [];
  let fetched = 0;
  if (queue.length) {
    if (!needDates.size) await beginBudget();
    while (queue.length && hasRoom(maxCalls)) {
      const fid = queue.shift();
      ledger.tries[fid] = (ledger.tries[fid] || 0) + 1;
      try {
        const f = (await af('/fixtures', { id: fid, timezone: 'Europe/Budapest' })).response?.[0];
        if (f) { ledger.results[fid] = slimResult(f); fetched++; }
      } catch (e) {
        errors.push(`${fid}: ${e.message}`);
        if (/keret elfogyott|request limit|rateLimit|Too many/i.test(e.message)) { ledger.tries[fid]--; break; }
      }
    }
  }
  ledger.updatedAt = new Date().toISOString();
  await writeBlob(LEDGER, JSON.stringify(ledger));
  const summary = summarize(ledger, days);
  await writeBlob(TRACK, JSON.stringify(summary));
  const dateErrors = [...needDates].filter((d) => ledger.dateLists[d]?.error).map((d) => `${d}: ${ledger.dateLists[d].error}`);
  return { done: queue.length === 0, fetched, resolvedIds: resolved, dateErrors, checkedDates: [...needDates], pending: queue.length, errors, summary };
}

// --- 3) Fogadások kiértékelése ---
// bet: { type: '1X2'|'DC'|'OU'|'BTTS'|'CORNERS'|'CARDS', sel: 'H'|'D'|'A'|'1X'|'X2'|'12'|'over'|'under'|'yes'|'no', line?, odds?, prob? }
export function evalBet(bet, r) {
  if (!bet || !r) return null;
  if (DEAD.has(r.status)) return 'void';
  if (!FINISHED.has(r.status)) return null;
  const [h, a] = r.goals || [];
  if (h === null || h === undefined) return null;
  const sel = String(bet.sel || '').toUpperCase();
  const ou = (val, line) => {
    if (val === null || line === null) return null;
    if (val === line) return 'void';
    return (sel === 'OVER' ? val > line : val < line) ? 'won' : 'lost';
  };
  switch (String(bet.type || '').toUpperCase()) {
    case '1X2': { const o = h > a ? 'H' : h < a ? 'A' : 'D'; return o === sel ? 'won' : 'lost'; }
    case 'DC': { const o = h > a ? '1' : h < a ? '2' : 'X'; return sel.includes(o) ? 'won' : 'lost'; }
    case 'OU': return ou(h + a, num(bet.line));
    case 'BTTS': { const y = h > 0 && a > 0; return (sel === 'YES') === y ? 'won' : 'lost'; }
    case 'CORNERS': return r.corners ? ou(r.corners[0] + r.corners[1], num(bet.line)) : null;
    case 'CARDS': {
      if (!r.yellow) return null;
      const c = r.yellow[0] + r.yellow[1] + (r.red ? r.red[0] + r.red[1] : 0);
      return ou(c, num(bet.line));
    }
    default: return null;
  }
}

const TYPE_HU = { '1X2': '1X2 (győztes)', DC: 'Dupla esély', OU: 'Gólszám (alá/fölé)', BTTS: 'Mindkét csapat gól', CORNERS: 'Szöglet', CARDS: 'Lapok' };

function agg() { return { n: 0, won: 0, lost: 0, void: 0, pSum: 0, pN: 0, stake: 0, ret: 0 }; }
function add(a, outcome, prob, odds) {
  if (outcome === 'void') { a.void++; return; }
  a.n++; if (outcome === 'won') a.won++; else a.lost++;
  if (prob !== null) { a.pSum += prob; a.pN++; }
  if (odds) { a.stake++; if (outcome === 'won') a.ret += odds; }
}
function fin(a) {
  return {
    n: a.n, won: a.won, lost: a.lost, void: a.void,
    hitRate: a.n ? r2(a.won / a.n) : null,
    expected: a.pN ? r2(a.pSum / a.pN) : null,
    roi: a.stake ? r2((a.ret - a.stake) / a.stake) : null,
  };
}

export function summarize(ledger, days) {
  // Ugyanaz a meccs több napi futásban is szerepelhet: a legutolsó (kezdéshez legközelebbi) tipp számít.
  const latest = new Map();
  const slipList = [];
  for (const d of days) {
    for (const m of d.matches) if (m.fixtureId) latest.set(m.fixtureId, { ...m, day: d.day });
    for (const s of d.slips || []) slipList.push({ day: d.day, ...s, matchToFid: Object.fromEntries(d.matches.filter((m) => m.fixtureId).map((m) => [m.id, m.fixtureId])) });
  }
  const byType = {}, byConf = {}, calib = { '<40%': agg(), '40–55%': agg(), '55–70%': agg(), '70%+': agg() };
  const recent = [];
  const errs = { corners: [], cards: [], goals: [] };
  let brier = 0, brierN = 0;
  for (const [fid, m] of latest) {
    const r = ledger.results[fid];
    if (!r || !FINISHED.has(r.status)) continue;
    const [h, a] = r.goals;
    // 1X2 valószínűségek kalibrációja (Brier-pontszám)
    if (m.prob) {
      const p = [frac(m.prob.h), frac(m.prob.d), frac(m.prob.a)];
      if (p.every((x) => x !== null)) {
        const o = [h > a, h === a, h < a].map(Number);
        brier += p.reduce((s, x, i) => s + (x - o[i]) ** 2, 0); brierN++;
      }
    }
    if (m.corners?.exp !== null && m.corners?.exp !== undefined && r.corners) errs.corners.push(r.corners[0] + r.corners[1] - m.corners.exp);
    if (m.cards?.exp !== null && m.cards?.exp !== undefined && r.yellow) errs.cards.push(r.yellow[0] + r.yellow[1] + (r.red ? r.red[0] + r.red[1] : 0) - m.cards.exp);
    for (const [src, t] of [['fő tipp', m.tip], ['szöglet', m.corners], ['lap', m.cards]]) {
      if (!t?.bet || Number(t.conf) === 0) continue;
      const out = evalBet(t.bet, r);
      if (!out) continue;
      const type = String(t.bet.type).toUpperCase();
      const odds = num(t.bet.odds);
      let prob = frac(t.bet.prob);
      if (prob === null && m.prob && src === 'fő tipp') {
        const P = { H: frac(m.prob.h), D: frac(m.prob.d), A: frac(m.prob.a) }, sel = String(t.bet.sel).toUpperCase();
        if (type === '1X2') prob = P[sel] ?? null;
        if (type === 'DC' && sel.length === 2) prob = [...sel].reduce((x, c) => x + (P[c === '1' ? 'H' : c === '2' ? 'A' : 'D'] ?? NaN), 0) || null;
      }
      add((byType[type] ||= agg()), out, prob, odds);
      add((byConf[`conf ${t.conf}`] ||= agg()), out, prob, odds);
      if (prob !== null && out !== 'void') add(calib[prob < 0.4 ? '<40%' : prob < 0.55 ? '40–55%' : prob < 0.7 ? '55–70%' : '70%+'], out, prob, odds);
      recent.push({ day: m.day, match: `${r.home} ${h}–${a} ${r.away}`, src, pick: t.pick || t.tip, out });
    }
  }
  // Szelvények
  const slipAgg = {};
  const slipRecent = [];
  const legAgg = agg(), legSeen = new Set();
  // azonos szelvény több napi futásban: csak egyszer számoljuk (nap + cím + tételek)
  const slipSeen = new Set();
  for (const s of slipList) {
    if (!s.legs?.length) continue;
    let state = 'won', odds = 1;
    for (const l of s.legs) {
      const fid = s.matchToFid[l.matchId];
      const out = evalBet(l.bet, fid && ledger.results[fid]);
      if (!out) { state = state === 'lost' ? 'lost' : 'pending'; continue; }
      const lk = `${fid}|${JSON.stringify(l.bet)}`;
      if (!legSeen.has(lk)) { legSeen.add(lk); add(legAgg, out, l.prob, l.odds); if (l.prob !== null && out !== 'void') add(calib[l.prob < 0.4 ? '<40%' : l.prob < 0.55 ? '40–55%' : l.prob < 0.7 ? '55–70%' : '70%+'], out, l.prob, l.odds); }
      if (out === 'lost') state = 'lost';
      if (out === 'won') odds *= l.odds || 1;
    }
    if (state === 'pending') continue;
    const sk = JSON.stringify(s.legs.map((l) => [s.matchToFid[l.matchId], l.bet]));
    if (slipSeen.has(sk)) continue; slipSeen.add(sk);
    const k = s.badge || s.title;
    const a = (slipAgg[k] ||= { n: 0, won: 0, stake: 0, ret: 0 });
    a.n++; a.stake++; if (state === 'won') { a.won++; a.ret += odds; }
    slipRecent.push({ day: s.day, title: s.title, out: state, odds: r2(odds) });
  }
  // Saját adatbázis a lejátszott meccsekből: csapatok és játékvezetők
  const teams = {}, refs = {};
  for (const r of Object.values(ledger.results)) {
    if (!FINISHED.has(r.status) || !r.corners) continue;
    const cards = r.yellow ? [r.yellow[0] + (r.red?.[0] || 0), r.yellow[1] + (r.red?.[1] || 0)] : null;
    [[r.home, 0], [r.away, 1]].forEach(([name, i]) => {
      const t = (teams[name] ||= { n: 0, gf: 0, ga: 0, cf: 0, ca: 0, cards: 0 });
      t.n++; t.gf += r.goals[i]; t.ga += r.goals[1 - i]; t.cf += r.corners[i]; t.ca += r.corners[1 - i]; if (cards) t.cards += cards[i];
    });
    if (r.referee && cards) {
      const name = r.referee.split(',')[0].trim();
      const f = (refs[name] ||= { n: 0, cards: 0 });
      f.n++; f.cards += cards[0] + cards[1];
    }
  }
  const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
  const mae = (a) => (a.length ? a.reduce((s, x) => s + Math.abs(x), 0) / a.length : null);
  const all = agg();
  for (const a of Object.values(byType)) { all.n += a.n; all.won += a.won; all.lost += a.lost; all.void += a.void; all.pSum += a.pSum; all.pN += a.pN; all.stake += a.stake; all.ret += a.ret; }
  const settled = Object.values(ledger.results).filter((r) => FINISHED.has(r.status)).length;
  return {
    updatedAt: new Date().toISOString(),
    firstDay: days[0]?.day || null,
    daysArchived: days.length,
    matchesSettled: settled,
    overall: fin(all),
    byType: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, { label: TYPE_HU[k] || k, ...fin(v) }])),
    byConf: Object.fromEntries(Object.entries(byConf).sort().map(([k, v]) => [k, fin(v)])),
    calibration: Object.fromEntries(Object.entries(calib).map(([k, v]) => [k, fin(v)])),
    brier1x2: brierN ? { n: brierN, score: r2(brier / brierN), note: 'Alacsonyabb = jobb; a 3 kimenetes véletlen tipp kb. 0,67.' } : null,
    corners: errs.corners.length ? { n: errs.corners.length, bias: r2(mean(errs.corners)), mae: r2(mae(errs.corners)), note: 'bias > 0: a valós szögletszám a becslés fölött volt (alábecsültük).' } : null,
    cards: errs.cards.length ? { n: errs.cards.length, bias: r2(mean(errs.cards)), mae: r2(mae(errs.cards)), note: 'bias > 0: a valós lapszám a becslés fölött volt (alábecsültük).' } : null,
    slipLegs: fin(legAgg),
    slips: Object.fromEntries(Object.entries(slipAgg).map(([k, v]) => [k, { n: v.n, won: v.won, roi: v.stake ? r2((v.ret - v.stake) / v.stake) : null }])),
    recentBets: recent.slice(-30).reverse(),
    recentSlips: slipRecent.slice(-10).reverse(),
    teams: Object.fromEntries(Object.entries(teams).sort((a, b) => b[1].n - a[1].n).slice(0, 120).map(([k, t]) => [k, { n: t.n, goalsFor: r2(t.gf / t.n), goalsAgainst: r2(t.ga / t.n), cornersFor: r2(t.cf / t.n), cornersAgainst: r2(t.ca / t.n), cards: r2(t.cards / t.n) }])),
    referees: Object.fromEntries(Object.entries(refs).sort((a, b) => b[1].n - a[1].n).slice(0, 80).map(([k, f]) => [k, { n: f.n, cardsPerMatch: r2(f.cards / f.n) }])),
    sampleWarning: all.n < 50 ? `Még csak ${all.n} kiértékelt tipp – a korrekciók kb. 50–100 tipp után megbízhatók.` : null,
  };
}
