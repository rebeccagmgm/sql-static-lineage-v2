import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runInputPackMachineFacts } from "../../../scripts/machine-facts/input-pack-machine-facts.ts";
import { sha256 } from "../../../scripts/machine-facts/machine-facts-contract.ts";
import {
  writeTableInput,
  writeTaskInput,
} from "../../../scripts/input/shared/input-pack.ts";
import { projectTaskLocalBatch } from "../../../scripts/project-graph/task-local/project-task-local-batch.ts";
import {
  packContentHashForTask,
  projectionBytesEqualIgnoringGeneratedAt,
  resolveTaskLocalCacheKeyParts,
  taskLocalCacheKey,
} from "../../../scripts/project-graph/task-local/projection-cache.ts";

function writeDemoTables(dataRoot: string): void {
  for (const table of [
    { qualifiedName: "demo.stati", columns: "internal_trade_id STRING, stati_cont_desc STRING" },
    { qualifiedName: "demo.trades", columns: "internal_trade_id STRING, v STRING" },
  ]) {
    writeTableInput(dataRoot, {
      platform: "hive",
      dataSource: "warehouse",
      qualifiedName: table.qualifiedName,
      objectType: "hive_table",
      partitionFields: [],
      ddl: `CREATE TABLE ${table.qualifiedName} (${table.columns});`,
      evidenceProvider: "synthetic:test",
      collectedAt: "2026-01-01T00:00:00.000Z",
    });
  }
}

function writeDemoTask(dataRoot: string, taskId: string): void {
  writeTaskInput(dataRoot, {
    taskId,
    taskCategory: "sparkIndex",
    taskName: `demo.stati.${taskId}`,
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
}

function setupProjectedTasks(taskIds: readonly string[]): {
  dataRoot: string;
  factsRoot: string;
} {
  const parent = mkdtempSync(join(tmpdir(), "task-local-cache-"));
  const dataRoot = join(parent, "data");
  const factsRoot = join(parent, "facts");
  writeDemoTables(dataRoot);
  for (const taskId of taskIds) writeDemoTask(dataRoot, taskId);
  runInputPackMachineFacts({
    dataRoot,
    taskIds: [...taskIds],
    outputRoot: factsRoot,
  });
  return { dataRoot, factsRoot };
}

function mutatePackContentHash(dataRoot: string, taskId: string): string {
  const packPath = join(dataRoot, "tasks", "sparkIndex", taskId, "task.json");
  const document = JSON.parse(readFileSync(packPath, "utf8")) as Record<string, unknown>;
  document.contentHash = sha256(`mutated-pack:${taskId}:${String(document.contentHash)}`);
  writeFileSync(packPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  return String(document.contentHash);
}

describe("task-local projection cache (TL-4)", () => {
  it("hits every unchanged task on the second batch", () => {
    const { dataRoot, factsRoot } = setupProjectedTasks(["105387"]);
    const outputRoot = mkdtempSync(join(tmpdir(), "task-local-cache-out-"));
    const first = projectTaskLocalBatch({
      dataRoot,
      factsRoot,
      taskIds: ["105387"],
      outputRoot,
      generatedAt: "2026-09-02T00:00:00.000Z",
    });
    expect(first.cache).toEqual({ hits: 0, misses: 1 });
    expect(first.results[0]?.cacheHit).toBe(false);

    const second = projectTaskLocalBatch({
      dataRoot,
      factsRoot,
      taskIds: ["105387"],
      outputRoot,
      generatedAt: "2026-09-02T01:00:00.000Z",
    });
    expect(second.cache).toEqual({ hits: 1, misses: 0 });
    expect(second.results[0]?.cacheHit).toBe(true);
    expect(
      projectionBytesEqualIgnoringGeneratedAt(
        first.projections[0]!,
        second.projections[0]!,
      ),
    ).toBe(true);
    expect(second.projections[0]?.generatedAt).toBe(first.projections[0]?.generatedAt);
  });

  it("misses only the task whose pack content hash changed", () => {
    const { dataRoot, factsRoot } = setupProjectedTasks(["200001", "200002"]);
    const outputRoot = mkdtempSync(join(tmpdir(), "task-local-cache-multi-out-"));
    const warm = projectTaskLocalBatch({
      dataRoot,
      factsRoot,
      taskIds: ["200001", "200002"],
      outputRoot,
      generatedAt: "2026-09-02T00:00:00.000Z",
    });
    expect(warm.cache).toEqual({ hits: 0, misses: 2 });

    mutatePackContentHash(dataRoot, "200001");
    const again = projectTaskLocalBatch({
      dataRoot,
      factsRoot,
      taskIds: ["200001", "200002"],
      outputRoot,
      generatedAt: "2026-09-02T01:00:00.000Z",
    });
    expect(again.cache).toEqual({ hits: 1, misses: 1 });
    const byTask = new Map(again.results.map((result) => [result.taskId, result]));
    expect(byTask.get("200001")?.cacheHit).toBe(false);
    expect(byTask.get("200002")?.cacheHit).toBe(true);
  });

  it("includes pack hash, facts fingerprint, and schema version in the cache key", () => {
    const { dataRoot, factsRoot } = setupProjectedTasks(["300001"]);
    const before = resolveTaskLocalCacheKeyParts({
      taskId: "300001",
      dataRoot,
      factsRoot,
    });
    expect(before.schemaVersion).toBe("1.3.0");
    expect(before.packContentHash).toBe(packContentHashForTask(dataRoot, "300001"));
    expect(before.factsManifestSha256).not.toBe("NO_FACTS");

    const beforeKey = taskLocalCacheKey(before);
    expect(
      taskLocalCacheKey({
        ...before,
        schemaVersion: "9.9.9" as typeof before.schemaVersion,
      }),
    ).not.toBe(beforeKey);

    mutatePackContentHash(dataRoot, "300001");
    const afterPack = resolveTaskLocalCacheKeyParts({
      taskId: "300001",
      dataRoot,
      factsRoot,
    });
    expect(afterPack.packContentHash).not.toBe(before.packContentHash);
    expect(taskLocalCacheKey(afterPack)).not.toBe(beforeKey);
  });
});
