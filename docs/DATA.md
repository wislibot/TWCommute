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
| Streets | OpenStreetMap: Geofabrik `asia/taiwan-latest.osm.pbf`, or the openstreetmap.fr Asia file cut to `infra/osm/taiwan.geojson` (Taiwan, Penghu, Kinmen, Matsu) when Geofabrik is unreachable | ODbL; attribution required. `infra/scripts/fetch-data.sh` picks the source. |
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
3. **Build the graph.** ✅ All of Taiwan builds in 17 min with 12 GB of memory (results below). A Greater Taipei extract (`BBOX=121.28,24.85,121.80,25.30 infra/scripts/fetch-data.sh`) is still handy for development.
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

### Graph build — 2026-10-12 (full Taiwan, OTP 2.10, 12 GB heap)

**GTFS data errors.** OTP stops the whole build on the first bad row, and the TDX national feed had seven kinds of them (the TRTC feed had none), plus one shape OTP cannot build in reasonable time. `prepare-otp` now repairs them and logs each repair (`apps/ingest/src/gtfs/repair.ts`):

| Problem in the TDX feed (2026-10-11 download) | Rows | OTP without the repair | Repair |
| --- | --- | --- | --- |
| `levels.txt` ids 573904/573905 listed twice (identical rows) | 2 | `DuplicateEntityException` | remove the repeats |
| `stops.txt` `level_id` not in `levels.txt` (e.g. 573819) | 90 | `EntityReferenceNotFoundException` | clear `level_id` |
| `pathways.txt` from/to a stop that does not exist (e.g. 541831009) | 89 | reference error | remove the pathway |
| `pathways.txt` 6670 starts at a station (`location_type` 1), which GTFS forbids | 1 | `NullPointerException` in `PathwayMapper` | remove the pathway |
| `pathways.txt` from a stop to itself (e.g. elevator 7156 at stop 508639013) | 5 | the build succeeds, but both ends of the elevator get the same vertex label and the saved graph fails to load (`NullPointerException` in `SerializedGraphObject.reconstructEdgeLists`) | remove the pathway |
| `trips.txt` on routes missing from `routes.txt` (`SHIP_NewTaipei_HalohaR101_0/1`) | 4 trips, 8 stop times | reference error | remove the trips and their stop times |
| `stop_times.txt` Matsu buses with `departure_time` `15:15` instead of `15:15:00` (one-stop trips) | 104 | time parse error | complete to `HH:MM:00` |
| A `service_id` per trip: 187,930 ids for only 445 distinct calendars | 187,485 merged | not an error, but OTP 2.10 copies its service map for each id (`TripCalendars.withServiceCode`); the build sat there for 20+ minutes without finishing | give ids with identical `calendar.txt` and `calendar_dates.txt` rows one id (each trip keeps its dates) |

Not repaired, as OTP tolerates them: 8 trips whose `shape_id` (`NTMC_LB01_LB12_0`, `NTMC_LB12_LB01_1`) is not in `shapes.txt`, and `is_bidirectional` values 2, 4 and 11 in a few pathways.

**Build and serve** (4 CPUs, 16 GB RAM, `OTP_HEAP=12g` for builds, `10g` to serve)

| Step | Time | Peak memory | Output |
| --- | --- | --- | --- |
| `prepare-otp` (fare files dropped, repairs above) | ~1 min | — | `tw.gtfs.zip` 88.5 MB, `trtc.gtfs.zip` 1.2 MB |
| Street graph from OSM (`otp-local.sh street`) | 4 min | 11.2 GB | `streetGraph.obj` 245 MB; 1.45M vertices, 3.74M edges |
| Transit on top (`otp-local.sh transit`) | 15 min | 11.1 GB | `graph.obj` 1.6 GB; 156,586 stops, 7,974 patterns |
| One-step build (`build`) | 17 min | 12.0 GB | same graph |
| OTP serve: load the graph and start updaters | 50–96 s | 7.5–9.3 GB resident | |
| Ingest start: read the national GTFS, TRA stop patterns | ~45 s | 1.7 GB resident | 1,010 trains, 245 stations, 53,467 TRA trips with stop patterns |

All of Taiwan builds on a 16 GB machine; the street graph only changes with OSM, so nightly GTFS updates need only the 15-minute transit step.

### Real stack — 2026-10-12 11:15–11:40 Taipei (Monday)

