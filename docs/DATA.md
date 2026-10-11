# Data sources and the Phase 0 audit

The first audit against live TDX data ran on 2026-10-11 (results below). Re-run it with `pnpm --filter @twc/ingest audit` whenever TDX changes its feeds.

## Sources

| Data | Source | Notes |
| --- | --- | --- |
| GTFS static (bus, TRA, THSR, metros, ferries, domestic flights) | TDX `GET https://tdx.transportdata.tw/api/gtfs/V3/Map/GTFS/Static` | Beta, free, updated daily. |
| Taipei Metro GTFS | TDX `…/V3/Map/GTFS/Static/Rail/TRTC` | Produced by Taipei Metro separately. |
| Bus ETAs (N1) | TDX `/v2/Bus/EstimatedTimeOfArrival/City/{City}` and `/InterCity` | `$select` keeps payloads small. |
| YouBike stations / availability | TDX `/v2/Bike/Station/City/{City}`, `/v2/Bike/Availability/City/{City}` | 15 cities; `ServiceType` 1/2/3 = YouBike 1.0/2.0/Moovo. |
| TRA live delays | TDX `/v2/Rail/TRA/LiveTrainDelay` | Minutes late at the last station passed. |
| Streets | OpenStreetMap via Geofabrik `asia/taiwan-latest.osm.pbf` | ODbL; attribution required. |
| Map tiles | OpenFreeMap (`EXPO_PUBLIC_MAP_STYLE_URL`) | OSM-based; attribution shown on the map. |

TDX GTFS-Realtime is documented but its delivery is "in progress" (TDX GTFS docs, 資料更新與上架), which is why live data comes from the native APIs above.

## License (TDX 資料授權利用條款, 2023-10-26)

- **No-review data (免審核提供資料)** may be used for any purpose, including commercial products, redistributed and sublicensed (§4-1). Access is paid per the TDX fee rules (收費要點); there is no royalty.
- **Review-required data (需審核提供資料)** needs the source's approval first (§4-2). Phase 0 checks each dataset we use.
- **Attribution is mandatory** (§5-2): show 「交通部運輸資料流通服務平臺」 (or the source agency) clearly. Without it, use counts as unlicensed. Implemented in `apps/mobile/src/components/data-credit.tsx` and the `settings.dataSource` string.
- **Follow platform access rules** (§5-1), or access can be revoked.
- **No warranty, and we indemnify MOTC** for losses caused by our intent or negligence (§7). Our own Terms of Use must disclaim accuracy to our users.
- Trademarks are not licensed (§4-1): no YouBike / Taipei Metro / MOTC logos, and no implied endorsement.

## Phase 0 checklist

Run `pnpm --filter @twc/ingest audit` with real credentials: it measures items 1, 4, 5 and 6 below and writes `data/audit/report.md`. Then record results here.

1. **Download and inspect GTFS.** Run `pnpm --filter @twc/ingest fetch-gtfs`, read `data/gtfs/manifest.json`: is the national file one feed or a zip of zips? Then run `prepare-otp`: which feed ids come out, and is the TRA feed detected?
2. **Validate GTFS** with the MobilityData validator. Note errors that block OTP (missing `stop_times`, `frequencies.txt` use for buses, calendar coverage).
3. **Build the graph.** First a Greater Taipei extract (`BBOX=121.28,24.85,121.80,25.30 infra/scripts/fetch-data.sh`), then all of Taiwan on a 32 GB machine. Record memory and time.
4. **Check id mapping assumptions** (code depends on these):
   - Bus `stop_id` = TDX `StopUID`; `route_id` = `<SubRouteUID>_<Direction>` (`apps/api/src/lib/ids.ts`, `apps/api/src/plan/live-overlay.ts`). Measure: % of ETA rows the lookup can join.
   - TDX city codes prefix bus `stop_id`s (`TPE…`, `NWT…`) (`packages/fares/src/cities.ts`). Measure: % of TPASS results that are `unknown`.
   - TRA train number from `trip_short_name`, else from `route_id` (`TRA_<trainNo>_…`); one trip per service date; stations `TRA_<StationID>` (`apps/ingest/src/gtfs/tra-index.ts`). Ingest logs matched vs unmatched delays every poll.
   - OTP `vehicleRentalStation.stationId` carries the TDX `StationUID` (used for TPASS city lookup).
