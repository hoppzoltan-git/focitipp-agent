export const ANALYST = `Te egy óvatos, statisztikára építő focifogadási elemző vagy. Magyarul válaszolj.
Csak a kapott adatokra támaszkodj; a pletykákat (rumors) kisebb súllyal vedd figyelembe, mint a hivatalos híreket.
Ha valami nincs az adatokban, mondd ki, hogy nem tudod. Valószínűségekben gondolkodj, adj fair oddsot (100/valószínűség),
és jelezd a bizonytalanságot. Ne ígérj biztos nyereményt. Sima szöveget írj, Markdown-címsorok nélkül.`;

export function withStats(m, stats) {
  return { ...m, szoglet_lap_jatekvezeto: stats?.byId?.[m.id] || null };
}

export const FIXTURES_PROMPT = (now) => `Most ${now} van (Europe/Budapest).
Keresd meg a weben a következő kb. 30 óra legfontosabb focimeccseit: a mai nap hátralévő része és a holnapi nap, budapesti idő szerint.
Prioritás: Bajnokok Ligája, Európa-liga, Konferencia-liga, Premier League, La Liga, Serie A, Bundesliga, Ligue 1, NB I.
Legfeljebb 10 meccs; ha BL-forduló van, az legyen benne teljesen. Ha nincs meccs az ablakban, a következő meccsnapot vedd.
Válaszként CSAK egy JSON-objektumot adj, más szöveget ne:
{"title":"pl. Bajnokok Ligája · 6. forduló, szerda","subtitle":"1 mondat","matches":[{"id":"rovid-azonosito-kotojellel","comp":"sorozat magyarul","kickoff":"2026-11-25T21:00:00+01:00","home":"hazai csapat","away":"vendég csapat","venue":"stadion, város vagy üres"}]}`;

export const MATCH_PROMPT = (fx, now) => `Most ${now} van (Europe/Budapest). Kutasd fel a weben ezt a meccset, és készíts fogadási elemzést.
Meccs: ${fx.home} – ${fx.away} (${fx.comp}), kezdés: ${fx.kickoff}${fx.venue ? ', helyszín: ' + fx.venue : ''}.

Keress rá:
- hivatalos csapathírekre: sérültek, eltiltottak, kérdésesek, egy sárgára az eltiltástól (UEFA "predicted line-ups" cikkek, klubok oldalai, Sports Mole);
- a csapatok formájára, tabellahelyére, pontjaira, GY-D-V mérlegére;
- 3–7 kulcsjátékos formájára mindkét csapatból;
- pletykákra (várható kezdők, edzői helyzet) – ezeket külön kezeld;
- piaci oddsokra, ha találsz;
- a kijelölt játékvezetőre és stílusára (sárga/meccs, piros/meccs, 11-es/meccs, korábbi meccsei a csapatokkal);
- a csapatok szögletátlagaira (elvégzett szöglet/meccs, a meccseiken született összes szöglet hazai/idegen bontásban) és lapátlagaira.
Csak olyan tényt és játékosnevet írj, amit forrásban láttál. Semmit ne találj ki; ha nincs adat, írd, hogy nincs.

Tippek:
- prob: hazai/döntetlen/vendég esély %-ban (összeg kb. 100), a marzs nélkül normált piaci oddsból vagy saját becslésből; a forrást írd a probSource-ba.
- Fő tipp: 1X2, dupla esély, gólszám, mindkét csapat szerez gólt vagy kombináció, ahol a legjobb az ár-érték arány. conf: 3 = erős, 2 = közepes, 1 = gyenge, 0 = kihagyás ("Kihagyás – nincs egyértelmű érték"). Ha a piac drágábban árazza a favoritot, mint a becslésed, mondd ki.
- Szöglettipp: várható összes szöglet (exp) a hazai csapat hazai és a vendég idegenbeli meccseinek átlagából, korrigálva. Over/under egy vonalra vagy "X több szögletet végez el". Kis mintánál (4 meccs alatt) conf legfeljebb 2.
- Laptipp: várható összes lap főleg a játékvezető átlagából, a csapatok lapátlagából és a tétből. Ha a játékvezető nem megerősített vagy nincs adat, conf legfeljebb 1.

Válaszként CSAK egy JSON-objektumot adj, más szöveget ne:
{"match":{"id":"${fx.id}","comp":"${fx.comp}","kickoff":"${fx.kickoff}","venue":"...","home":{"name":"...","pos":szám vagy null,"pts":szám vagy null,"rec":"GY-D-V"},"away":{...},"prob":{"h":0,"d":0,"a":0},"probSource":"...","market":"piaci odds szövegesen vagy üres","news":["3–5 tényszerű mondat"],"players":[{"name":"...","team":"h vagy a","status":"játszik|kérdéses|kiesik|eltiltva","note":"..."}],"rumors":["..."],"tip":{"pick":"...","conf":0,"reason":"2–3 mondat"},"sources":[{"title":"...","url":"https://..."}]},
"stats":{"referee":{"name":"név (nemzetiség) vagy üres","status":"megerősített|nem megerősített|még nincs kijelölve","note":"..."},"corners":{"exp":0,"line":9.5,"note":"...","tip":"...","conf":0},"cards":{"exp":0,"line":4.5,"note":"...","tip":"...","conf":0}}}`;
