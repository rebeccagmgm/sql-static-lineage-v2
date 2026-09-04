import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runInputPackMachineFacts } from "../../../scripts/machine-facts/input-pack-machine-facts.ts";
import { canonicalJson, sha256 } from "../../../scripts/machine-facts/machine-facts-contract.ts";
import { hashJsonlStore, readJsonlRecords, writeCanonicalJsonl } from "../../../scripts/machine-facts/jsonl-store.ts";
import {
  writeTableInput,
  writeTaskInput,
} from "../../../scripts/input/shared/input-pack.ts";
import {
  writeHoraeRelationCache,
  writeHoraeTaskTypeCache,
} from "../../../scripts/reconcile/consumer/one-hop/schedule-evidence-cache.ts";
import { summarizeTaskLocalBatch } from "../../../scripts/project-graph/task-local/contract.ts";
import { failureReasonFromLoad } from "../../../scripts/project-graph/task-local/coverage.ts";
import { projectTaskLocal } from "../../../scripts/project-graph/task-local/project-task-local.ts";
import { projectTaskLocalBatch } from "../../../scripts/project-graph/task-local/project-task-local-batch.ts";
import { readTaskScheduleContext } from "../../../scripts/project-graph/task-local/schedule-context.ts";
import type { CurrentBundleLoad } from "../../../scripts/query/current-task-bundle.ts";

function setupProjectedTask(): { dataRoot: string; factsRoot: string } {
  const parent = mkdtempSync(join(tmpdir(), "task-local-coverage-projected-"));
  const dataRoot = join(parent, "data");
  const factsRoot = join(parent, "facts");
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
  return { dataRoot, factsRoot };
}

function refreshAttestation(factsRoot: string, taskId: string): void {
  const bundle = join(factsRoot, "registry", "tasks", taskId, "bundle");
  const manifestPath = join(bundle, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    outputs: Array<Record<string, unknown>>;
  };
  manifest.outputs = manifest.outputs.map((output) => {
    const path = String(output.path);
    const logical = join(bundle, path);
    if (path.endsWith(".jsonl")) {
      const rows = readJsonlRecords(logical);
      return {
        ...output,
        content_sha256: hashJsonlStore(logical),
        row_count: rows.length,
      };
    }
    const bytes = readFileSync(logical);
    return {
      ...output,
      content_sha256: sha256(bytes),
    };
  });
  writeFileSync(manifestPath, canonicalJson(manifest), "utf8");
  const manifestHash = sha256(readFileSync(manifestPath));
  const statusPath = join(factsRoot, "registry", "tasks", taskId, "analysis-status.json");
  const status = JSON.parse(readFileSync(statusPath, "utf8")) as Record<string, unknown>;
  status.current_manifest_sha256 = manifestHash;
  writeFileSync(statusPath, canonicalJson(status), "utf8");
  const indexPath = join(factsRoot, "indexes", "task-fact-index.jsonl");
  const rows = readFileSync(indexPath, "utf8")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  writeFileSync(
    indexPath,
    `${rows
      .map((row) =>
        canonicalJson(row.task_id === taskId ? { ...row, manifest_sha256: manifestHash } : row),
      )
      .join("\n")}\n`,
    "utf8",
  );
}

function stripWriteRecords(factsRoot: string, taskId: string): void {
  const datasetIoPath = join(
    factsRoot,
    "registry",
    "tasks",
    taskId,
    "bundle",
    "dataset-io.jsonl",
  );
  const kept = readJsonlRecords(datasetIoPath).filter(
    (record) => String(record.direction ?? "").toUpperCase() !== "WRITE",
  );
  writeCanonicalJsonl(datasetIoPath, kept);
  refreshAttestation(factsRoot, taskId);
}

