# Hand-off: where TWCommute stands (2026-10-23)

This is the summary of the cloud session that built TWCommute so far, for continuing on a local machine. Start here, then read the docs it points to.

## What TWCommute is
A multilingual (繁體中文 / English / 日本語 / 한국어) transit planner for Taiwan: MRT, TRA, HSR, buses and YouBike. It started from your Gemini "Taiwan Transit App Market Research" doc.

**Your decisions:**
- an indie product with revenue;
- a cross-platform mobile app;
- TypeScript everywhere;
- all of Taiwan from day one, starting with one region at a time.

**What sets it apart** (docs/PRODUCT.md):
- **Multi-stop days:** add stops along the way, with how long you stay at each.
- **YouBike + transit:** one trip can mix both, with warnings for docks that may be empty or full, and a backup station.
- **TPASS coverage:** each option says whether your monthly pass covers it.
- **Live or Scheduled:** every time is labelled.
- **No ads, no account.**

## Code layout
A pnpm monorepo: Node 22, pnpm 10, turbo, biome, vitest. `pnpm check` runs lint, typecheck and tests.

**apps/ingest** polls TDX for bus ETAs, YouBike and TRA delays, and serves:
- GBFS (YouBike) and GTFS-RT (TRA delays) to OpenTripPlanner;
- live ETAs to the API;
- the GTFS download, repair and trim CLIs;
- the Phase 0 data-audit CLI.

**apps/api** (Fastify):
- `/v1/plan`: trips with stops run as chained OTP searches;
- `/v1/search`, `/v1/stops/nearby`, `/v1/stops/:id/departures`, `/v1/bikes`, `/v1/health`.

**apps/mobile** (Expo SDK 57, RN 0.86, Expo Router, MapLibre RN 11, TanStack Query, zustand, i18next):
- The server address is set in Settings → Server.
- Android allows plain http.
- `eas.json` has a `preview` profile that builds an APK.