Real ingest (TDX free plan, Taipei, ≈2 calls/minute), OTP with the full-Taiwan graph, API; `/v1/*` calls.

| Check | Result |
| --- | --- |
| YouBike docks in OTP (GBFS from ingest) | ✅ **1,815** Taipei YouBike 2.0 stations; `/v1/bikes` returns 1,604 in a central Taipei box |
| TRA delays (GTFS-RT from ingest) | ✅ ~145 of ~150 running trains matched each poll, ~30 of them via the next stop (express passing the reported station); 5 trains not in today's GTFS. In OTP, 8 of 8 sampled delayed trips show the delay (`UPDATED`) at the reported stop and at their last stop |
| Taipei Main Station → Tamsui | ✅ 48–49 min by metro, 2.3–3 s per plan |
| YouBike trip (City Hall → NTU) | ✅ 5 of 5 itineraries use YouBike; dock risk on bike legs; bus 284 legs carry the live TDX ETA (`eta=305s`) |
| Departures at the Taipei Main Station (忠孝) bus stops | ✅ live TDX ETAs on 4 of 5 boards (e.g. 262 in 47 s, 218 in 12 min), 20–40 ms per board |
| Search 「台北車站」 | ✅ the metro station first |
| Taipei Main → Tamsui, 90 min near Dihua St (via) | ❌ **18–24 s** per plan on the full graph (vs 2–5 s without a via), so OTP's 7 s limit returns nothing. Results are right when given time (bus to Dihua St, ~90 min there, bus/metro on). Same with a stop via or a 20-minute search window |
| Duplicates | ❌ Taipei Metro is in both feeds (`trtc` and agency `TRTC` in the national feed), so every metro trip comes back twice |

Fixed the same day, and re-checked on the real stack at 11:45:

| Check | Result |
| --- | --- |
| Taipei Main → Tamsui, 90 min near Dihua St | ✅ **4.8 s**, 5 options: YouBike to Dihua St, stays of 95–131 min (the next departures after the stay), YouBike + metro to Tamsui. The API now plans one plain OTP search per segment and joins them (`apps/api/src/plan/chain.ts`) |
| Same with a second stop, Dadaocheng Wharf for 30 min, walking only | ✅ 2.5 s, 5 options, stays 90 and 35–62 min |
| Duplicates | ✅ `prepare-otp` leaves out agency `TRTC` from the national feed (24 routes, 4,789 trips, 121 stops); Taipei Metro trips now come once, from Taipei Metro's own feed, with TPASS coverage on every option |

### Bus ETAs in daytime — 2026-10-12 12:20–12:40 Taipei (Monday)

`AUDIT_CITIES=Taipei,NewTaipei pnpm --filter @twc/ingest audit` (15 TDX calls, all 200):

| | Taipei | New Taipei | Intercity |
| --- | --- | --- | --- |
| ETA rows (one per stop, route, direction) | 28,811 | 32,961 | 59,741 |
| With an estimate | 68.6% | 64.1% | 15.5% |
| Data age (p50 / p90) | 9 s / 9 s | 7 s / 7 s | 18 s / 18 s (max ~2 h) |
| Rows the live lookup can join, route-level rule only | 64.4% | 75.9% | 100% |
| … with the GTFS stop index (variant serving the stop) | **71.9%** | **80.8%** | 100% |

Taipei and New Taipei rows name only their route. A route often has several variants (685 and 685經吉林); attaching a route's ETA to the wrong variant would send riders the wrong way, so a row is joined only when one variant serves its stop (from GTFS stop_times), or, for a trip leg, when every variant serving the stop also stops where the rider gets off. Of Taipei's unjoined rows, 15.7 points are stops no GTFS trip serves (they cannot appear in a plan or board anyway) and 12.4 points are stops shared by several variants.

On trip legs (12 bus-only plans across Taipei, 64 distinct bus legs leaving within 45 minutes): 17 carry a live ETA. Of the rest, 31 board a later bus than the next one (TDX only predicts the next bus, so those stay scheduled by design), 7 are intercity or New Taipei routes (not polled on the free plan), 5 are buses that have not left their terminal (no estimate), and 4 are still ambiguous variants. So when the leg is the next bus of a polled route, about 80% show live data.

Ingest now also indexes bus stops from the GTFS at start-up: ~95 s and 2.0 GB resident (was ~45 s and 1.7 GB); 109,123 bus stops.

