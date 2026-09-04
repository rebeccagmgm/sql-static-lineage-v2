import { describe, expect, it } from "vitest";

import { runFieldEvidenceStopLoss } from "../../../scripts/project-graph/field-evidence-v1/stop-loss-cli.ts";
import {
  fieldEvidenceGoldenRequired,
  fieldEvidenceQueryRoots,
} from "../../../scripts/project-graph/field-evidence-v1/impact-query-harness.ts";

const roots = fieldEvidenceQueryRoots();
if (!roots && fieldEvidenceGoldenRequired()) {
  throw new Error("FIELD_EVIDENCE_GOLDEN_REQUIRED but field-facts or INDEX path is missing");
}
const describeGolden = roots ? describe : describe.skip;

describeGolden("field-evidence stop-loss", () => {
  it("emits confirmedTwoHopRatio, dominantGap, and decision", () => {
    const taskId = process.env.FIELD_EVIDENCE_STOP_LOSS_TASK_ID?.trim() ?? "176827";
    const report = runFieldEvidenceStopLoss(taskId);
    expect(report.confirmedTwoHopRatio).toBeGreaterThanOrEqual(0);
    expect(report.confirmedTwoHopRatio).toBeLessThanOrEqual(1);
    expect([
      "GO_PHASE3",
      "WAIT_WP8",
      "BACKFILL_FACTS",
      "FIX_PHASE1",
    ]).toContain(report.decision);
    expect(report.columns).toHaveLength(10);
  }, 600_000);
});
