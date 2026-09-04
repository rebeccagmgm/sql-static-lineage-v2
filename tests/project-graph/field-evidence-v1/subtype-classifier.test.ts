import { describe, expect, it } from "vitest";

import {
  classifyExpressionSubtype,
  composePathSubtype,
} from "../../../scripts/project-graph/field-evidence-v1/subtype-classifier.ts";

describe("subtype-classifier", () => {
  it("classifies bare column references as IDENTITY", () => {
    const result = classifyExpressionSubtype(
      {
        expression_text: "t.price AS price",
        input_dependency_status: "PHYSICAL",
        input_fields: [{ table: "demo.t", column: "price" }],
      },
      "project",
    );
    expect(result.subtype).toBe("IDENTITY");
    expect(result.subtypeReason).toBeNull();
  });

  it("classifies aggregate expressions as AGGREGATION", () => {
    const result = classifyExpressionSubtype(
      {
        expression_text: "sum(price)",
        input_dependency_status: "PHYSICAL",
        input_fields: [{ table: "demo.t", column: "price" }],
      },
      "aggregate",
    );
    expect(result.subtype).toBe("AGGREGATION");
    expect(result.pathHadAggregation).toBe(true);
  });

  it("classifies casts and arithmetic as TRANSFORMATION", () => {
    const result = classifyExpressionSubtype(
      {
        expression_text: "cast(a.price as decimal(18,6))",
        input_dependency_status: "PHYSICAL",
        input_fields: [{ table: "demo.t", column: "price" }],
      },
      "project",
    );
    expect(result.subtype).toBe("TRANSFORMATION");
  });

  it("composes folded materialization paths with aggregation precedence", () => {
    const composed = composePathSubtype([
      classifyExpressionSubtype(
        {
          expression_text: "sum(x.amt)",
          input_dependency_status: "PHYSICAL",
          input_fields: [{ table: "demo.x", column: "amt" }],
        },
        "aggregate",
      ),
      classifyExpressionSubtype(
        {
          expression_text: "t.amt",
          input_dependency_status: "PHYSICAL",
          input_fields: [{ table: "demo.temp", column: "amt" }],
        },
        "project",
      ),
    ]);
    expect(composed.subtype).toBe("AGGREGATION");
  });
});