**Timetables vs live buses (boards).** TDX's Taipei bus timetables miss buses that TDX's live data tracks. At Taipei Main Station (忠孝) on 2026-10-12 at 20:05, route 253's next timetabled trip was 21:18 while TDX predicted a bus in 5 minutes; route 247's was 21:09 against a prediction of 31 minutes. Stop boards therefore show a live prediction within the board's hour for any bus route without a timetabled departure in that hour (also covering the 219 headway-only routes, which OTP lists no stop times for), and show up to 20 departures instead of 3.

### Greater Taipei on an 8 GB machine — 2026-10-12 21:30–22:00 Taipei (Monday)

All of Taiwan needs a 16 GB machine, so `infra/scripts/try-taipei.sh` (now `try-it.sh taipei`) sets up Greater Taipei only (box `121.28,24.85,121.80,25.30`: Taipei, New Taipei, Keelung, Tamsui). `prepare-otp` with `GTFS_BBOX` keeps the trips with two or more stops in the box, whole, so trains through the region keep their stops and times outside it; `fetch-data.sh` with `BBOX` clips the map. Run here in an empty data folder:

| Step | Result |
| --- | --- |
| GTFS trim | 120,352 of 192,174 trips, 52,726 stops, 3.88M stop times kept; `tw.gtfs.zip` 46 MB (88.5 MB for all of Taiwan). Stations in the box keep their entrances and pathways |
| Graph build, `-Xmx4g` | ~4.5 min, 3.9 GB peak (measured in an earlier run with the same data and heap); `graph.obj` 908 MB, 48,942 stops |
| Start: ingest, then OTP once YouBike docks are loaded, then the API | 76 s |
| Running | OTP 2.97 GB, ingest 0.32 GB (1.08 GB peak at start-up, reading the trimmed feed), API 0.27 GB: **~3.5 GB** |
| First run, downloads included | 10 min (map from a local copy); 2.3 GB on disk |

On this stack: Taipei Main → Tamsui 2.4 s, 5 options (metro, 52 min, TPASS covered); the same with 90 min at Dihua St 2.0 s, 4 options, stays of 95 min with YouBike legs and dock risk; a YouBike trip from City Hall to National Taiwan University 0.4 s; search 142 ms; 1,604 YouBike docks in a central Taipei box; live ETAs on the Taipei Main Station boards.

OTP reads YouBike docks from ingest once at start-up and does not retry: started before ingest it had no docks at all. The script and `docker-compose.yml` now start OTP only after ingest has loaded them.

### Hsinchu on one machine — 2026-10-13 06:40–07:10 Taipei (Tuesday)

`infra/scripts/try-it.sh hsinchu` sets up a second region: box `120.85,24.67,121.11,24.885` (Hsinchu City; Zhubei and HSR Hsinchu; Baoshan and the Science Park; Zhudong; Zhunan). Each region builds into its own `data/otp-<region>` folder and shares the downloads, so switching region only rebuilds a region that was never built.

Two changes came from Hsinchu's data:

- **Trains at a single station.** HSR Hsinchu is the only HSR station in the box, so the two-stop trim rule dropped all 3,091 HSR trains (and some TRA expresses). Rail trips now need only one stop in the box. Taipei gains 118 TRA trips from this.
- **Intercity buses.** Intercity (公路客運) routes are most of Hsinchu's buses: 1,342 trips in the box, against 838 Hsinchu City and 473 Hsinchu County trips. Polling the national InterCity ETA feed means about 60,000 rows a minute, so ingest asks TDX only for the routes in the trimmed timetable (`BUS_INTERCITY_ROUTES=auto`: 41 routes, `$filter=RouteUID eq …`). It is still one request per poll.

Run here from the downloads above (2026-10-12):

