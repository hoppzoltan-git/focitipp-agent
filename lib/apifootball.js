// API-Football (api-sports.io) v3 – a napi kutatás pontos adatforrása.
const BASE = 'https://v3.football.api-sports.io';

// Sorozatok prioritás szerint: BL, EL, KL, PL, La Liga, Serie A, Bundesliga, Ligue 1, NB I
export const LEAGUES = [2, 3, 848, 39, 140, 135, 78, 61, 271];

let used = 0;
export function requestsUsed() { return used; }

export async function af(path, params = {}) {
  const key = process.env.API_FOOTBALL_KEY;
  if (!key) throw new Error('Az API_FOOTBALL_KEY nincs beállítva.');
  const qs = new URLSearchParams(params).toString();
  used++;
  const r = await fetch(`${BASE}${path}${qs ? '?' + qs : ''}`, { headers: { 'x-apisports-key': key }, cache: 'no-store' });
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

// Összegyűjti a mai és holnapi fontos meccsek adatait (kb. 3 kérés/meccs + 2).
export async function collect({ maxFixtures = 12 } = {}) {
  used = 0;
  const days = [budapestDate(0), budapestDate(1)];
  const lists = await Promise.all(days.map((date) => af('/fixtures', { date, timezone: 'Europe/Budapest' }).catch((e) => ({ error: e.message, response: [] }))));
  const all = lists.flatMap((l) => l.response || []);
  const picked = all
    .filter((f) => LEAGUES.includes(f.league?.id) && ['NS', 'TBD'].includes(f.fixture?.status?.short))
    .sort((a, b) => LEAGUES.indexOf(a.league.id) - LEAGUES.indexOf(b.league.id) || String(a.fixture.date).localeCompare(String(b.fixture.date)))
    .slice(0, maxFixtures);

  const fixtures = await Promise.all(picked.map(async (f) => {
    const id = f.fixture.id;
    const [pred, inj, odds] = await Promise.allSettled([
      af('/predictions', { fixture: id }),
      af('/injuries', { fixture: id }),
      af('/odds', { fixture: id, bookmaker: 8 }),
    ]);
    const val = (r) => (r.status === 'fulfilled' ? r.value : { error: r.reason?.message });
    const p = val(pred), i = val(inj), o = val(odds);
    return {
      fixtureId: id,
      competition: `${f.league.name} (${f.league.country}) – ${f.league.round}`,
      kickoff: f.fixture.date,
      venue: [f.fixture.venue?.name, f.fixture.venue?.city].filter(Boolean).join(', '),
      referee: f.fixture.referee || null,
      home: f.teams.home.name,
      away: f.teams.away.name,
      prediction: p.error ? { error: p.error } : slimPrediction(p.response?.[0]),
      injuries: i.error ? { error: i.error } : (i.response || []).map((x) => ({ team: x.team?.name, player: x.player?.name, type: x.player?.type, reason: x.player?.reason })),
      odds: o.error ? { error: o.error } : slimOdds(o.response?.[0]),
    };
  }));

  return {
    generatedAt: new Date().toISOString(),
    dates: days,
    fixtureListErrors: lists.map((l) => l.error).filter(Boolean),
    totalFixturesFound: all.length,
    fixtures,
    requestsUsed: used,
  };
}
