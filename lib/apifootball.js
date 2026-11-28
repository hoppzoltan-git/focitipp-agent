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
let minuteRemaining = null;
export const PER_CALL = 8; // a percenkénti 10-es korlát alatt maradunk
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
  const remH = r.headers.get('x-ratelimit-requests-remaining');
  if (!free && remH !== null && remH !== '' && Number.isFinite(Number(remH))) remaining = remaining === null ? Number(remH) : Math.min(remaining, Number(remH));
  const minH = r.headers.get('x-ratelimit-remaining');
  if (minH !== null && minH !== '' && Number.isFinite(Number(minH))) minuteRemaining = Number(minH);
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

const WANTED_BETS = /^(Match Winner|Goals Over\/Under|Both Teams Score|Double Chance|Corners Over Under|Cards Over\/Under)$/i;

function slimOdds(o) {
  const bm = o?.bookmakers?.[0];
  if (!bm) return null;
  return {
    bookmaker: bm.name,
    bets: (bm.bets || []).filter((b) => WANTED_BETS.test(b.name)).map((b) => ({ name: b.name, values: (b.values || []).slice(0, 12).map((v) => `${v.value}: ${v.odd}`) })),
  };
}

export function fixtureSummary(f) {
  return {
    fixtureId: f.fixture.id,
    competition: `${f.league.name} (${f.league.country}) – ${f.league.round}`,
    kickoff: f.fixture.date,
    venue: [f.fixture.venue?.name, f.fixture.venue?.city].filter(Boolean).join(', '),
    referee: f.fixture.referee || null,
    home: f.teams.home.name,
    away: f.teams.away.name,
  };
}

// Egy lépés a napi gyűjtésből. A state a Blobban él a hívások között.
// Minden hívás legfeljebb PER_CALL kérést küld; a napi keretből RESERVE-et megtart.
// Egy hívás elején: számlálók nullázása és a napi maradék lekérése (a /status ingyenes).
export async function beginBudget() {
  used = 0; remaining = null; minuteRemaining = null;
  const st = await af('/status').catch(() => null);
  const cur = st?.response?.requests;
  if (cur && Number.isFinite(cur.limit_day) && Number.isFinite(cur.current)) remaining = cur.limit_day - cur.current;
}
export const hasRoom = (perCall = PER_CALL) => used < perCall && canSpend(1) && (minuteRemaining === null || minuteRemaining > 1);

export async function step(state, { maxFixtures = 40 } = {}) {
  await beginBudget();
  const room = () => hasRoom();

  if (!state || state.stage === 'new') {
    state = { stage: 'list', startedAt: new Date().toISOString(), dates: [budapestDate(0), budapestDate(1)], listIdx: 0, raw: [], listErrors: [], queue: [], results: {}, injuries: {}, errors: [] };
  }

  // 1) Meccslisták (mai, holnapi)
  while (state.stage === 'list' && room()) {
    const date = state.dates[state.listIdx];
    try {
      const r = await af('/fixtures', { date, timezone: 'Europe/Budapest' });
      state.raw.push(...(r.response || []).filter((f) => LEAGUES.includes(f.league?.id) && ['NS', 'TBD'].includes(f.fixture?.status?.short)).map((f) => ({ ...fixtureSummaryWithLeague(f), qdate: date })));
    } catch (e) { state.listErrors.push(e.message); }
    state.listIdx++;
    if (state.listIdx >= state.dates.length) {
      state.raw.sort((a, b) => LEAGUES.indexOf(a.leagueId) - LEAGUES.indexOf(b.leagueId) || String(a.kickoff).localeCompare(String(b.kickoff)));
      const avail = (remaining === null ? DAILY_LIMIT - RESERVE - used : remaining - RESERVE);
      let n = Math.min(state.raw.length, maxFixtures);
      while (n > 0 && n + new Set(state.raw.slice(0, n).map((f) => `${f.leagueId}|${f.qdate}`)).size > avail) n--;
      state.skipped = state.raw.length - n;
      state.fixtures = state.raw.slice(0, n);
      delete state.raw;
      const ids = state.fixtures.map((f) => f.fixtureId);
      // Sérültek: sorozatonként és naponként egy kérés (az ingyenes csomag nem engedi az összevont ids-t)
      const groups = new Map();
      for (const f of state.fixtures) groups.set(`${f.leagueId}|${f.season}|${f.qdate}`, { league: f.leagueId, season: f.season, date: f.qdate });
      for (const g of groups.values()) state.queue.push({ t: 'inj', ...g });
      for (const id of ids) state.queue.push({ t: 'pred', id });
      for (const id of ids) state.queue.push({ t: 'odds', id });
      state.stage = 'detail';
    }
  }

  // 2) Részletek: sérültek (összevonva) → előrejelzések → oddsok
  while (state.stage === 'detail' && state.queue.length && room()) {
    const job = state.queue.shift();
    try {
      if (job.t === 'inj') {
        const r = await af('/injuries', { league: job.league, season: job.season, date: job.date, timezone: 'Europe/Budapest' });
        for (const x of r.response || []) (state.injuries[x.fixture?.id] ||= []).push({ team: x.team?.name, player: x.player?.name, type: x.player?.type, reason: x.player?.reason });
      } else if (job.t === 'pred') {
        (state.results[job.id] ||= {}).prediction = slimPrediction((await af('/predictions', { fixture: job.id })).response?.[0]);
      } else {
        (state.results[job.id] ||= {}).odds = slimOdds((await af('/odds', { fixture: job.id, bookmaker: 8 })).response?.[0]);
      }
    } catch (e) {
      if (/rateLimit|Too many/i.test(e.message)) { state.queue.unshift(job); break; }
      state.errors.push(`${job.t} ${job.id || ''}: ${e.message}`);
      if (/keret elfogyott|request limit/i.test(e.message)) { state.queue = []; break; }
    }
  }
  // Ha a napi keret elfogyott, az oddsokat elengedjük
  if (state.stage === 'detail' && state.queue.length && !canSpend(1)) {
    state.errors.push(`A napi keret miatt ${state.queue.length} lekérés kimaradt (főleg oddsok).`);
    state.queue = [];
  }
  if (state.stage === 'detail' && !state.queue.length) state.stage = 'done';

  const done = state.stage === 'done';
  return {
    state,
    done,
    usedThisCall: used,
    remainingToday: remaining,
    pendingRequests: state.stage === 'list' ? 'meccslista' : state.queue.length,
    data: done ? {
      generatedAt: new Date().toISOString(),
      dates: state.dates,
      leagues: 'Bajnokok Ligája, Európa-liga, Konferencia-liga, Premier League, LaLiga',
      fixtureListErrors: state.listErrors,
      fixturesSkippedForBudget: state.skipped || 0,
      errors: state.errors,
      fixtures: (state.fixtures || []).map(({ qdate, season, leagueId, ...f }) => ({ ...f, injuries: state.injuries[f.fixtureId] || [], prediction: state.results[f.fixtureId]?.prediction || null, odds: state.results[f.fixtureId]?.odds || null })),
      requestsRemainingToday: remaining,
    } : null,
  };
}

function fixtureSummaryWithLeague(f) { return { ...fixtureSummary(f), leagueId: f.league.id, season: f.league.season }; }