describe("task-local coverage states", () => {
  it("returns SCHEDULE_ONLY when schedule cache exists but Facts are unavailable", () => {
    const cacheRoot = mkdtempSync(join(tmpdir(), "task-local-schedule-only-"));
    const factsRoot = mkdtempSync(join(tmpdir(), "task-local-no-facts-"));
    const dataRoot = mkdtempSync(join(tmpdir(), "task-local-no-pack-"));
    writeHoraeTaskTypeCache(
      "888001",
      "2026-09-02T00:00:00.000Z",
      { taskName: "schedule.only.task", topicName: "DM_RSK_N" },
      cacheRoot,
    );
    writeHoraeRelationCache(
      "888001",
      "2026-09-02T00:00:00.000Z",
      [{ task_id: "119044", task_name: "upstream.task" }],
      cacheRoot,
      "up",
    );

    const schedule = readTaskScheduleContext("888001", cacheRoot);
    expect(schedule?.scheduleUpstreamTaskIds).toEqual(["119044"]);
    expect(schedule?.scheduleDownstreamTaskIds).toEqual([]);
    expect(schedule?.scheduleReference).toMatchObject({
      role: "SCHEDULE_REFERENCE_ONLY",
      upstreamTaskIds: ["119044"],
      downstreamTaskIds: [],
      source: "schedule-evidence-cache",
    });

    const projection = projectTaskLocal({
      dataRoot,
      factsRoot,
      scheduleCacheRoot: cacheRoot,
      taskId: "888001",
      generatedAt: "2026-09-02T00:00:00.000Z",
    });
    expect(projection.coverageStatus).toBe("SCHEDULE_ONLY");
    expect(projection.failureReasonCode).toBeNull();
    expect(projection.edges).toHaveLength(0);
    expect(projection.nodes).toHaveLength(1);
    expect(projection.nodes[0]?.properties.scheduleReference).toMatchObject({
      role: "SCHEDULE_REFERENCE_ONLY",
      upstreamTaskIds: ["119044"],
      topicName: "DM_RSK_N",
    });
    expect(projection.nodes[0]?.properties.topicName).toBe("DM_RSK_N");
  });

  it("returns COLLECTION_FAILED when neither Facts nor schedule cache exist", () => {
    const projection = projectTaskLocal({
      dataRoot: mkdtempSync(join(tmpdir(), "task-local-empty-data-")),
      factsRoot: mkdtempSync(join(tmpdir(), "task-local-empty-facts-")),
      taskId: "777001",
      generatedAt: "2026-09-02T00:00:00.000Z",
    });
    expect(projection.coverageStatus).toBe("COLLECTION_FAILED");
    expect(projection.failureReasonCode).toBe("FACTS_UNAVAILABLE");
    expect(projection.edges).toHaveLength(0);
  });

  it("returns COLLECTION_FAILED / NO_RESOLVED_WRITE when Facts have no WRITE", () => {
    const { dataRoot, factsRoot } = setupProjectedTask();
    stripWriteRecords(factsRoot, "105387");
    const projection = projectTaskLocal({
      dataRoot,
      factsRoot,
      taskId: "105387",
      generatedAt: "2026-09-02T00:00:00.000Z",
    });
    expect(projection.coverageStatus).toBe("COLLECTION_FAILED");
    expect(projection.failureReasonCode).toBe("NO_RESOLVED_WRITE");
    expect(projection.edges).toHaveLength(0);
    expect(projection.nodes).toEqual([
      expect.objectContaining({
        nodeId: "task:105387",
        nodeType: "TASK",
      }),
    ]);
  });

  it("returns COLLECTION_FAILED / SCHEMA_UNRESOLVED when bindings exist without target schema", () => {
    const { factsRoot } = setupProjectedTask();
    const projection = projectTaskLocal({
      dataRoot: mkdtempSync(join(tmpdir(), "task-local-no-pack-")),
      factsRoot,
      taskId: "105387",
      generatedAt: "2026-09-02T00:00:00.000Z",
    });
    expect(projection.coverageStatus).toBe("COLLECTION_FAILED");
    expect(projection.failureReasonCode).toBe("SCHEMA_UNRESOLVED");
    expect(projection.edges).toHaveLength(0);
  });

  it("maps STALE and INVALID load states to typed failure reasons", () => {
    const base = {
      factsRoot: "facts",
      taskId: "x",
      bundleDir: "",
      indexPath: "",
      statusPath: "",
      records: {},
      evidence: {},
    } as const;
    expect(
      failureReasonFromLoad({
        ...base,
        state: "STALE",
        issues: ["TASK_NOT_INDEXED"],
      } as CurrentBundleLoad),
    ).toBe("FACTS_UNAVAILABLE");
    expect(
      failureReasonFromLoad({
        ...base,
        state: "STALE",
        issues: ["MANIFEST_HASH_MISMATCH"],
      } as CurrentBundleLoad),
    ).toBe("FACTS_STALE");
    expect(
      failureReasonFromLoad({
        ...base,
        state: "INVALID",
        issues: ["INDEX_HASH_INVALID"],
      } as CurrentBundleLoad),
    ).toBe("FACTS_INVALID");
  });

  it("summarizes a mixed batch while keeping projected tasks green", () => {
    const { dataRoot, factsRoot } = setupProjectedTask();
    const cacheRoot = mkdtempSync(join(tmpdir(), "task-local-batch-schedule-"));
    writeHoraeTaskTypeCache(
      "888002",
      "2026-09-02T00:00:00.000Z",
      { taskName: "schedule.only.batch", topicName: "DM_RSK_N" },
      cacheRoot,
    );

    const batch = projectTaskLocalBatch({
      dataRoot,
      factsRoot,
      scheduleCacheRoot: cacheRoot,
      taskIds: ["105387", "888002", "777002"],
      generatedAt: "2026-09-02T00:00:00.000Z",
    });

    expect(batch.summary).toEqual({
      total: 3,
      projected: 1,
      scheduleOnly: 1,
      collectionFailed: 1,
      byFailureReason: { FACTS_UNAVAILABLE: 1 },
    });
    expect(summarizeTaskLocalBatch(batch.projections)).toEqual(batch.summary);

    const byTaskId = new Map(batch.projections.map((projection) => [projection.taskId, projection]));
    expect(byTaskId.get("105387")?.coverageStatus).toBe("PROJECTED");
    expect(byTaskId.get("888002")?.coverageStatus).toBe("SCHEDULE_ONLY");
    expect(byTaskId.get("777002")?.coverageStatus).toBe("COLLECTION_FAILED");
    expect(byTaskId.get("777002")?.failureReasonCode).toBe("FACTS_UNAVAILABLE");
  });
});
