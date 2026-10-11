import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PlanRequest } from "@twc/contracts";
import { buildSchema, getVariableValues, type OperationDefinitionNode, parse, validate } from "graphql";
import { describe, expect, it } from "vitest";
import { buildPlanVariables } from "../plan/variables";
import { PLAN_QUERY, SEARCH_QUERY, STOP_DEPARTURES_QUERY, STOPS_NEARBY_QUERY } from "./queries";

// OTP's schema is produced by graphql-java and trips one of graphql-js v17's stricter SDL
// rules (deprecated implementation fields); skip SDL validation and validate our documents only.
const schema = buildSchema(readFileSync(join(import.meta.dirname, "../../../../infra/otp/schema.graphqls"), "utf8"), {
  assumeValid: true,
});

describe("OTP queries", () => {
  for (const [name, q] of Object.entries({
    PLAN_QUERY,
    SEARCH_QUERY,
    STOP_DEPARTURES_QUERY,
    STOPS_NEARBY_QUERY,
    HEALTH: "{ feeds { feedId } }",
  })) {
    it(`${name} is valid against the OTP 2.10 schema`, () => {
      expect(validate(schema, parse(q)).map((e) => e.message)).toEqual([]);
    });
  }
});

/** Coerce variables against the PLAN_QUERY definitions exactly as OTP's GraphQL layer would. */
async function variableErrors(variables: Record<string, unknown>): Promise<string[]> {
  const op = parse(PLAN_QUERY).definitions[0] as OperationDefinitionNode;
  const result = getVariableValues(schema, op.variableDefinitions ?? [], variables, { maxErrors: 50 });
  return (result.errors ?? []).map((e) => e.message);
}

describe("plan variables", () => {
  const base = { from: { lat: 25.0478, lon: 121.517 }, to: { lat: 25.1677, lon: 121.4456 } };

  it("coerce against the schema for a simple trip", async () => {
    expect(await variableErrors(buildPlanVariables(PlanRequest.parse(base)))).toEqual([]);
  });

  it("coerce with coordinate and stop vias, arrive-by, modes and a cursor", async () => {
    const req = PlanRequest.parse({
      ...base,
      vias: [
        { place: { lat: 25.0558, lon: 121.5099, label: "Dihua St" }, dwellMinutes: 90 },
        { place: { lat: 25.0569, lon: 121.508, stopId: "tw:TPE10002" }, dwellMinutes: 0 },
      ],
      time: "2026-10-11T18:00:00+08:00",
      arriveBy: true,
      transitModes: ["SUBWAY", "BUS"],
      bikeShare: false,
      locale: "zh-TW",
      cursor: "next:abc",
    });
    expect(await variableErrors(buildPlanVariables(req))).toEqual([]);
  });

  it("rejects malformed variables (sanity check of the harness)", async () => {
    const vars = buildPlanVariables(PlanRequest.parse(base));
    expect(await variableErrors({ ...vars, dateTime: { earliestDeparture: "x", latestArrival: "y" } })).not.toEqual([]);
  });
});
