// API-Football (api-sports.io) v3 – a napi kutatás pontos adatforrása.
const BASE = 'https://v3.football.api-sports.io';

// Sorozatok prioritás szerint: Bajnokok Ligája, Európa-liga, Konferencia-liga, Premier League, LaLiga
export const LEAGUES = [2, 3, 848, 39, 140];

// Napi keret: 100 kérés. Az API minden válaszban visszaküldi a napi maradékot;
// legalább RESERVE kérést mindig tartalékban hagyunk.
export const DAILY_LIMIT = 100;
const RESERVE = 5;
let used = 0;
let remaining = null;
export function requestsUsed() { return used; }
export function remainingToday() { return remaining; }
function canSpend(n = 1) { return remaining === null ? used + n <= DAILY_LIMIT - RESERVE : remaining - n >= RESERVE; }

export async function af(path, params = {}) {
  const key = process.env.API_FOOTBALL_KEY;
  if (!key) throw new Error('Az API_FOOTBALL_KEY nincs beállítva.');
  const qs = new URLSearchParams(params).toString();
  const free = path === '/status'; // a státuszlekérés nem számít bele a keretbe
  if (!free && !canSpend(1)) throw new Error('A napi API-Football keret elfogyott (tartalék megtartva).');
  if (!free) used++;
  const r = await fetch(`${BASE}${path}${qs ? '?' + qs : ''}`, { headers: { 'x-apisports-key': key }, cache: 'no-store' });
  const rem = Number(r.headers.get('x-ratelimit-requests-remaining'));
  if (!free && Number.isFinite(rem)) remaining = remaining === null ? rem : Math.min(remaining, rem);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`API-Football ${path}: HTTP ${r.status}`);
  const errs = j.errors && (Array.isArray(j.errors) ? j.errors : Object.values(j.errors));
  if (errs && errs.length) throw new Error(`API-Football ${path}: ${errs.join('; ')}`);
  return j;
}

export function budapestDate(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Budapest' });
}

const sumCards = (c) => {
  if (!c) return null;
  let t = 0;
  for (const v of Object.values(c)) t += Number(v?.total) || 0;
  return t;
};

function slimPrediction(p) {
  if (!p) return null;
  const side = (t) => t && {
    name: t.name,
    last5: t.last_5 && { form: t.last_5.form, att: t.last_5.att, def: t.last_5.def, goalsFor: t.last_5.goals?.for?.average, goalsAgainst: t.last_5.goals?.against?.average },
    seasonForm: t.league?.form,
    played: t.league?.fixtures?.played?.total,
    goalsForAvg: t.league?.goals?.for?.average?.total,
    goalsAgainstAvg: t.league?.goals?.against?.average?.total,
    yellowCardsTotal: sumCards(t.league?.cards?.yellow),
    redCardsTotal: sumCards(t.league?.cards?.red),
  };
  return {
    advice: p.predictions?.advice,
    winner: p.predictions?.winner?.name,
    percent: p.predictions?.percent,
    underOver: p.predictions?.under_over,
    goals: p.predictions?.goals,
    comparison: p.comparison,
    home: side(p.teams?.home),
    away: side(p.teams?.away),
    h2h: (p.h2h || []).slice(0, 5).map((f) => `${f.fixture?.date?.slice(0, 10)} ${f.teams?.home?.name} ${f.goals?.home}-${f.goals?.away} ${f.teams?.away?.name}`),
  };
}

const WANTED_BETS = /^(Match Winner|Goals Over\/Under|Both Teams Score|Double Chance|Corners Over Under|Total Corners|Cards Over\/Under|Total Cards|Asian Corners)/i;

function slimOdds(o) {
  const bm = o?.bookmakers?.[0];
  if (!bm) return null;
  return {
    bookmaker: bm.name,
    bets: (bm.bets || []).filter((b) => WANTED_BETS.test(b.name)).map((b) => ({ name: b.name, values: (b.values || []).slice(0, 12).map((v) => `${v.value}: ${v.odd}`) })),
  };
}

