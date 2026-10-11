/** Response shapes for the queries in ./queries.ts (subset of the OTP schema). */

export interface OtpLegTime {
  scheduledTime: string;
  estimated: { time: string; delay: string } | null;
}

export interface OtpRentalStation {
  stationId: string | null;
  name: string;
  lat: number | null;
  lon: number | null;
  realtime: boolean | null;
  availableVehicles: { total: number } | null;
  availableSpaces: { total: number } | null;
}

export interface OtpPlace {
  name: string | null;
  lat: number;
  lon: number;
  viaLocationType: "PASS_THROUGH" | "VISIT" | null;
  stop: { gtfsId: string; code: string | null } | null;
  vehicleRentalStation: OtpRentalStation | null;
}

export interface OtpLeg {
  mode: string | null;
  distance: number | null;
  duration: number | null;
  transitLeg: boolean | null;
  rentedBike: boolean | null;
  realTime: boolean | null;
  realtimeState: "SCHEDULED" | "UPDATED" | "CANCELED" | "ADDED" | "MODIFIED" | null;
  headsign: string | null;
  start: OtpLegTime;
  end: OtpLegTime;
  from: OtpPlace;
  to: OtpPlace;
  route: {
    gtfsId: string;
    shortName: string | null;
    longName: string | null;
    color: string | null;
    textColor: string | null;
    agency: { gtfsId: string; name: string } | null;
  } | null;
  trip: { gtfsId: string; directionId: string | null } | null;
  legGeometry: { points: string | null } | null;
}

export interface OtpItinerary {
  start: string | null;
  end: string | null;
  duration: number | null;
  numberOfTransfers: number;
  walkDistance: number | null;
  legs: (OtpLeg | null)[];
}

export interface OtpPlanData {
  planConnection: {
    routingErrors: { code: string; description: string }[];
    pageInfo: { startCursor: string | null; endCursor: string | null; hasNextPage: boolean; hasPreviousPage: boolean };
    edges: ({ node: OtpItinerary } | null)[] | null;
  } | null;
}

export interface OtpStopsNearbyData {
  stopsByRadius: {
    edges:
      | ({
          node: {
            distance: number | null;
            stop: {
              gtfsId: string;
              name: string;
              code: string | null;
              lat: number;
              lon: number;
              vehicleMode: string | null;
            } | null;
          } | null;
        } | null)[]
      | null;
  } | null;
}

export interface OtpStoptime {
  scheduledDeparture: number | null;
  realtimeDeparture: number | null;
  realtime: boolean | null;
  realtimeState: string | null;
  serviceDay: number | null;
  headsign: string | null;
  trip: {
    gtfsId: string;
    directionId: string | null;
    route: { gtfsId: string; shortName: string | null; mode: string | null };
  } | null;
}

export interface OtpStopDeparturesData {
  stop: {
    gtfsId: string;
    name: string;
    code: string | null;
    lat: number;
    lon: number;
    vehicleMode: string | null;
    stoptimesWithoutPatterns: (OtpStoptime | null)[] | null;
  } | null;
}

export interface OtpSearchStop {
  gtfsId: string;
  name: string;
  code: string | null;
  lat: number;
  lon: number;
  vehicleMode: string | null;
  parentStation?: { gtfsId: string } | null;
}

export interface OtpSearchData {
  stations: (OtpSearchStop | null)[] | null;
  stops: (OtpSearchStop | null)[] | null;
}
