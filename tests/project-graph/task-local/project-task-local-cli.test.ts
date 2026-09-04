import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runInputPackMachineFacts } from "../../../scripts/machine-facts/input-pack-machine-facts.ts";
import {
  writeTableInput,
  writeTaskInput,
} from "../../../scripts/input/shared/input-pack.ts";
import {
  writeHoraeRelationCache,
  writeHoraeTaskTypeCache,
} from "../../../scripts/reconcile/consumer/one-hop/schedule-evidence-cache.ts";
import { selectTaskLocalBatchTaskIds } from "../../../scripts/project-graph/task-local/batch-selection.ts";
import {
  parseProjectTaskLocalCli,
  runProjectTaskLocalCli,
} from "../../../scripts/project-graph/task-local/project-task-local-cli.ts";

function seedScheduleCache(cacheRoot: string): void {
  writeHoraeTaskTypeCache(
    "176827",
    "2026-09-02T00:00:00.000Z",
    { taskName: "dm_rsk.task", topicName: "DM_RSK_N" },
    cacheRoot,
  );
  writeHoraeRelationCache(
    "176827",
    "2026-09-02T00:00:00.000Z",
    [{ task_id: "119044" }],
    cacheRoot,
    "up",
  );
  writeHoraeTaskTypeCache(
    "999001",
    "2026-09-02T00:00:00.000Z",
    { taskName: "other.topic.task", topicName: "OTHER_TOPIC" },
    cacheRoot,
  );
  writeHoraeTaskTypeCache(
    "105387",
    "2026-09-02T00:00:00.000Z",
    { taskName: "edw.agt.task", topicName: "EDW_AGT" },
    cacheRoot,
  );
  writeHoraeTaskTypeCache(
    "119044",
    "2026-09-02T00:00:00.000Z",
    { taskName: "pdata.t98.task", topicName: "PDATA_N" },
    cacheRoot,
  );
}

