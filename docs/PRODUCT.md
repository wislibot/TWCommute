# TWCommute — product assessment and plan

This reviews the Gemini-generated report *"Taiwan Transit App Market Research"* (Google Doc), checks its claims, and sets the product direction.

## Verdict

**Build it, but as a focused tool, not "a better Google Maps".** The idea is sound and very buildable: Taiwan publishes national transit data through TDX, and OpenTripPlanner is a mature open-source router. But the report overstates the gap. Google Maps, Apple Maps and Citymapper already cover Taiwan, so winning means doing the few things they don't.

## What the report got wrong or outdated

| Report claim | What we found |
| --- | --- |
| Google Maps "relies heavily on static timetables" for buses and "excludes YouBike routing". | Google Maps has shown **live bus arrivals in Taiwan since January 2017** (Taipei, New Taipei, Taoyuan, Taichung, Kaohsiung), and shows YouBike availability; bike-share was added to directions in Taipei/New Taipei. Apple Maps covers Taiwan transit and YouBike too. ([technews](https://technews.tw/?p=216674), [bnext](https://www.bnext.com.tw/article/54035/google-maps-youbike), [AppleInsider](https://appleinsider.com/articles/17/10/13/apple-maps-transit-directions-go-live-in-taiwan)) |
| Nobody does unified multimodal routing. | **Citymapper covers all of Taiwan**, and local apps (台灣交通 "智慧轉乘", 台灣鐵道通) plan across modes. ([Citymapper](https://content.citymapper.com/news/2388/citymapper-lai-tai-wan-la)) |
| Commuter Pro at NT$490/year. | **Bus+ PRO is NT$45/month or NT$445/year**, so NT$490 is above the incumbent. Citymapper was sold to Via in 2023 with most investors not getting their money back, so consumer transit apps are hard to monetize. ([App Store](https://apps.apple.com/tw/app/bus-%E5%85%AC%E8%BB%8A%E5%8B%95%E6%85%8B-%E8%87%BA%E9%90%B5-ubike-%E6%9F%A5%E8%A9%A2/id967861325), [TechCrunch](https://techcrunch.com/?p=2501182)) |
| TPASS is flat-rate, with 710k monthly users. | TPASS 2.0 adds **frequent-rider rebates**. About **982k people a month** used TPASS 1.0 + 2.0 in December 2025. ([CTEE](https://www.ctee.com.tw/news/20251204701134-430104)) |
| A detailed TDX tier/point table. | Not confirmed. MOTC only states six tiers at **NT$200–20,000+/month**, with 50% off for academic/public-interest users. **GTFS downloads are free while in Beta.** ([MOTC](https://www.motc.gov.tw/ch/app/news_list/view?module=news&id=14&serno=44e2cc94-8a1b-4fc0-b70e-f07551a05e2a), TDX GTFS spec) |
| Multi-stop transit needs a custom concatenated pipeline. | OpenTripPlanner 2.7+ supports `via` stops with `minimumWaitTime` natively, but on the full-Taiwan graph one via search takes 18–24 s. We chain plain searches per segment instead (about 2–3 s each), which also controls the stay exactly. |
| TDX provides GTFS-Realtime for routing. | TDX docs list GTFS-RT, but say its **delivery mechanism is "in progress"**; only static GTFS is downloadable. We use TDX's native bus ETA and TRA delay APIs instead (see ARCHITECTURE.md). |

Confirmed: 8.57M visitors in 2025, 76.4% independent travelers ([CNA](https://www.cna.com.tw/news/ahel/202601260266.aspx), [UDN](https://udn.com/news/story/7266/9668089)); UMAJI's failure (~NT$150M, ~23k downloads, ~2k active users; Control Yuan correction) ([Mirror Media](https://www.mirrormedia.mg/story/20200813edi017)).

## Positioning: what we do that others don't

1. **Multi-stop transit days.** "MRT to Dihua St, stay 90 min, bus to Dadaocheng Wharf, then home." Google Maps disables stops along the way in transit mode; Citymapper has none either.
2. **YouBike and transit in one trip, with dock risk.** We warn when the pickup has few bikes or the drop-off few docks, and suggest a backup station.
3. **TPASS-aware.** Every route says whether your pass covers it.
4. **Truly multilingual and calm.** zh-TW, English, Japanese, Korean; station codes always shown; no ads; **no account needed** (UMAJI's sign-up wall was one of its failures).

## Users

- **Independent travelers** (8.57M/yr): language barriers, confusing buses, day itineraries with several stops.
- **Foreign students and residents** (>140k students, >1.19M foreign residents and workers): daily bus/YouBike commutes, Chinese-only local apps.
- **Domestic TPASS commuters** (~1M/month): the hardest to win (Bus+ and Google habits); target with multi-stop errands and pass coverage.

## Business model (indie)

| Tier | Price | Includes |
| --- | --- | --- |
| Free | — | Routing, live arrivals, YouBike map, 4 languages, up to 2 stops along the way, no ads |
| Pro | NT$45/month or NT$390/year | Unlimited stops, saved routines + departure alerts, dock-risk alerts, later widgets / Live Activities |
| Tourist Pass | NT$99 / 14 days (non-renewing) | Pro for a trip |
| Later | commission | THSR / day-tour affiliate links (Klook, KKday) |

Subscriptions via RevenueCat (App Store / Play billing). Costs are mostly fixed: one VM for OTP plus the TDX tier, and they do not grow with users.

## Risks

| Risk | Mitigation |
| --- | --- |
| Google Maps habit | Lead with what Google can't do (multi-stop, YouBike + transit, TPASS); acquire foreigners first (student orientations, expat groups, travel forums). |
| Live bus data quality | Label every time "Live" or "Scheduled"; fall back to timetables when feeds are stale. |
| TDX cost and terms | Server-side polling only; usage is fixed by polling intervals, not users. Verify the tier and attribution terms in Phase 0. |
| Low willingness to pay | Price at or below Bus+; keep fixed costs small; a tourist pass suits short stays. |
| Data mapping assumptions | Phase 0 audit (docs/DATA.md) verifies GTFS ↔ TDX id matching before launch. |

## Roadmap

- **Phase 0, data audit (go/no-go):** TDX key, GTFS download, validation, OTP graph build, live-data coverage per city, TDX tier. See docs/DATA.md.
- **Phase 1, MVP:** ingest, OTP, API, and the mobile app in this repo; internal TestFlight / Play testing with foreign students.
- **Phase 2, launch:** RevenueCat Pro + Tourist Pass, saved routines and alerts, dock-risk v2 (historical probabilities), verified TPASS data, store listings in 4 languages, privacy policy, production VM.
- **Phase 3:** iOS Live Activities and widgets, offline maps, fare amounts, affiliate links, POI geocoder, web planner.
