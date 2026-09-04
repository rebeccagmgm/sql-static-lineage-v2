import { describe, expect, it } from "vitest";

import { projectTaskLocal } from "../../../scripts/project-graph/task-local/project-task-local.ts";
import { fieldEvidenceGoldenRoots } from "./golden-roots.ts";

const roots = fieldEvidenceGoldenRoots();
const describeGolden = roots ? describe : describe.skip;

/**
 * FE-1′ shape golden for task 181058 temp-table field break (§5.4).
 * Frozen counts (7 columns / 42 edges / 6 writes) are intentional regression anchors,
 * not generic §5.5 invariants — see phase1-acceptance.test.ts for contract invariants.
 */
describeGolden("task-local materialization field breaks", () => {
  it("aggregates 181058 temp-table reads into one materialization gap", () => {
    const projection = projectTaskLocal({
      factsRoot: roots!.factsRoot,
      dataRoot: roots!.dataRoot,
      taskId: "181058",
    });
    const breaks = projection.gaps?.filter(
      (gap) => gap.reasonCode === "TASK_LOCAL_MATERIALIZATION_FIELD_BREAK",
    ) ?? [];
    expect(breaks).toHaveLength(1);
    const details = breaks[0]!.details;
    expect(details.columns).toHaveLength(7);
    expect(details.affectedEdgeCount).toBe(42);
    expect(details.writeObservationIds).toHaveLength(6);
  }, 180_000);
});
