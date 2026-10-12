# TWCommute

A multilingual (繁體中文 / English / 日本語 / 한국어) transit planner for Taiwan, covering MRT, TRA, buses and YouBike. What sets it apart:

- **Multi-stop transit days:** add stops along the way with how long you'll stay at each.
- **YouBike + transit in one trip,** with warnings when the pickup or drop-off dock is likely empty or full, plus a backup station.
- **TPASS-aware:** each route says whether your monthly pass covers it.
- **Honest live data:** every time is labeled *Live* or *Scheduled*. No ads, no account.

Status: **Phase 1**. The backend runs on live TDX data (all of Taiwan on a 16 GB machine; Hsinchu or Greater Taipei on 8 GB); results are in [docs/DATA.md](docs/DATA.md). The Android app builds; it has not yet been tried on a phone. **To try it on an Android phone, follow [docs/TRY_IT.md](docs/TRY_IT.md).** Read [docs/PRODUCT.md](docs/PRODUCT.md) for why and what, and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how.

## Repository

```
apps/
  ingest/    TDX polling → GBFS + GTFS-RT for OTP, live ETAs for the API; GTFS download/prep CLIs
  api/       Public API (Fastify): plan, search, stops, bikes, health
  mobile/    Expo SDK 57 app (Expo Router, MapLibre, TanStack Query, i18next)
packages/
  contracts/ zod request/response schemas shared by api and mobile
  tdx/       TDX client: OAuth token cache, rate limiter, retries, typed endpoints
  fares/     TPASS passes and coverage evaluator
  i18n/      UI strings in 4 languages + stop-name display rules
infra/
  otp/       OpenTripPlanner 2.10 config templates and GraphQL schema
  docker-compose.yml, scripts/  stack and data/graph build scripts
```

## Develop

Requires Node 22+ and pnpm 10 (`corepack enable`).

```bash
pnpm install
pnpm check          # biome lint + typecheck + tests across the workspace
```

### Backend with real data

1. Register at [TDX](https://tdx.transportdata.tw/register) and create an API key.
2. `cp .env.example .env` and fill in `TDX_CLIENT_ID` / `TDX_CLIENT_SECRET`.
3. `infra/scripts/fetch-data.sh` downloads GTFS and OSM into `data/`. `prepare-otp` repairs GTFS data errors that would abort OTP's build (see `docs/DATA.md`). For a smaller region set `BBOX` (clips the map) and `GTFS_BBOX` (keeps the trips with two or more stops in the box, or one for trains); `OTP_DIR` lays the region out in its own folder, `SKIP_DOWNLOAD=1` reuses earlier downloads, and `OSM_URL` uses your own Taiwan extract.
4. `infra/scripts/build-graph.sh` builds the OTP graph.
5. `docker compose -f infra/docker-compose.yml up -d`. The API is then on `:3000`, OTP on `:8080` (debug UI), ingest on `:8081`.

For one region (Hsinchu or Greater Taipei) on one 8 GB Linux machine without Docker, `infra/scripts/try-it.sh hsinchu` (or `taipei`) does all of this (see [docs/TRY_IT.md](docs/TRY_IT.md)).

### Without Docker

OpenTripPlanner 2.10 runs from its jar with Java 25+: `OTP_JAR=… JAVA=… infra/scripts/otp-local.sh build|serve`.

### End-to-end smoke test

`infra/smoke/run.sh` builds a synthetic city (street grid, one bus line, two YouBike docks), builds and serves it with the real OpenTripPlanner, runs the API against it with a fixture ingest server, and checks: GBFS docks load in OTP, multi-stop plans keep the requested stay, bike legs carry dock risk, and search/nearby/departures work. No TDX or OSM download needed; CI runs it on every push.

### Phase 0 audit

`pnpm --filter @twc/ingest audit` downloads GTFS (if needed), queries TDX for a few cities and writes `data/audit/report.md`, which measures every data assumption listed in [docs/DATA.md](docs/DATA.md).

### Mobile app

```bash
cd apps/mobile
EXPO_PUBLIC_API_URL=http://<your-machine-ip>:3000 npx expo run:android   # or run:ios on macOS
```

MapLibre is a native module, so use a development build (`npx expo run:*` or `eas build --profile development`), not Expo Go. `eas build -p android --profile preview` builds an installable APK. The server address can also be set in the app under Settings → Server; Android builds allow plain `http://` so a computer on the home network works.

## Data and attribution

Transit data source: **交通部運輸資料流通服務平臺** (Ministry of Transportation and Communications, [Transport Data eXchange](https://tdx.transportdata.tw/)). The TDX data license (資料授權利用條款 §5-2) requires this exact source name wherever the data is shown; the app displays it on results, itineraries, departure boards and in Settings. Street data and map tiles: © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors ([OpenFreeMap](https://openfreemap.org/)). Routing: [OpenTripPlanner](https://www.opentripplanner.org/).