| Step | Result |
| --- | --- |
| GTFS trim | 26,519 trips, 4,720 stops, 633k stop times kept, including all HSR trains at Hsinchu; `tw.gtfs.zip` 13.8 MB. Taipei Metro's feed has no trips in the box and is left out |
| Graph build, `-Xmx3g` | 57 s, 1.58 GB peak; `graph.obj` 44 MB |
| Trim, build and start, downloads reused | 5.5 min |
| Start: ingest, then OTP once YouBike docks are loaded, then the API | 2.5 min (two cities' YouBike within 5 requests/minute) |
| Running | OTP 0.60 GB, ingest 0.30 GB (0.50 GB peak), API 0.26 GB: **~1.2 GB** |
| TDX load | 4.2 requests/minute by the estimate; 11 live feeds all fresh, no 429 |

Trips through the API at 06:47:

| Trip | Result |
| --- | --- |
| 新竹火車站 → 清華大學 | 1.3 s. City bus 182 (TPASS 桃竹竹苗: covered), intercity 5608 (TPASS unknown) or YouBike |
| 新竹火車站 → 高鐵新竹站 | 0.4 s. Liujia line, 30 min |
| 竹北火車站 → 新竹縣政府 | 0.3 s. County bus 65A with a live ETA, 快捷1號 or YouBike |
| 新竹火車站 → 竹東, → 科學園區 | 0.3 s. Intercity 5608, city bus 182 |
| 新竹火車站 → 城隍廟 (60 min) → 南寮漁港 | 0.6 s. Stays of 79–100 min (the next buses after the stay) |
| 巨城 → 清華大學 | 0.3 s. 藍線1區 with a live ETA (157 s) or YouBike |

**Departure boards:**
- 新竹 TRA: 19 departures, 11 with live TRA delays.
- 高鐵新竹站: HSR trains, from the timetable.
- 新竹轉運站: intercity 9003, live.
- 城隍廟: city bus 10, live.

**Other checks:**
- Search 清華大學 finds the stop in 58 ms.
- `/v1/bikes` returns 94 YouBike docks in central Hsinchu.

**Long YouBike-only trips are now capped at 45 minutes** (`maxDirectStreetDurationForMode`). Before, the first option to Zhudong was an 81-minute YouBike ride. Bike legs inside transit trips were already limited to 25 minutes.


## Hsinchu on a home server, typhoon day (2026-10-24)

Found while running the Hsinchu region on a home Ubuntu server, during the 薔琵 typhoon.

**Suspensions show up as silence, not as data.**
- Every YouBike station in Hsinchu City, Hsinchu County, the Science Park, Taoyuan, Miaoli and Taichung reported `ServiceStatus` 0 or 2 with no bikes and no docks, in TDX and in YouBike's own feed (`apis.youbike.com.tw`). Southern cities ran normally. OTP then plans no YouBike legs, and the app now says why.
- Hsinchu City's buses were suspended too, but the timetable still lists them, and no bus had a live prediction. Ingest now counts live predictions per bus feed (`/health` → `busLive`); between 07:00 and 21:00 a fresh feed with none marks its bus legs and departures *may not run* (`no_live_service`). TDX's `StopStatus` 4 (not operating today) marks a leg the same way (`not_operating_today`).
- `infra/scripts/live-coverage.sh` logs `busLive` through a day, to measure how much of the day each operator reports live times (still to run on a normal day).

**TPASS (桃竹竹苗), checked against Hsinchu City's official Q&A (updated 2023-09-23):**
- There are four passes: 竹竹 NT$288, 桃竹竹 NT$799, 竹竹苗 NT$699 and 桃竹竹苗 NT$1200. Each covers its cities' city buses, intercity buses with both ends inside, YouBike rented inside (first 30 minutes free in Hsinchu and Miaoli, 60 in Taoyuan) and TRA within station ranges that end at the city borders (竹竹: 北湖–香山, 六家線, 內灣線).
- TRA: every class except Taroko, Puyuma, EMU3000, tour and group trains. TDX route ids end in the class (`TRA_<trainNo>_<dir>_<class>`). TRA's open timetable (`ods.railway.gov.tw`) of 2026-10-24 places them: 1101 Taroko, 1107 Puyuma, 110G/110H/110K/110M exactly the 自強(3000) train numbers; 1108/1109/110A/110F 自強, 1110 莒光, 1131 區間, 1132 區間快. Class 1150 (two date-specific extra trains) stays unknown.
- Stations and intercity stops carry no city in their ids, so the API places them on the Ministry of the Interior's county borders (taiwan-atlas TopoJSON, MIT). Checked on TRA's station list: all 245 stations with an address land in their address's city, except 八斗子, which TRA lists under New Taipei but sits on the Keelung side (same pass either way).

**Search:**
- OTP's `name` filter matches only the requested language's names and their exact spelling. In English, 清華大學 found nothing, and "Tsing Hua" found nothing either.
- The API now searches its own index of every stop's Chinese and English names. It ignores case, spaces and punctuation and treats 臺 as 台, and loads from OTP once every 6 hours.