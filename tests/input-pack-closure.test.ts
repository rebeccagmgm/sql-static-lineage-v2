import { mkdtempSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import { writeTableInput, writeTaskInput } from "../scripts/input/shared/input-pack.ts";
import { runInputPackMachineFacts } from "../scripts/machine-facts/input-pack-machine-facts.ts";
import { defaultWriterCatalogPath } from "../scripts/query/writer-catalog.ts";
import { inputPackTaskBatches } from "../scripts/reconcile/consumer/one-hop/reconcile-one-hop-autofill.ts";
import {
  runInputPackClosure,
  runProjectInputPackClosure,
} from "../scripts/pipeline/input-pack-closure.ts";

const FIXED_NOW = "2026-08-27T00:00:00.000Z";

function root(): string {
  return mkdtempSync(join(tmpdir(), "sql-lineage-input-pack-closure-"));
}

function writerCatalogPathFor(dataRoot: string): string {
  return defaultWriterCatalogPath(dataRoot);
}

function indexWritersFromFacts(
  dataRoot: string,
  factsRoot: string,
  taskIds: readonly string[],
): void {
  runInputPackMachineFacts({
    dataRoot,
    outputRoot: factsRoot,
    taskIds,
    writerCatalogPath: writerCatalogPathFor(dataRoot),
  });
}

function writeTable(rootPath: string, qualifiedName: string): void {
  const [schema, name] = qualifiedName.split(".");
  writeTableInput(rootPath, {
    platform: "hive",
    dataSource: "gfhive",
    qualifiedName,
    schema,
    name,
    objectType: "TABLE",
    ddl: `CREATE TABLE ${qualifiedName} (id bigint)`,
    evidenceProvider: "fixture:table",
    collectedAt: FIXED_NOW,
  });
}

function writeTask(rootPath: string, taskId: string, sql: string, target?: string): void {
  writeTaskInput(rootPath, {
    taskId,
    taskCategory: "hiveTask-2.0",
    collectedAt: FIXED_NOW,
    evidenceProvider: "fixture:task",
    ...(target
      ? {
          target: {
            platform: "hive",
            dataSource: "gfhive",
            qualifiedName: target,
          },
          targetEvidenceKind: "DIRECT_PLATFORM_TARGET" as const,
          writeMode: "OVERWRITE" as const,
        }
      : {}),
    sql: {
      query: {
        content: sql,
        evidenceProvider: "fixture:sql",
      },
    },
  });
}

describe("input pack closure", () => {
  it("splits collection requests at the collector hard limit", () => {
    const batches = inputPackTaskBatches(
      Array.from({ length: 1201 }, (_, index) => String(index + 1)),
    );
    expect(batches.map((batch) => batch.length)).toEqual([1000, 201]);
    expect(batches.flat()).toHaveLength(1201);
  });

  it("discovers and collects a producer when the table is missing from the local catalog", () => {
    const dataRoot = root();
    const factsRoot = join(dirname(dataRoot), `${dataRoot.split(/[\\/]/).at(-1)}-facts`);
    writeTable(dataRoot, "odata.source_table");
    writeTask(dataRoot, "A", "SELECT id FROM odata.source_table");
    const collected: string[] = [];
    let discoveryCalls = 0;

    const result = runInputPackClosure({
      taskId: "A",
      dataRoot,
      writerCatalogPath: writerCatalogPathFor(dataRoot),
      maxDepth: 3,
      maxTasks: 20,
      maxRounds: 4,
      maxDiscoveryTables: 10,
      discoveryMinIntervalMs: 0,
      discoveryAttempts: 1,
      discoverTableProducerTaskIds: (qualifiedName) => {
        discoveryCalls += 1;
        expect(qualifiedName).toBe("odata.source_table");
        return ["B"];
      },
      collectTaskPacks: (_root, taskIds) => {
        collected.push(...taskIds);
        expect(taskIds).toEqual(["B"]);
        writeTask(dataRoot, "B", "INSERT OVERWRITE TABLE odata.source_table SELECT 1 AS id", "odata.source_table");
        indexWritersFromFacts(dataRoot, factsRoot, ["B"]);
      },
    });

    expect(discoveryCalls).toBe(1);
    expect(collected).toEqual(["B"]);
    expect(result.status).toBe("COMPLETE");
    expect(result.taskIds).toEqual(["A", "B"]);
    expect(result.collectedTaskIds).toEqual(["B"]);
    expect(result.rounds).toBe(2);
  });

  it("does not discover producers behind a configured terminal reference table", () => {
    const dataRoot = root();
    writeTable(dataRoot, "pdata_n.ref_cd_cvt_map");
    writeTask(dataRoot, "A", "SELECT id FROM pdata_n.ref_cd_cvt_map");
    const terminalTableConfig = {
      version: "test",
      stopRoles: ["REFERENCE_CONFIG"],
      roles: {
        REFERENCE_CONFIG: {
          qualifiedNameExact: ["pdata_n.ref_cd_cvt_map"],
          qualifiedNameTerms: ["never-match"],
        },
      },
    } as const;
    let discoveryCalls = 0;

    const result = runInputPackClosure({
      taskId: "A",
      dataRoot,
      writerCatalogPath: writerCatalogPathFor(dataRoot),
      maxDepth: 3,
      maxTasks: 20,
      maxRounds: 4,
      terminalTableConfig,
      discoverTableProducerTaskIds: () => {
        discoveryCalls += 1;
        throw new Error("terminal table must not be discovered");
      },
      collectTaskPacks: () => {
        throw new Error("terminal table must not collect a producer");
      },
    });

    expect(discoveryCalls).toBe(0);
    expect(result.status).toBe("COMPLETE");
    expect(result.taskIds).toEqual(["A"]);
    expect(result.discoveredTaskIds).toEqual(["A"]);
  });
});

function sharedInputPack(): string {
  const dataRoot = root();
  for (const table of [
    "dm.root_a",
    "dm.root_b",
    "dm.shared",
    "pdata_n.ref_source_table",
  ])
    writeTable(dataRoot, table);
  writeTask(
    dataRoot,
    "root-a",
    "INSERT OVERWRITE TABLE dm.root_a SELECT id FROM dm.shared",
    "dm.root_a",
  );
  writeTask(
    dataRoot,
    "root-b",
    "INSERT OVERWRITE TABLE dm.root_b SELECT id FROM dm.shared",
    "dm.root_b",
  );
  writeTask(
    dataRoot,
    "shared-producer",
    "INSERT OVERWRITE TABLE dm.shared SELECT id FROM pdata_n.ref_source_table",
    "dm.shared",
  );
  return dataRoot;
}

function terminalConfig() {
  return {
    version: "fixture-v1",
    stopRoles: ["REFERENCE_CONFIG"],
    roles: {
      REFERENCE_CONFIG: {
        qualifiedNameExact: ["pdata_n.ref_source_table"],
        qualifiedNameTerms: ["ref_source_table"],
      },
    },
  } as const;
}

describe("shared project Input Pack closure", () => {
  it("evaluates a shared Task's SQL reads once while retaining both root memberships", () => {
    const dataRoot = sharedInputPack();
    const factsRoot = join(dirname(dataRoot), `${dataRoot.split(/[\\/]/).at(-1)}-facts`);
    indexWritersFromFacts(dataRoot, factsRoot, ["root-a", "root-b", "shared-producer"]);
    const result = runProjectInputPackClosure({
      rootTaskIds: ["root-a", "root-b"],
      dataRoot,
      writerCatalogPath: writerCatalogPathFor(dataRoot),
      maxDepth: 5,
      maxTasksPerRoot: 20,
      maxUnionTasks: 30,
      maxRounds: 8,
      terminalTableConfig: terminalConfig(),
    });

    expect(result.status).toBe("COMPLETE");
    expect(result.taskIds).toEqual(["root-a", "root-b", "shared-producer"]);
    expect(result.roots).toEqual([
      expect.objectContaining({
        rootTaskId: "root-a",
        taskIds: ["root-a", "shared-producer"],
      }),
      expect.objectContaining({
        rootTaskId: "root-b",
        taskIds: ["root-b", "shared-producer"],
      }),
    ]);
    expect(result.counters).toMatchObject({
      rootTaskOccurrences: 4,
      uniqueTasks: 3,
      taskReadsEvaluated: 3,
      discoveryQueries: 0,
      collectionBatches: 0,
    });
  });
});
