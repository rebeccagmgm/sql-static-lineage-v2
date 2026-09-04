import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createTaskPackDocumentReader } from "../../scripts/reconcile/consumer/target-table-upstream-causal-closure/reconcile-target-table-causal-closure.ts";
import { inferTaskDefaultSchema } from "../../scripts/reconcile/shared/task-default-schema.ts";

function writePack(
  dataRoot: string,
  category: string,
  taskId: string,
  document: Record<string, unknown>,
): void {
  const dir = join(dataRoot, "tasks", category, taskId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "task.json"), `${JSON.stringify(document, null, 2)}\n`, "utf8");
}

describe("createTaskPackDocumentReader", () => {
  it("loads hiveTask-2.0 packs so consumer defaultSchema is not null", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "closure-task-pack-"));
    writePack(dataRoot, "hiveTask-2.0", "119044", {
      schemaVersion: "1.0.0",
      taskId: "119044",
      taskCategory: "hiveTask-2.0",
      taskName: "PDATA_N.T98_SB_OTC_OPT_COMP_INFO",
      target: {
        platform: "hive",
        dataSource: "gfhive",
        qualifiedName: "pdata_n.t98_sb_otc_opt_comp_info",
      },
      contentHash: "fixture",
    });

    const taskJson = createTaskPackDocumentReader(dataRoot);
    const document = taskJson("119044");

    expect(document.taskId).toBe("119044");
    expect(inferTaskDefaultSchema(document)).toEqual({
      schema: "pdata_n",
      evidenceSources: ["TASK_NAME", "TASK_TARGET"],
    });
  });

  it("loads hiveTask packs and does not require sparkIndex", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "closure-task-pack-"));
    writePack(dataRoot, "hiveTask", "103937", {
      schemaVersion: "1.0.0",
      taskId: "103937",
      taskCategory: "hiveTask",
      taskName: "PDATA_N.T03_AGT_STAT_H_TIT156",
      target: {
        platform: "hive",
        dataSource: "gfhive",
        qualifiedName: "pdata_n.t03_agt_stat_h",
      },
      contentHash: "fixture",
    });

    const taskJson = createTaskPackDocumentReader(dataRoot);
    expect(inferTaskDefaultSchema(taskJson("103937"))?.schema).toBe("pdata_n");
    expect(taskJson("missing")).toEqual({});
  });
});