describe("task-local batch CLI (TL-5)", () => {
  it("selects topic tasks and always includes also-task-ids", () => {
    const cacheRoot = mkdtempSync(join(tmpdir(), "task-local-cli-select-"));
    seedScheduleCache(cacheRoot);
    const selection = selectTaskLocalBatchTaskIds({
      scheduleCacheRoot: cacheRoot,
      topic: "DM_RSK_N",
      alsoTaskIds: ["105387", "119044"],
    });
    expect(selection.topicTaskIds).toEqual(["176827"]);
    expect(selection.alsoTaskIds).toEqual(["105387", "119044"]);
    expect(selection.taskIds).toEqual(["105387", "119044", "176827"]);
  });

  it("selects explicit task-ids without topic scan", () => {
    const cacheRoot = mkdtempSync(join(tmpdir(), "task-local-cli-anchor-"));
    seedScheduleCache(cacheRoot);
    const selection = selectTaskLocalBatchTaskIds({
      scheduleCacheRoot: cacheRoot,
      taskIds: ["181058", "176827", "209119", "155015"],
    });
    expect(selection.anchorTaskIds).toEqual(["155015", "176827", "181058", "209119"]);
    expect(selection.topicTaskIds).toEqual([]);
    expect(selection.taskIds).toEqual(["155015", "176827", "181058", "209119"]);
  });

  it("parses anchor and expand-upstream flags", () => {
    const options = parseProjectTaskLocalCli([
      "--data-root", "D:/data",
      "--facts-root", "D:/facts",
      "--schedule-cache", "D:/cache",
      "--task-ids", "181058,176827",
      "--expand-upstream",
      "--max-upstream-depth", "12",
      "--output-root", "D:/out",
    ]);
    expect(options.taskIds).toEqual(["181058", "176827"]);
    expect(options.expandUpstream).toBe(true);
    expect(options.maxUpstreamDepth).toBe(12);
  });

  it("parses CLI flags and rejects prepare-facts", () => {
    const options = parseProjectTaskLocalCli([
      "--data-root", "D:/data",
      "--facts-root", "D:/facts",
      "--schedule-cache", "D:/cache",
      "--topic", "DM_RSK_N",
      "--also-task-ids", "105387,119044",
      "--output-root", "D:/out",
      "--no-prepare-facts",
    ]);
    expect(options.topic).toBe("DM_RSK_N");
    expect(options.alsoTaskIds).toEqual(["105387", "119044"]);
    expect(options.prepareFacts).toBe(false);
    expect(() => parseProjectTaskLocalCli([
      "--data-root", "D:/data",
      "--facts-root", "D:/facts",
      "--schedule-cache", "D:/cache",
      "--output-root", "D:/out",
      "--topic", "DM_RSK_N",
      "--prepare-facts",
    ])).toThrow(/PREPARE_FACTS_UNSUPPORTED/);
  });

  it("writes projections under output-root and a batch manifest including also-task-ids", () => {
    const parent = mkdtempSync(join(tmpdir(), "task-local-cli-run-"));
    const dataRoot = join(parent, "data");
    const factsRoot = join(parent, "facts");
    const cacheRoot = join(parent, "cache");
    const outputRoot = join(parent, "project-graph");
    seedScheduleCache(cacheRoot);

    writeTableInput(dataRoot, {
      platform: "hive",
      dataSource: "warehouse",
      qualifiedName: "demo.stati",
      objectType: "hive_table",
      partitionFields: [],
      ddl: "CREATE TABLE demo.stati (internal_trade_id STRING, stati_cont_desc STRING);",
      evidenceProvider: "synthetic:test",
      collectedAt: "2026-01-01T00:00:00.000Z",
    });
    writeTableInput(dataRoot, {
      platform: "hive",
      dataSource: "warehouse",
      qualifiedName: "demo.trades",
      objectType: "hive_table",
      partitionFields: [],
      ddl: "CREATE TABLE demo.trades (internal_trade_id STRING, v STRING);",
      evidenceProvider: "synthetic:test",
      collectedAt: "2026-01-01T00:00:00.000Z",
    });
    writeTaskInput(dataRoot, {
      taskId: "105387",
      taskCategory: "sparkIndex",
      taskName: "demo.stati.task",
      target: {
        platform: "hive",
        dataSource: "warehouse",
        qualifiedName: "demo.stati",
      },
      targetEvidenceKind: "DIRECT_PLATFORM_TARGET",
      partition: null,
      sql: {
        query: {
          content:
            "INSERT OVERWRITE TABLE demo.stati SELECT t.internal_trade_id AS internal_trade_id, t.v AS stati_cont_desc FROM demo.trades t",
          evidenceProvider: "synthetic:test",
        },
      },
      evidenceProvider: "synthetic:test",
      collectedAt: "2026-01-01T00:00:00.000Z",
    });
    runInputPackMachineFacts({
      dataRoot,
      taskIds: ["105387"],
      outputRoot: factsRoot,
    });

    const result = runProjectTaskLocalCli({
      dataRoot,
      factsRoot,
      scheduleCacheRoot: cacheRoot,
      outputRoot,
      topic: "DM_RSK_N",
      taskIds: [],
      expandUpstream: false,
      alsoTaskIds: ["105387", "119044"],
      prepareFacts: false,
      generatedAt: "2026-09-02T00:00:00.000Z",
    });

    expect(result.taskIds).toEqual(["105387", "119044", "176827"]);
    expect(existsSync(join(outputRoot, "tasks", "105387", "task-local-projection.json"))).toBe(true);
    expect(existsSync(join(outputRoot, "tasks", "119044", "task-local-projection.json"))).toBe(true);
    expect(existsSync(join(outputRoot, "tasks", "176827", "task-local-projection.json"))).toBe(true);
    expect(existsSync(result.batchManifestPath)).toBe(true);

    const manifest = JSON.parse(readFileSync(result.batchManifestPath, "utf8")) as {
      topic: string;
      alsoTaskIds: string[];
      tasks: Array<{ taskId: string; coverageStatus: string }>;
    };
    expect(manifest.topic).toBe("DM_RSK_N");
    expect(manifest.alsoTaskIds).toEqual(["105387", "119044"]);
    const byTask = new Map(manifest.tasks.map((task) => [task.taskId, task.coverageStatus]));
    expect(byTask.get("105387")).toBe("PROJECTED");
    expect(byTask.get("119044")).toBe("SCHEDULE_ONLY");
    expect(byTask.get("176827")).toBe("SCHEDULE_ONLY");
    expect(outputRoot.includes("artifacts/tasks")).toBe(false);
  });
});
