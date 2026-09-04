import { describe, expect, it } from "vitest";

import {
  datasetControlMapping,
  joinGrain,
} from "../../../scripts/reconcile/shared/dataset-controls.ts";

describe("shared dataset controls", () => {
  it("assigns distinct grainReason codes to INNER JOIN and LEFT JOIN", () => {
    expect(joinGrain("INNER")).toEqual({
      grain: "EXPAND_RISK",
      grainReason: "GRAIN_JOIN_CARDINALITY_UNPROVEN",
    });
    expect(joinGrain("LEFT")).toEqual({
      grain: "EXPAND_RISK",
      grainReason: "GRAIN_JOIN_NULLABLE_SIDE_MAY_EXPAND",
    });
  });

  it("maps FILTER relations to REDUCE controls", () => {
    expect(
      datasetControlMapping({
        relation_type: "filter",
        relation: {},
      }),
    ).toEqual({
      subtype: "FILTER",
      grain: "REDUCE",
      grainReason: "GRAIN_FILTER_MAY_DROP_ROWS",
    });
  });

  it("maps JOIN relations using join grain rules and exposes join side metadata", () => {
    expect(
      datasetControlMapping({
        relation_type: "join",
        relation: { join_type: "LEFT" },
      }),
    ).toEqual({
      subtype: "JOIN",
      grain: "EXPAND_RISK",
      grainReason: "GRAIN_JOIN_NULLABLE_SIDE_MAY_EXPAND",
    });
  });
});
