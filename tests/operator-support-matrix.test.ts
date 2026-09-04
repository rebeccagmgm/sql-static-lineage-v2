import { describe, expect, it } from "vitest";

import {
  lookupOperatorSupport,
  OPERATOR_SUPPORT_MATRIX,
  operatorSupportMatrixKey,
  validateOperatorSupportMatrix,
} from "../scripts/reconcile/consumer/target-field-causal-slice/operator-support-matrix.ts";
import {
  representativeOperatorSqlCorpus,
  representativeSemanticSupportFixtures,
} from "./fixtures/field-lineage/semantic-causal-slice.ts";

describe("operator semantic support matrix", () => {
  it("covers representative expression, rowset, window, top-n, subquery, and relation cells", () => {
    expect(representativeSemanticSupportFixtures).toHaveLength(16);
    for (const fixture of representativeSemanticSupportFixtures) {
      const result = lookupOperatorSupport(fixture);
      expect(result.matched, fixture.name).toBe(true);
      expect(result.cell.status, fixture.name).toBe(fixture.expectedStatus);
      expect(result.gap, fixture.name).toBeNull();
      expect(result.cell.proofRefs.length, fixture.name).toBeGreaterThan(0);
    }
  });

  it("includes both selector/control and value roles for CASE, IF, and COALESCE", () => {
    for (const operatorVariant of ["CASE", "IF", "COALESCE"] as const) {
      const selector = OPERATOR_SUPPORT_MATRIX.find(
        (entry) =>
          entry.operatorVariant === operatorVariant &&
          entry.operatorRole === "BRANCH_SELECTOR",
      );
      const value = OPERATOR_SUPPORT_MATRIX.find(
        (entry) =>
          entry.operatorVariant === operatorVariant &&
          entry.operatorRole === "BRANCH_VALUE",
      );
      expect(selector?.effectKind).toBe("BRANCH_SELECTION");
      expect(selector?.localEdgeKind).toBe("EXPRESSION_CONTROL");
      expect(value?.effectKind).toBe("VALUE_CONTRIBUTION");
      expect(value?.localEdgeKind).toBe("VALUE_FLOW");
    }
  });

  it("models all join types and window frame context explicitly", () => {
    for (const operatorVariant of [
      "INNER",
      "LEFT",
      "RIGHT",
      "FULL",
      "SEMI",
      "ANTI",
    ] as const) {
      expect(
        OPERATOR_SUPPORT_MATRIX.some(
          (entry) =>
            entry.operatorKind === "JOIN" &&
            entry.operatorVariant === operatorVariant,
        ),
      ).toBe(true);
    }
    const frame = OPERATOR_SUPPORT_MATRIX.find(
      (entry) =>
        entry.operatorKind === "WINDOW" &&
        entry.operatorVariant === "WINDOW_FRAME",
    );
    expect(frame?.effectKind).toBe("WINDOW_CONTEXT");
    expect(frame?.localEdgeKind).toBe("WINDOW_CONTEXT");
  });

  it("fails closed for an unmodeled valid cell without borrowing another rule", () => {
    const query = {
      operatorKind: "PROJECT" as const,
      operatorVariant: "CASE" as const,
      operatorRole: "PREDICATE" as const,
      subjectKind: "PHYSICAL_FIELD" as const,
      effectKind: "ROW_MEMBERSHIP" as const,
      localEdgeKind: "ROWSET_CONTROL" as const,
    };
    const result = lookupOperatorSupport(query);

    expect(result.matched).toBe(false);
    expect(result.cell.status).toBe("UNSUPPORTED");
    expect(result.cell.reasonCode).toBe("UNMODELED_CELL");
    expect(result.gap?.status).toBe("UNSUPPORTED");
    expect(result.gap?.reasonCode).toBe("UNMODELED_CELL");
    expect(result.cell.effectKind).toBe("ROW_MEMBERSHIP");
  });

  it("returns UNKNOWN for an unrecognized dimension and never treats it as unrelated", () => {
    const query = {
      operatorKind: "PROJECT" as const,
      operatorVariant: "NOT_A_REAL_OPERATOR" as never,
      operatorRole: "VALUE" as const,
      subjectKind: "PHYSICAL_FIELD" as const,
      effectKind: "VALUE_CONTRIBUTION" as const,
      localEdgeKind: "VALUE_FLOW" as const,
    };
    const result = lookupOperatorSupport(query);

    expect(result.matched).toBe(false);
    expect(result.cell.status).toBe("UNKNOWN");
    expect(result.gap?.reasonCode).toBe("UNKNOWN_OPERATOR_OR_ROLE");
    expect(result.cell.status).not.toBe("SUPPORTED");
  });

  it("has unique deterministic cells and no predeclared fail-open entries", () => {
    expect(validateOperatorSupportMatrix()).toEqual([]);
    const keys = OPERATOR_SUPPORT_MATRIX.map(operatorSupportMatrixKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keeps canonical SQL fixtures for every declared operator variant", () => {
    const covered = new Set(
      representativeOperatorSqlCorpus.flatMap((fixture) => fixture.covers),
    );
    const matrixVariants = new Set(
      OPERATOR_SUPPORT_MATRIX.map((entry) => entry.operatorVariant),
    );
    expect(representativeOperatorSqlCorpus.every((fixture) => fixture.sql.length > 0)).toBe(
      true,
    );
    expect([...matrixVariants].filter((variant) => !covered.has(variant))).toEqual([
      "COLUMN_EXPRESSION",
    ]);
  });
});
