/**
 * GraphQL documents for OpenTripPlanner's GTFS GraphQL API (OTP 2.10).
 * `queries.test.ts` validates them against infra/otp/schema.graphqls.
 */

const PLACE_FIELDS = `
  name
  lat
  lon
  viaLocationType
  stop { gtfsId code }
  vehicleRentalStation {
    stationId
    name
    lat
    lon
    realtime
    availableVehicles { total }
    availableSpaces { total }
  }
`;

const LEG_TIME = "scheduledTime estimated { time delay }";

export const PLAN_QUERY = /* GraphQL */ `
  query Plan(
    $origin: PlanLabeledLocationInput!
    $destination: PlanLabeledLocationInput!
    $via: [PlanViaLocationInput!]
    $dateTime: PlanDateTimeInput
    $modes: PlanModesInput
    $first: Int
    $after: String
    $before: String
    $locale: Locale
  ) {
    planConnection(
      origin: $origin
      destination: $destination
      via: $via
      dateTime: $dateTime
      modes: $modes
      first: $first
      after: $after
      before: $before
      locale: $locale
    ) {
      routingErrors { code description }
      pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
      edges {
        node {
          start
          end
          duration
          numberOfTransfers
          walkDistance
          legs {
            mode
            distance
            duration
            transitLeg
            rentedBike
            realTime
            realtimeState
            headsign
            start { ${LEG_TIME} }
            end { ${LEG_TIME} }
            from { ${PLACE_FIELDS} }
            to { ${PLACE_FIELDS} }
            route { gtfsId shortName longName color textColor agency { gtfsId name } }
            trip { gtfsId directionId }
            legGeometry { points }
          }
        }
      }
    }
  }
`;

export const STOPS_NEARBY_QUERY = /* GraphQL */ `
  query StopsNearby($lat: Float!, $lon: Float!, $radius: Int!, $first: Int) {
    stopsByRadius(lat: $lat, lon: $lon, radius: $radius, first: $first) {
      edges {
        node {
          distance
          stop { gtfsId name code lat lon vehicleMode }
        }
      }
    }
  }
`;

export const STOP_DEPARTURES_QUERY = /* GraphQL */ `
  query StopDepartures($id: String!, $startTime: Long, $timeRange: Int, $n: Int) {
    stop(id: $id) {
      gtfsId
      name
      code
      lat
      lon
      vehicleMode
      stoptimesWithoutPatterns(startTime: $startTime, timeRange: $timeRange, numberOfDepartures: $n, omitNonPickups: true) {
        scheduledDeparture
        realtimeDeparture
        realtime
        realtimeState
        serviceDay
        headsign
        trip {
          gtfsId
          directionId
          route { gtfsId shortName mode }
        }
      }
    }
  }
`;

/** Stop/station name search (MVP place search; a POI geocoder is added later). */
export const SEARCH_QUERY = /* GraphQL */ `
  query Search($q: String!, $lang: String) {
    stations(name: $q) { gtfsId name(language: $lang) code lat lon vehicleMode }
    stops(name: $q) { gtfsId name(language: $lang) code lat lon vehicleMode parentStation { gtfsId } }
  }
`;
