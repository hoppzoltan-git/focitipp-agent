# Focitipp Agent

Focimeccs-elemző webapp: statisztika, csapathírek, kulcsjátékosok formája, pletykák, szöglet- és lapstatisztika, valamint a játékvezetők stílusa alapján ad tippeket bizalmi szinttel. A legerősebb tippek mindig felül vannak.

## Funkciók
- **Napi automatikus kutatás** (Vercel Cron, 15:00 UTC = 16:00 téli budapesti idő; nyári időszámításban 17:00): Claude webes kereséssel összegyűjti a következő ~30 óra legfontosabb meccseit, és meccsenként elemzést készít.
- **Frissítés most** gomb a kézi frissítéshez (2–4 perc).
- **Érték-kalkulátor**: az iroda oddsából várható értéket és negyed-Kelly tétméretet számol.
- **Kérdezd az agentet**: meccsenkénti kérdés-válasz.
- **Szelvényelemző**: képfeltöltés, a tételek összevetése az agent becsléseivel.
- Jelszavas védelem (HTTP Basic Auth).

## Felépítés
- `public/app.html` – a felület
- `app/api/data` – az adatok olvasása (Vercel Blob)
- `app/api/ask`, `app/api/slip` – elemzés az Anthropic API-val
- `app/api/refresh` (kézi) és `app/api/cron/refresh` (napi) – kutatás és írás
- `proxy.js` – jelszavas védelem

## Környezeti változók (Vercel → Project → Settings → Environment Variables)
| Név | Leírás |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic API-kulcs |
| `APP_PASSWORD` | Az oldal jelszava |
| `CRON_SECRET` | A napi futás védelme |
| `BLOB_READ_WRITE_TOKEN` | A Blob tárhely bekötésekor automatikusan jön létre |

## Fontos
A tippek valószínűségi becslések, nem biztos nyeremények. Csak 18 év felett, felelősen.