5. **Live data quality per city:** ETA freshness (`SrcUpdateTime` lag), share of stops with predictions, ghost buses.
6. **TDX plan and terms:** the free plan allows 5 requests/minute (measured). All cities (23 bus feeds every 30 s + 15 bike cities every 60 s + TRA every 60 s) need ≈ 62 requests/minute ≈ 2.7M calls/month. Reduce with `BUS_CITIES` / intervals if needed, and check the streaming ETA endpoints. Confirm commercial-use and attribution wording, and apply for the academic/public-interest discount if eligible.
7. **License class:** confirm every dataset we use is marked 免審核 in its TDX metadata (詮釋資料); email tdx@motc.gov.tw to confirm the attribution wording.
8. **TPASS data:** verify every pass in `packages/fares/src/tpass.ts` against official pages and set `verifiedAt`.

## Results

### Run 1 — 2026-10-11 17:37 UTC (01:37 Taipei, buses not running)

Audited Taipei, New Taipei, Taichung, Kaohsiung and intercity buses; raw report in `data/audit/report.md`.

**GTFS**
- The national download (`/V3/Map/GTFS/Static`) is **one flat feed of 466 MB**, not a zip of zips: 397 agencies, 10,005 routes (bus 8,625 · rail 1,279 · metro 49 · ferry 49 · air 3), 196,658 trips, 163,150 stops. `stop_times.txt` is 370 MB uncompressed; calendar 2026-10-01 → 2026-12-31.
- It also carries **~7 GB of fare tables** (`fare_leg_rules.txt` 3.8 GB, `fare_products.txt` 2.9 GB). `prepare-otp` now drops all fare files before OTP builds; TPASS coverage is ours.
- 7,218 `frequencies.txt` rows (headway-based trips). Translations: English only (no Japanese/Korean names), which matches our display rules.
- Taipei Metro comes as a separate 1 MB feed (`trtc`, 727 stops such as `BL01_UP`).

**Bus ids** (live-ETA overlay)
- `stop_id` = TDX `StopUID` for **100%** of stops in all five areas. ✅
- `route_id` is **`<SubRouteUID>_<Direction>`** (`TPE104710_0` for route `TPE10471`, sub-route `TPE104710`), not `RouteUID` (0% exact matches). The overlay assumed `RouteUID` and would never have attached an ETA. **Fixed:** `tdxRouteKey()` parses the key, and the ingest lookup matches sub-route + direction.
- City codes prefix 83.4% of all stop_ids. The rest are rail, air and ferry stops and intercity (`THB…`) stops, which TPASS reports as "unknown".

**TRA**
- Agency `TRA` (交通部臺灣鐵路管理局). There is **no `trip_short_name`**: the train number is in `route_id` (`TRA_1004_0_1132` = train 1004), and trips are **one per service date** (`…_20261011_102700`). Stops are `TRA_<StationID>`.
- The mapper indexed 0 trains, so all 51 live delays were unmatched. **Fixed:** train numbers are parsed from route ids, the trip for the current service day is chosen (yesterday's before 04:00 for overnight trains), and only `TRA_` stops are indexed, so 4-digit bus stop suffixes can't collide.

**YouBike** (Taipei, New Taipei, Taichung, Kaohsiung)
- 6,785 stations, all YouBike 2.0, **100% joined** with availability, with e-bike counts on every row. Data is ~60 s old. At night 1.5–4.7% of active stations had no bikes and 0.3–3.0% had no docks.

**Bus ETAs**
- Data was 7–32 s old (intercity up to 93 min old for some rows). Almost no rows had an estimate because no buses were running (StopStatus 3 "last bus passed" / 4 "not operating today"). **Re-measure in daytime.**

**TDX plan** ❗
- Response headers: `ratelimit-limit: 5`, `x-ratelimit-limit-minute: 5`, i.e. the free member plan allows **5 requests per minute**. Polling every city every 30–60 s needs about **60 requests/minute**, so production requires a paid plan. Ingest defaults now fit the free plan: Taipei only, about 2 requests/minute. It warns at startup when the configured polling exceeds `TDX_RATE_PER_MINUTE`.

### Runs 2–3 — after the fixes (same night)

| Check | Run 1 | After fixes |
| --- | --- | --- |
| Sub-routes whose `<SubRouteUID>_<Direction>` is a GTFS route_id | — | **100%** in all five areas |
| Live ETA rows the lookup can join: Taichung, Kaohsiung, intercity | 0% | **100%** |
| Same: Taipei, New Taipei (their ETA rows carry no `SubRouteUID`; joined through TDX route lists) | 0% | 28% → **100%** |
| TRA live delays mapped to GTFS trips and stops | 0 / 51 | **50 / 50**; 1,010 trains, 245 stations, every TDX station mapped |
