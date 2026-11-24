# Focitipp Agent

Focimeccs-elemző oldal: statisztika, csapathírek, kulcsjátékosok formája, pletykák, szöglet- és lapstatisztika, valamint a játékvezetők stílusa alapján ad tippeket bizalmi szinttel. A legerősebb tippek mindig felül vannak.

## Hogyan működik
- A kutatást minden nap kb. 16:00-kor (Europe/Budapest) egy Claude ütemezett feladat végzi, és az eredményt a `public/data/current.json` és `public/data/stats.json` fájlokba írja ebben a repóban.
- Minden feltöltés után a Vercel automatikusan újratelepíti az oldalt, így megjelennek a friss tippek.
- Nincs szükség Anthropic API-kreditre.
- Pontos adatforrás: API-Football (api-sports.io). A `/api/football-data?key=<DATA_KEY>` végpont a mai és holnapi fontos meccsekhez lekéri a kijelölt játékvezetőt, a sérülteket/eltiltottakat, a modell-esélyeket, a formát és az oddsokat (6 órás gyorsítótárral, a napi 100 kéréses keret kímélésére). Sorozatok: BL, EL, KL, Premier League, LaLiga. A kód a válaszokban kapott napi maradékot figyeli, és 5 kérést mindig tartalékban hagy. A napi Claude-feladat ezt használja.

## Felépítés
- `public/app.html` – a felület (érték-kalkulátorral)
- `public/data/*.json` – a napi adatok
- `proxy.js` – jelszavas védelem (HTTP Basic Auth)
- `lib/apifootball.js`, `app/api/football-data` – API-Football adatgyűjtés

## Környezeti változók (Vercel)
| Név | Leírás |
|---|---|
| `APP_PASSWORD` | Az oldal jelszava (a felhasználónév bármi lehet) |
| `API_FOOTBALL_KEY` | API-Football kulcs |
| `DATA_KEY` | A `/api/football-data` végpont védelme |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob (gyorsítótár) – automatikus |

A szelvényelemző és a meccsenkénti kérdés a Claude-os változatban érhető el.

## Fontos
A tippek valószínűségi becslések, nem biztos nyeremények. Csak 18 év felett, felelősen.
