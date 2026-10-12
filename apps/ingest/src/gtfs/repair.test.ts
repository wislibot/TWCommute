import { strToU8 } from "fflate";
import { describe, expect, it } from "vitest";
import { editRecords, repairFeed, repairStopTimes } from "./repair";

const feed = (files: Record<string, string>) => new Map(Object.entries(files));

describe("repairFeed", () => {
  it("removes repeated ids, keeping the first row, and says whether rows differed", () => {
    const { changed, repairs } = repairFeed(
      feed({
        "levels.txt": "level_id,level_index,level_name\n573904,-2,第一月台\n573905,-2,第二月台\n573904,-2,第一月台\n",
        "stops.txt": 'stop_name,stop_id\r\n"A, north",1\r\nB,2\r\n"A\nsouth",1\r\n',
      }),
    );
    expect(changed.get("levels.txt")).toBe("level_id,level_index,level_name\n573904,-2,第一月台\n573905,-2,第二月台\n");
    expect(changed.get("stops.txt")).toBe('stop_name,stop_id\n"A, north",1\nB,2\n');
    expect(repairs).toEqual([
      { file: "stops.txt", rows: 1, what: "repeated stop_id (different rows): kept the first" },
      { file: "levels.txt", rows: 1, what: "repeated level_id (identical rows): removed" },
    ]);
  });

  it("clears missing levels and parent stations, re-quoting only the edited rows", () => {
    const { changed, repairs } = repairFeed(
      feed({
        "levels.txt": "level_id\nL1\n",
        "stops.txt":
          'stop_id,stop_name,parent_station,level_id\nP,"Main, Hall",,L1\nA,"Gate ""1""",P,L9\nB,b,GONE,L1\n',
      }),
    );
    expect(changed.get("stops.txt")).toBe(
      'stop_id,stop_name,parent_station,level_id\nP,"Main, Hall",,L1\nA,"Gate ""1""",P,\nB,b,,L1\n',
    );
    expect(repairs.map((r) => r.what)).toEqual(["level_id not found: cleared", "parent_station not found: cleared"]);
  });

  it("drops pathways to missing stops and trips of missing routes (with their frequencies)", () => {
    const { changed, removedTrips, repairs } = repairFeed(
      feed({
        "stops.txt": "stop_id\nS1\nS2\n",
        "pathways.txt": "pathway_id,from_stop_id,to_stop_id\nW1,S1,S2\nW2,S1,541831009\nW3,541831009,S2\n",
        "routes.txt": "route_id\nR1\n",
        "trips.txt": "route_id,service_id,trip_id\nR1,D,T1\nSHIP_NewTaipei_HalohaR101_0,D,T2\n",
        "frequencies.txt":
          "trip_id,start_time,end_time,headway_secs\nT1,06:00:00,09:00:00,600\nT2,06:00:00,09:00:00,600\n",
      }),
    );
    expect(changed.get("pathways.txt")).toBe("pathway_id,from_stop_id,to_stop_id\nW1,S1,S2\n");
    expect(changed.get("trips.txt")).toBe("route_id,service_id,trip_id\nR1,D,T1\n");
    expect(changed.get("frequencies.txt")).toBe("trip_id,start_time,end_time,headway_secs\nT1,06:00:00,09:00:00,600\n");
    expect([...removedTrips]).toEqual(["T2"]);
    expect(repairs.map((r) => [r.file, r.rows])).toEqual([
      ["pathways.txt", 2],
      ["trips.txt", 1],
      ["frequencies.txt", 1],
    ]);
  });

  it("changes nothing in a consistent feed", () => {
    const r = repairFeed(feed({ "stops.txt": "stop_id,level_id\nS1,L1\n", "levels.txt": "level_id\nL1\n" }));
    expect(r.changed.size).toBe(0);
    expect(r.repairs).toEqual([]);
  });
});

describe("editRecords", () => {
  const dec = (b: Uint8Array) => new TextDecoder("utf-8", { ignoreBOM: true }).decode(b);
  const dropT2 = (v: Record<string, string>) => (v.trip_id === "T2" ? "drop" : undefined);

  it("drops records by column value, with CRLF, quotes and a missing final newline", () => {
    const text = 'stop_id,trip_id,note\r\nS1,T1,a\r\nS2,T2,"x,\ny"\r\nS3,T1,"say ""hi"""\r\nS4,T2,z';
    const { data, dropped } = editRecords(strToU8(text), ["trip_id"], dropT2);
    expect(dropped).toBe(2);
    expect(dec(data)).toBe('stop_id,trip_id,note\r\nS1,T1,a\r\nS3,T1,"say ""hi"""\r\n');
  });

  it("reads quoted and non-ASCII values and keeps the same bytes when nothing changes", () => {
    const input = strToU8('﻿trip_id,stop_id\n"T,1",S1\n臺北1,S2\nT2,S3\n');
    const drop = (ids: string[]) => (v: Record<string, string>) => (ids.includes(v.trip_id ?? "") ? "drop" : undefined);
    expect(dec(editRecords(input, ["trip_id"], drop(["T,1", "臺北1"])).data)).toBe("﻿trip_id,stop_id\nT2,S3\n");
    expect(editRecords(input, ["trip_id"], drop(["nope"])).data).toBe(input);
    expect(editRecords(input, ["missing_column"], drop(["T2"])).data).toBe(input);
  });

  it("replaces fields, re-quoting only the edited record", () => {
    const input = strToU8('trip_id,note\nT1,"a,b"\nT2,"c,d"\n');
    const { data, edited } = editRecords(input, ["trip_id"], (v) => (v.trip_id === "T2" ? { note: 'e"f' } : undefined));
    expect(edited).toBe(1);
    expect(dec(data)).toBe('trip_id,note\nT1,"a,b"\nT2,"e""f"\n');
  });
});

describe("repairStopTimes", () => {
  it("completes HH:MM times (TDX Matsu buses) and removes rows of dropped trips", () => {
    const input = strToU8(
      "trip_id,arrival_time,departure_time,stop_id,stop_sequence\n" +
        "LIE40_00_1_T_40_1515_54Sh_11111110_151500,,15:15,LIE76,1\n" +
        "T1,08:00:00,08:00:00,S1,1\n" +
        "T2,9:05,9:05,S1,1\n" +
        "GONE,08:00:00,08:00:00,S1,1\n",
    );
    const { data, repairs } = repairStopTimes(input, new Set(["GONE"]));
    expect(new TextDecoder().decode(data)).toBe(
      "trip_id,arrival_time,departure_time,stop_id,stop_sequence\n" +
        "LIE40_00_1_T_40_1515_54Sh_11111110_151500,,15:15:00,LIE76,1\n" +
        "T1,08:00:00,08:00:00,S1,1\n" +
        "T2,9:05:00,9:05:00,S1,1\n",
    );
    expect(repairs).toEqual([
      { file: "stop_times.txt", rows: 1, what: "trip removed: removed" },
      { file: "stop_times.txt", rows: 2, what: "HH:MM time: completed to HH:MM:00" },
    ]);
  });

  it("returns the input when every row is fine", () => {
    const input = strToU8("trip_id,arrival_time,departure_time\nT1,25:10:00,25:10:00\nT1,,\n");
    expect(repairStopTimes(input, new Set()).data).toBe(input);
  });
});
