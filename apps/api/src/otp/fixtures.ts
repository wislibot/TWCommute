/**
 * Synthetic OTP responses for unit tests, shaped like OTP 2.10 GTFS GraphQL output for the
 * queries in ./queries.ts. Ids follow the assumed TDX GTFS id scheme; values are made up.
 */
import type { OtpItinerary, OtpLeg, OtpPlace } from "./types";

const place = (name: string, lat: number, lon: number, extra: Partial<OtpPlace> = {}): OtpPlace => ({
  name,
  lat,
  lon,
  viaLocationType: null,
  stop: null,
  vehicleRentalStation: null,
  ...extra,
});

const t = (iso: string, delay?: string) => ({ scheduledTime: iso, estimated: delay ? { time: iso, delay } : null });

const leg = (l: Partial<OtpLeg> & Pick<OtpLeg, "mode" | "from" | "to" | "start" | "end">): OtpLeg => ({
  distance: 500,
  duration: 300,
  transitLeg: false,
  rentedBike: false,
  realTime: false,
  realtimeState: null,
  headsign: null,
  route: null,
  trip: null,
  legGeometry: { points: "_p~iF~ps|U_ulLnnqC" },
  ...l,
});

const station = (stationId: string, name: string, bikes: number, docks: number) => ({
  stationId,
  name,
  lat: 25.03,
  lon: 121.54,
  realtime: true,
  availableVehicles: { total: bikes },
  availableSpaces: { total: docks },
});

/** Bike → MRT → walk to a via (90 min stay) → bus to destination. */
export const itineraryWithVia: OtpItinerary = {
  start: "2026-10-11T09:00:00+08:00",
  end: "2026-10-11T11:20:00+08:00",
  duration: 8400,
  numberOfTransfers: 1,
  walkDistance: 900,
  legs: [
    leg({
      mode: "BICYCLE",
      rentedBike: true,
      from: place("Origin dock", 25.026, 121.543, {
        vehicleRentalStation: station("youbike2:TPE500101001", "捷運科技大樓站", 2, 20),
      }),
      to: place("Dest dock", 25.033, 121.543, {
        vehicleRentalStation: station("youbike2:TPE500101099", "大安站", 10, 0),
      }),
      start: t("2026-10-11T09:00:00+08:00"),
      end: t("2026-10-11T09:08:00+08:00"),
    }),
    leg({
      mode: "SUBWAY",
      transitLeg: true,
      realTime: true,
      realtimeState: "UPDATED",
      headsign: "淡水",
      from: place("大安", 25.033, 121.543, { stop: { gtfsId: "trtc:R05", code: "R05" } }),
      to: place("雙連", 25.057, 121.52, { stop: { gtfsId: "trtc:R12", code: "R12" } }),
      start: t("2026-10-11T09:10:00+08:00", "PT1M"),
      end: t("2026-10-11T09:22:00+08:00", "PT1M"),
      route: {
        gtfsId: "trtc:R",
        shortName: "淡水信義線",
        longName: null,
        color: "E3002C",
        textColor: "FFFFFF",
        agency: { gtfsId: "trtc:TRTC", name: "臺北捷運" },
      },
      trip: { gtfsId: "trtc:R-0910", directionId: "0" },
    }),
    leg({
      mode: "WALK",
      from: place("雙連", 25.057, 121.52),
      to: place("Dihua St", 25.0558, 121.5099, { viaLocationType: "VISIT" }),
      start: t("2026-10-11T09:22:00+08:00"),
      end: t("2026-10-11T09:35:00+08:00"),
    }),
    leg({
      mode: "WALK",
      from: place("Dihua St", 25.0558, 121.5099, { viaLocationType: "VISIT" }),
      to: place("迪化街口", 25.0553, 121.51, { stop: { gtfsId: "tw:TPE10001", code: null } }),
      start: t("2026-10-11T11:05:00+08:00"),
      end: t("2026-10-11T11:08:00+08:00"),
    }),
    leg({
      mode: "BUS",
      transitLeg: true,
      realtimeState: "SCHEDULED",
      headsign: "大稻埕碼頭",
      from: place("迪化街口", 25.0553, 121.51, { stop: { gtfsId: "tw:TPE10001", code: null } }),
      to: place("大稻埕碼頭", 25.0569, 121.508, { stop: { gtfsId: "tw:TPE10002", code: null } }),
      start: t("2026-10-11T11:10:00+08:00"),
      end: t("2026-10-11T11:20:00+08:00"),
      route: {
        gtfsId: "tw:TPE10307",
        shortName: "307",
        longName: null,
        color: null,
        textColor: null,
        agency: { gtfsId: "tw:TPE", name: "臺北市公車" },
      },
      trip: { gtfsId: "tw:TPE10307-1", directionId: "0" },
    }),
  ],
};
