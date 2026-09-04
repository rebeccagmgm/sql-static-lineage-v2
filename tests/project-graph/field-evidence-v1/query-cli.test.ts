import { describe, expect, it } from "vitest";

import {
  fieldEvidenceGoldenRequired,
  fieldEvidenceQueryRoots,
} from "../../../scripts/project-graph/field-evidence-v1/impact-query-harness.ts";
import { runFieldEvidenceQuery } from "../../../scripts/project-graph/field-evidence-v1/query-cli.ts";
import { validateFieldImpactResult } from "../../../scripts/project-graph/field-evidence-v1/impact-result-contract.ts";

const roots = fieldEvidenceQueryRoots();
if (!roots && fieldEvidenceGoldenRequired()) {
  throw new Error("FIELD_EVIDENCE_GOLDEN_REQUIRED but field-facts or INDEX path is missing");
}
const describeGolden = roots ? describe : describe.skip;

describeGolden("field-evidence query cli", () => {
  it("returns valid FIELD_IMPACT_RESULT for a Greek anchor column", () => {
    const taskId = process.env.FIELD_EVIDENCE_QUERY_TASK_ID?.trim() ?? "176827";
    const outputColumn = process.env.FIELD_EVIDENCE_QUERY_COLUMN?.trim() ?? "gamma";
    const result = runFieldEvidenceQuery({ taskId, outputColumn });

    expect(result.artifactType).toBe("FIELD_IMPACT_RESULT");
    expect(result.schemaVersion).toBe("1.1.0");
    expect(result.anchor.taskId).toBe(taskId);
    expect(result.anchor.outputColumn).toBe(outputColumn);
    expect(Array.isArray(result.value)).toBe(true);
    expect(Array.isArray(result.control)).toBe(true);
    expect(Array.isArray(result.frontier)).toBe(true);
    expect(Array.isArray(result.gaps)).toBe(true);
    validateFieldImpactResult(result);
  }, 120_000);
});
