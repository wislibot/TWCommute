import type { AuditReport, Pct, Percentiles } from "./types";

const DASH = "—";

/** One table cell: newlines collapsed, pipes escaped, blank → dash. */
function cell(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  const clean = s
    .replace(/\r?\n|\r/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
  return clean === "" ? DASH : clean;
}

export const fmtPct = (p: Pct): string => (p === null || !Number.isFinite(p) ? DASH : `${p.toFixed(1)}%`);

export function fmtLag(p: Percentiles): string {
  if (p.count === 0) return DASH;
  const s = (v: number | null) => (v === null ? DASH : `${v}s`);
  return `p50 ${s(p.p50)} · p90 ${s(p.p90)} · max ${s(p.max)}`;
}

const fmtMB = (bytes: number | null) => (bytes === null ? DASH : `${(bytes / 1_048_576).toFixed(1)} MB`);

/** "k=v, k=v", largest first; ties broken by key (code-unit order) so output is deterministic. */
export function fmtRecord(r: Record<string, number | string>): string {
  const entries = Object.entries(r).sort((a, b) => {
    const [na, nb] = [Number(a[1]), Number(b[1])];
    if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return nb - na;
    return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
  });
  return entries.length ? entries.map(([k, v]) => `${k}=${v}`).join(", ") : DASH;
}

function table(headers: string[], rows: unknown[][]): string {
  if (rows.length === 0) return "_No data._";
  const line = (cells: unknown[]) => `| ${cells.map(cell).join(" | ")} |`;
  return [line(headers), `|${headers.map(() => " --- ").join("|")}|`, ...rows.map(line)].join("\n");
}

/** Markdown summary of an audit, for docs/DATA.md "Results". Pure and deterministic. */
export function renderMarkdown(r: AuditReport): string {
  const out: string[] = [
    `## Phase 0 audit — ${r.generatedAt}`,
    "",
    `Cities: ${r.cities.length ? r.cities.join(", ") : DASH}`,
    "",
  ];
  const section = (title: string, body: string) => out.push(`### ${title}`, "", body, "");

  section(
    "GTFS feeds",
    table(
      [
        "Feed",
        "Size",
        "Agencies",
        "Routes by type",
        "Trips",
        "Stops",
        "stop_times",
        "Calendar",
        "Translations",
        "Flags",
        "Warnings",
      ],
      r.gtfs.map((g) => [
        g.feedId,
        fmtMB(g.bytes),
        g.agencyCount,
        fmtRecord(g.routeTypeCounts),
        g.tripCount,
        g.stopCount,
        fmtMB(g.stopTimesBytes),
        g.calendar.start ? `${g.calendar.start}–${g.calendar.end}` : DASH,
        g.translationLanguages.join(", "),
        [g.hasFrequencies && "frequencies", g.hasShapes && "shapes", g.hasFares && "fares", g.hasPathways && "pathways"]
          .filter(Boolean)
          .join(", "),
        g.warnings.join("; "),
      ]),
    ),
  );
  section(
    "Stop ids with a city code",
    table(
      ["Feed", "Stops", "Resolved", "By city", "Unresolved samples"],
      r.cityPrefix.map((c) => [
        c.feedId,
        c.stops,
        fmtPct(c.resolved),
        fmtRecord(c.byCity),
        c.unresolvedSamples.join(", "),
      ]),
    ),
  );
  section(
    "Bus id mapping (live ETA overlay)",
    table(
      [
        "City",
        "TDX stops",
        "StopUID=stop_id",
        "StopID=stop_id",
        "stop_code",
        "TDX routes",
        "RouteUID",
        "SubRouteUID",
        "SubRouteUID_Dir",
        "ETA rows",
        "ETA w/ SubRoute",
        "ETA joinable",
        "Best",
        "Unmatched samples",
      ],
      r.busMapping.map((b) => [
        b.city,
        b.tdxStops,
        fmtPct(b.stopUidInGtfs),
        fmtPct(b.stopIdInGtfs),
        fmtPct(b.stopInStopCode),
        b.tdxRoutes,
        fmtPct(b.routeUidInGtfs),
        fmtPct(b.subRouteUidInGtfs),
        fmtPct(b.subRouteDirInGtfs),
        b.etaRows,
        fmtPct(b.etaWithSubRoute),
        fmtPct(b.etaJoinable),
        b.bestHypothesis,
        b.samples.unmatchedEtaKeys.join(", "),
      ]),
    ),
  );
  section(
    "Bus ETA quality",
    table(
      ["City", "Rows", "Stops", "Routes", "With estimate", "StopStatus", "Data age"],
      r.eta.map((e) => [
        e.city,
        e.rows,
        e.distinctStops,
        e.distinctRoutes,
        fmtPct(e.withEstimate),
        fmtRecord(e.stopStatus),
        fmtLag(e.lagSeconds),
      ]),
    ),
  );
  section(
    "TRA live delays",
    r.tra === null
      ? "_Not run._"
      : table(
          [
            "TRA feed",
            "Trains indexed",
            "Stations indexed",
            "Trips with stops",
            "Delays",
            "Matched",
            "Via next stop",
            "Unmatched trains",
            "Unmatched stations",
            "TDX stations mapped",
            "Samples",
          ],
          [
            [
              r.tra.traFeedFound ? "found" : "missing",
              r.tra.trainsIndexed,
              r.tra.stationsIndexed,
              r.tra.tripsWithStops,
              r.tra.delays,
              `${r.tra.matched} (${fmtPct(r.tra.delays ? (r.tra.matched / r.tra.delays) * 100 : null)})`,
              r.tra.offPattern,
              r.tra.unmatchedTrains,
              r.tra.unmatchedStations,
              fmtPct(r.tra.tdxStationsMapped),
              [
                ...r.tra.unmatchedSamples.trains.map((t) => `train ${t}`),
                ...r.tra.unmatchedSamples.stations.map((s) => `station ${s}`),
              ].join(", "),
            ],
          ],
        ),
  );
  section(
    "YouBike",
    table(
      [
        "City",
        "Stations",
        "Availability",
        "Joined",
        "Types",
        "Status",
        "E-bike detail",
        "Zero bikes",
        "Zero docks",
        "Data age",
      ],
      r.youbike.map((y) => [
        y.city,
        y.stations,
        y.availabilityRows,
        fmtPct(y.joined),
        fmtRecord(y.serviceTypes),
        fmtRecord(y.statusCounts),
        fmtPct(y.withEbikeDetail),
        fmtPct(y.zeroBikes),
        fmtPct(y.zeroDocks),
        fmtLag(y.lagSeconds),
      ]),
    ),
  );
  section(
    "TDX usage",
    table(
      ["Calls", "By status", "Rate-limit headers"],
      [[r.tdx.calls, fmtRecord(r.tdx.byStatus), fmtRecord(r.tdx.rateLimitHeaders)]],
    ),
  );
  section("Errors", r.errors.length ? r.errors.map((e) => `- ${e.replace(/\r?\n/g, " ")}`).join("\n") : "_None._");
  return `${out.join("\n").trimEnd()}\n`;
}