// Összegyűjti a mai és holnapi meccsek adatait a napi kereten belül.
// Kérések: 2 (meccslisták) + ceil(n/20) (sérültek, összevonva) + n (előrejelzés) + amennyi odds még belefér.
export async function collect({ maxFixtures = 40 } = {}) {
  used = 0;
  remaining = null;
  const statusRes = await af('/status').catch(() => null);
  const cur = statusRes?.response?.requests;
  if (cur && Number.isFinite(cur.limit_day) && Number.isFinite(cur.current)) remaining = cur.limit_day - cur.current;

  const days = [budapestDate(0), budapestDate(1)];
  const lists = [];
  for (const date of days) {
    lists.push(await af('/fixtures', { date, timezone: 'Europe/Budapest' }).catch((e) => ({ error: e.message, response: [] })));
  }
  const all = lists.flatMap((l) => l.response || []);
  let picked = all
    .filter((f) => LEAGUES.includes(f.league?.id) && ['NS', 'TBD'].includes(f.fixture?.status?.short))
    .sort((a, b) => LEAGUES.indexOf(a.league.id) - LEAGUES.indexOf(b.league.id) || String(a.fixture.date).localeCompare(String(b.fixture.date)))
    .slice(0, maxFixtures);

  // Annyi meccs, amennyinek az előrejelzése + a sérültlisták beleférnek a maradék keretbe.
  const budget = () => (remaining === null ? DAILY_LIMIT - RESERVE - used : remaining - RESERVE);
  while (picked.length && picked.length + Math.ceil(picked.length / 20) > budget()) picked = picked.slice(0, -1);
  const skipped = all.filter((f) => LEAGUES.includes(f.league?.id) && ['NS', 'TBD'].includes(f.fixture?.status?.short)).length - picked.length;

  // Sérültek/eltiltottak: 20 meccsenként egy kérés
  const injuries = {};
  for (let k = 0; k < picked.length; k += 20) {
    const ids = picked.slice(k, k + 20).map((f) => f.fixture.id).join('-');
    try {
      const r = await af('/injuries', { ids });
      for (const x of r.response || []) {
        const fid = x.fixture?.id;
        (injuries[fid] ||= []).push({ team: x.team?.name, player: x.player?.name, type: x.player?.type, reason: x.player?.reason });
      }
    } catch (e) { injuries._error = e.message; }
  }

  // Előrejelzés minden kiválasztott meccsre
  const preds = {};
  await Promise.all(picked.map(async (f) => {
    try { preds[f.fixture.id] = slimPrediction((await af('/predictions', { fixture: f.fixture.id })).response?.[0]); }
    catch (e) { preds[f.fixture.id] = { error: e.message }; }
  }));

  // Oddsok prioritás szerint, amíg a keret engedi
  const odds = {};
  for (const f of picked) {
    if (budget() < 1) break;
    try { odds[f.fixture.id] = slimOdds((await af('/odds', { fixture: f.fixture.id, bookmaker: 8 })).response?.[0]); }
    catch (e) { odds[f.fixture.id] = { error: e.message }; break; }
  }

  const fixtures = picked.map((f) => ({
    fixtureId: f.fixture.id,
    competition: `${f.league.name} (${f.league.country}) – ${f.league.round}`,
    kickoff: f.fixture.date,
    venue: [f.fixture.venue?.name, f.fixture.venue?.city].filter(Boolean).join(', '),
    referee: f.fixture.referee || null,
    home: f.teams.home.name,
    away: f.teams.away.name,
    prediction: preds[f.fixture.id] || null,
    injuries: injuries[f.fixture.id] || [],
    odds: odds[f.fixture.id] || null,
  }));

  return {
    generatedAt: new Date().toISOString(),
    dates: days,
    leagues: 'Bajnokok Ligája, Európa-liga, Konferencia-liga, Premier League, LaLiga',
    fixtureListErrors: lists.map((l) => l.error).filter(Boolean),
    injuriesError: injuries._error || null,
    fixturesSkippedForBudget: skipped,
    fixtures,
    requestsUsedThisRun: used,
    requestsRemainingToday: remaining,
  };
}