**packages/**
- `contracts`: zod schemas;
- `tdx`: the TDX client, with OAuth, a 5-per-61-s rate limiter and retries;
- `fares`: TPASS passes and coverage;
- `i18n`: strings in 4 languages.

**infra/**
- OTP 2.10 config templates;
- `docker-compose.yml`;
- scripts: `fetch-data.sh`, `otp-local.sh`, `try-it.sh`, `build-graph.sh`;
- `smoke/run.sh`: an end-to-end test on a synthetic city.

**docs/**
- `PRODUCT.md`: why and what;
- `ARCHITECTURE.md`: how;
- `DATA.md`: every data finding and measurement;
- `TRY_IT.md`: the step-by-step setup guide.

## Data findings (details in docs/DATA.md)
- **TDX free plan:** 5 requests/minute. Production live data for all cities needs about 60/min, so a paid plan.
- **TDX's national GTFS:**
  - It had 7 kinds of errors that stop OTP; `prepare-otp` repairs them.
  - Its fare files (7 GB) are dropped.
  - 187,930 service ids collapse to 445 calendars.
  - Taipei Metro appears twice, so the national copy is dropped.
- **Live bus matching:**
  - Taipei and New Taipei ETA rows lack `SubRouteUID`. They're matched through route lists and a GTFS stop index: 72% join in Taipei, 81% in New Taipei.
  - Hsinchu, intercity, Taichung and Kaohsiung rows carry `SubRouteUID`.
- **Timetables miss buses that TDX tracks live,** so stop boards also show live predictions.
- **All of Taiwan:** the graph takes 17 minutes and 12 GB to build and 7.5–9.3 GB to serve.
- **Trips with stops:** chained searches take 2–5 s; a single OTP search with stops timed out.

## Try it on your own computer: `infra/scripts/try-it.sh hsinchu|taipei`
- **Regions** (see the table below). Each builds into `data/otp-<region>`, and the downloads are shared, so switching to an already-built region only restarts.

| Region | Area | Build | Running | Live data |
| --- | --- | --- | --- | --- |
| Hsinchu | box 120.85,24.67,121.11,24.885 | 57 s, 1.6 GB | ~1.2 GB | City + County buses, 41 intercity routes, YouBike, TRA delays: ~4.2 TDX requests/min |
| Greater Taipei | box 121.28,24.85,121.80,25.30 | ~5 min, 3.9 GB | ~3.5 GB | Taipei City buses and YouBike: ~2/min |

- **Trim rule:** whole trips with two or more stops in the box, or one for trains, so HSR Hsinchu keeps its trains.
- **Intercity:** `BUS_INTERCITY_ROUTES=auto` asks TDX only for the region's intercity routes.
- **Script behaviour:**
  - waits for YouBike data before starting OTP;
  - stops early when TDX rejects the key;
  - `status` shows each feed's age;
  - refuses to run as root.
- **Remote server** (your setup): set `API_HOST=127.0.0.1` in `.env`.
  - The API listens on the server only; OTP and ingest always do.
  - The Windows laptop runs `ssh -N -o ServerAliveInterval=30 -o ExitOnForwardFailure=yes -L 0.0.0.0:3000:127.0.0.1:3000 you@server`.
  - On the laptop: set the Wi-Fi to Private, or add a firewall rule for port 3000.
  - The phone uses `http://<laptop Wi-Fi IP>:3000`.
  - Tested with a local SSH server; the Windows side is untested.
- **Checked on real Hsinchu data on 2026-10-13:**
  - station → 清華大學 (bus 182, 藍線1區, 5608 or YouBike);
  - → 高鐵新竹站 (Liujia line);
  - 竹北 → 縣政府 (65A, live);
  - live stop boards.

## The Android app
- **The file:** `TWCommute-1.0.0.apk`, 25 MB, 64-bit, sha256 `80666e91…`, sent in the chat. It is signed with a debug key, which is fine for installing directly.
- **How it was built:** in the cloud sandbox, with R8 shrinking (no renaming; keep rules in `apps/mobile/app.json`) and compressed native libraries.
- **Not yet tried on a real phone.**
- **To rebuild locally:**
  - With EAS: `cd apps/mobile && npx eas-cli@latest build -p android --profile preview`. This needs a free Expo account, and `eas init` the first time.
  - Or with the Android SDK, NDK 27.1.12297006 and JDK 17 or 21: `npx expo prebuild -p android`, then `cd android && ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a`.
- **Sandbox-only workaround:** Maven Central returned 429 there, so a Gradle init script read it from Google's mirror. A normal machine shouldn't need this.

## Open items and next steps
1. **You:** set up the server per `docs/TRY_IT.md`, including the SSH tunnel section. Install the APK and report crashes or odd screens.
2. **TPASS:**
   - TRA and intercity legs show "may be covered"; they need a station-to-city mapping and train-class rules.
   - The pass rules are unverified (`verifiedAt: null`), including YouBike under 桃竹竹苗.
3. **TDX:**
   - Email tdx@motc.gov.tw to confirm the datasets are 免審核 (no review needed) and that the attribution wording is right.
   - A paid plan is needed for wider live coverage.
4. **App rough edges:**
   - The map starts on Taipei until the phone's location is known.
   - The server address is typed by hand.
   - The API has no auth.
   - A release build needs a real signing key (EAS).
5. **Untested:**
   - the docker-compose healthcheck (no Docker in the sandbox);
   - Hsinchu County's live-ETA coverage across a full day (65A was live at 06:47);
   - auto-start on reboot (not built; run `infra/scripts/try-it.sh` after a reboot).

## Repository state
- **Branch:** `claude/eager-lovelace-70z86n` on https://github.com/wislibot/TWCommute (public), at HEAD `6fecc88` plus this hand-off commit. Everything is pushed, and no pull request is open.
- **Not in git:**
  - `.env`, which holds the TDX key: never commit it;
  - `data/` (downloads, graphs, logs);
  - `apps/mobile/android/` (generated).

## Resume locally
```bash
git clone --branch claude/eager-lovelace-70z86n https://github.com/wislibot/TWCommute.git   # or: git pull
cd TWCommute && corepack enable && pnpm install && pnpm check
cp .env.example .env   # add TDX_CLIENT_ID / TDX_CLIENT_SECRET
```
Suggested first message to a local Claude Code session: "Read docs/HANDOFF.md, then help me with <next item>."
