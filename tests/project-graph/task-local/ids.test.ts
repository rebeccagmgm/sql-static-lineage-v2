import { describe, expect, it } from "vitest";

import {
  fieldEvidencePhysicalFieldNodeId,
  physicalDatasetNodeId,
  targetWriteNodeId,
  taskNodeId,
} from "../../../scripts/project-graph/task-local/ids.ts";

/** Frozen from data-graph reference run (2026-09-02). */
const FROZEN = {
  task176827: "task:176827",
  dataset176827: "dataset:9361065f311a6e6136facf6a6681538348d23e2adfac61c19e3d12db93c2b8ab",
  targetWrite176827: "target-write:2cd94595d05a823e44cef54d899d7206327031f30021d701647499c782fd1a48",
  refTrsKey: "physical-field:0307273847f1eae41dd4f40443879ad3fe57481ddca3d97af21a3c13259c85fc",
} as const;

describe("task-local ids (data-graph parity)", () => {
  it("freezes task, dataset, target-write, and physical-field vectors", () => {
    expect(taskNodeId("176827")).toBe(FROZEN.task176827);
    expect(
      physicalDatasetNodeId({
        platform: "hive",
        dataSource: "gfhive",
        qualifiedName: "dm_rsk_n.otc_opt_greek_val_det_h",
      }),
    ).toBe(FROZEN.dataset176827);
    expect(
      targetWriteNodeId({
        taskId: "176827",
        datasetNodeId: FROZEN.dataset176827,
        writeObservationId: "write-observation:176827:platform-target:0",
      }),
    ).toBe(FROZEN.targetWrite176827);
    expect(
      fieldEvidencePhysicalFieldNodeId({
        platform: "hive",
        dataSource: "gfhive",
        stableTableId: "odata_n_tit.d_ref_trs__gfhive",
        qualifiedName: "odata_n_tit.d_ref_trs",
        column: "key_otc_trade_id",
      }),
    ).toBe(FROZEN.refTrsKey);
  });

  it("requires stableTableId in the physical-field identity tuple", () => {
    const withStable = fieldEvidencePhysicalFieldNodeId({
      platform: "hive",
      dataSource: "gfhive",
      stableTableId: "odata_n_tit.d_ref_trs__gfhive",
      qualifiedName: "odata_n_tit.d_ref_trs",
      column: "key_otc_trade_id",
    });
    const withoutStable = fieldEvidencePhysicalFieldNodeId({
      platform: "hive",
      dataSource: "gfhive",
      stableTableId: "odata_n_tit.d_ref_trs",
      qualifiedName: "odata_n_tit.d_ref_trs",
      column: "key_otc_trade_id",
    });
    expect(withStable).not.toBe(withoutStable);
  });
});
