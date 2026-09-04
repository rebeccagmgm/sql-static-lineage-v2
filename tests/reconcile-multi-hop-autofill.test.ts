import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  writeTableInput,
  writeTaskInput,
  type TaskEvidence,
} from "../scripts/input/shared/input-pack.ts";
import {
  producerTaskIdsFromTableResponse,
  runMultiHopAutofill,
} from "../scripts/reconcile/consumer/multi-hop/reconcile-multi-hop-autofill.ts";
import {
  loadTerminalTableConfig,
  matchingTerminalRole,
} from "../scripts/reconcile/consumer/multi-hop/terminal-table-config.ts";
import { readHoraeRelationCache } from "../scripts/reconcile/consumer/one-hop/schedule-evidence-cache.ts";

const FIXED_NOW = "2026-08-26T08:00:00.000Z";

function dataRoot(): string {
  return mkdtempSync(join(tmpdir(), "sql-lineage-multi-hop-autofill-"));
}

function writeTable(
  root: string,
  qualifiedName: string,
  platform = "hive",
  dataSource = "gfhive",
): void {
  const [schema, name] = qualifiedName.split(".");
  writeTableInput(root, {
    platform,
    dataSource,
    qualifiedName,
    schema,
    name,
    objectType: "TABLE",
    ddl: `CREATE TABLE ${qualifiedName} (id bigint)`,
    evidenceProvider: "fixture:table",
    collectedAt: FIXED_NOW,
  });
}

function writeTask(
  root: string,
  taskId: string,
  evidence: Omit<TaskEvidence, "taskId" | "taskCategory" | "collectedAt">,
): void {
  writeTaskInput(root, {
    taskId,
    taskCategory: "hiveTask-2.0",
    collectedAt: FIXED_NOW,
    evidenceProvider: "fixture:task",
    ...evidence,
  });
}

function writeReader(root: string, taskId: string, tables: string[]): void {
  const from = tables
    .map((table, index) =>
      index === 0 ? `${table} t0` : `JOIN ${table} t${index} ON 1 = 1`,
    )
    .join(" ");
  writeTask(root, taskId, {
    sql: {
      query: {
        content: `SELECT t0.id FROM ${from}`,
        evidenceProvider: "fixture:sql",
      },
    },
  });
}

function writeProducer(root: string, taskId: string, output: string): void {
  writeTask(root, taskId, {
    target: {
      platform: "hive",
      dataSource: "gfhive",
      qualifiedName: output,
    },
    targetEvidenceKind: "DIRECT_PLATFORM_TARGET",
    writeMode: "OVERWRITE",
    sql: {
      query: {
        content: `INSERT OVERWRITE TABLE ${output} SELECT 1 AS id`,
        evidenceProvider: "fixture:sql",
      },
    },
  });
}

describe("multi-hop autofill", () => {
  it("treats the parameter mapping table as a terminal reference table", () => {
    const config = loadTerminalTableConfig(
      join(
        import.meta.dirname,
        "..",
        "config",
        "multi-hop-terminal-table-rules.json",
      ),
    );
    expect(matchingTerminalRole(config, "pdata_n.ref_cd_cvt_map")).toBe(
      "REFERENCE_CONFIG",
    );
    expect(matchingTerminalRole(config, "pdata_n.normal_ref_table")).toBeNull();
  });

  it("extracts candidate task ids from table metadata without treating them as edges", () => {
    expect(
      producerTaskIdsFromTableResponse({
        tasks: [
          { taskId: "135972" },
          { task_id: "135972" },
          { taskId: "bad id" },
        ],
      }),
    ).toEqual(["135972"]);
  });

  it("collects table-discovered packs once and only recurses through primary", () => {
    const root = dataRoot();
    for (const table of ["lake.scheduled", "lake.discovered"])
      writeTable(root, table);
    writeReader(root, "A", ["lake.scheduled", "lake.discovered"]);
    writeProducer(root, "C", "lake.scheduled");

    const cacheRoot = join(
      dirname(root),
      `${root.split(/[\\/]/).at(-1)}-producer-index-cache`,
    );
    const runnerCalls: string[][] = [];
    const collectedBatches: string[][] = [];
    const result = runMultiHopAutofill({
      taskId: "A",
      dataRoot: root,
      producerIndexCacheRoot: cacheRoot,
      terminalTableConfigPath: join(
        import.meta.dirname,
        "..",
        "config",
        "multi-hop-terminal-table-rules.json",
      ),
      maxDepth: 2,
      maxTasks: 20,
      maxEdges: 100,
      discoveryMinIntervalMs: 0,
      discoveryAttempts: 1,
      now: () => FIXED_NOW,
      sleep: () => undefined,
      openCliRunner: (args) => {
        runnerCalls.push([...args]);
        if (args[0] === "horae" && args[2] === "A") return [{ task_id: "C" }];
        if (args[0] === "horae" && args[2] === "C") return [];
        if (
          args[0] === "szdata" &&
          args[1] === "table" &&
          args.includes("discovered")
        )
          return [{ tasks: [{ taskId: "B" }] }];
        throw new Error(`UNEXPECTED_OPENCLI_CALL:${args.join(" ")}`);
      },
      collectTaskPacks: (targetRoot, taskIds) => {
        collectedBatches.push([...taskIds]);
        expect(targetRoot).toBe(root);
        if (taskIds.includes("B")) writeProducer(root, "B", "lake.discovered");
      },
    });

    expect(existsSync(cacheRoot)).toBe(true);
    expect(readdirSync(cacheRoot)).toEqual(["producer-index.json"]);
    expect(collectedBatches).toEqual([["B"]]);
    expect(result.report).toMatchObject({
      status: "COMPLETE",
      rounds: 2,
      queriedTables: ["lake.discovered"],
      discoveredTaskIds: ["B"],
      collectedTaskIds: ["B"],
      initialIndexMode: "PINNED_FINGERPRINT_CACHE",
    });
    expect(
      result.artifact.taskNodes.find((node) => node.taskId === "A")
        ?.upstreamDecision,
    ).toMatchObject({ primary: ["C"], additional: ["B"] });
    expect(result.artifact.taskNodes.map((node) => node.taskId)).toContain("C");
    expect(
      result.artifact.taskNodes.find((node) => node.taskId === "B"),
    ).toMatchObject({ expansionStatus: "TERMINAL", upstreamDecision: null });
    expect(
      result.artifact.producerBridges.some(
        (bridge) =>
          bridge.consumerTaskId === "A" &&
          bridge.table.qualifiedName === "lake.discovered" &&
          bridge.producerTaskId === "B",
      ),
    ).toBe(true);
    expect(
      runnerCalls.filter((args) => args[0] === "szdata" && args[1] === "table"),
    ).toHaveLength(1);
    expect(
      runnerCalls.some((args) => args[0] === "horae" && args[2] === "B"),
    ).toBe(false);
  });

  it("reads and writes the schedule-evidence cache during closure", () => {
    const root = dataRoot();
    writeProducer(root, "A", "lake.output");
    const producerCacheRoot = join(
      dirname(root),
      `${root.split(/[\\/]/).at(-1)}-producer-index-cache`,
    );
    const scheduleCacheRoot = join(
      dirname(root),
      `${root.split(/[\\/]/).at(-1)}-schedule-evidence-cache`,
    );
    const terminalTableConfigPath = join(
      import.meta.dirname,
      "..",
      "config",
      "multi-hop-terminal-table-rules.json",
    );
    let firstCalls = 0;
    runMultiHopAutofill({
      taskId: "A",
      dataRoot: root,
      producerIndexCacheRoot: producerCacheRoot,
      scheduleEvidenceCacheRoot: scheduleCacheRoot,
      terminalTableConfigPath,
      maxDepth: 2,
      maxTasks: 20,
      maxEdges: 100,
      discoveryMinIntervalMs: 0,
      discoveryAttempts: 1,
      now: () => FIXED_NOW,
      sleep: () => undefined,
      openCliRunner: (args) => {
        firstCalls += 1;
        expect(args[0]).toBe("horae");
        return [];
      },
      collectTaskPacks: () => undefined,
    });
    expect(firstCalls).toBe(1);
    expect(readHoraeRelationCache("A", scheduleCacheRoot).status).toBe("HIT");

    let secondCalls = 0;
    runMultiHopAutofill({
      taskId: "A",
      dataRoot: root,
      producerIndexCacheRoot: producerCacheRoot,
      scheduleEvidenceCacheRoot: scheduleCacheRoot,
      terminalTableConfigPath,
      maxDepth: 2,
      maxTasks: 20,
      maxEdges: 100,
      discoveryMinIntervalMs: 0,
      discoveryAttempts: 1,
      now: () => FIXED_NOW,
      sleep: () => undefined,
      openCliRunner: () => {
        secondCalls += 1;
        throw new Error("CACHE_MISS_SHOULD_NOT_CALL_HORAE");
      },
      collectTaskPacks: () => undefined,
    });
    expect(secondCalls).toBe(0);
  });

  it("automatically attempts missing schedule packs and reports unavailable ones without crashing", () => {
    const root = dataRoot();
    writeTable(root, "lake.missing_param_table");
    writeReader(root, "A", ["lake.missing_param_table"]);

    const cacheRoot = join(
      dirname(root),
      `${root.split(/[\\/]/).at(-1)}-producer-index-cache`,
    );
    const collectedBatches: string[][] = [];
    const runnerCalls: string[][] = [];
    const result = runMultiHopAutofill({
      taskId: "A",
      dataRoot: root,
      producerIndexCacheRoot: cacheRoot,
      terminalTableConfigPath: join(
        import.meta.dirname,
        "..",
        "config",
        "multi-hop-terminal-table-rules.json",
      ),
      maxDepth: 2,
      maxTasks: 20,
      maxEdges: 100,
      discoveryMinIntervalMs: 0,
      discoveryAttempts: 1,
      now: () => FIXED_NOW,
      sleep: () => undefined,
      openCliRunner: (args) => {
        runnerCalls.push([...args]);
        if (args[0] === "horae" && args[2] === "A")
          return [{ task_id: "MISSING", task_name: "missing parent" }];
        throw new Error(`UNEXPECTED_OPENCLI_CALL:${args.join(" ")}`);
      },
      collectTaskPacks: (_targetRoot, taskIds) => {
        collectedBatches.push([...taskIds]);
      },
    });

    expect(collectedBatches).toEqual([["MISSING"]]);
    expect(result.report).toMatchObject({
      status: "PARTIAL",
      discoveredTaskIds: ["MISSING"],
      collectedTaskIds: [],
      issues: ["DISCOVERED_TASK_PACK_UNAVAILABLE:MISSING"],
    });
    expect(
      runnerCalls.some((args) => args[0] === "horae" && args[2] === "MISSING"),
    ).toBe(false);
  });

  it("marks a missing non-Hive producer as a source boundary without changing Hive behavior", () => {
    const root = dataRoot();
    writeTable(root, "oracle.source_table", "oracle", "gforacle");
    writeReader(root, "A", ["oracle.source_table"]);

    const indexPath = join(
      dirname(root),
      `${root.split(/[\\/]/).at(-1)}-producer-index.json`,
    );
    const result = runMultiHopAutofill({
      taskId: "A",
      dataRoot: root,
      producerIndexPath: indexPath,
      terminalTableConfigPath: join(
        import.meta.dirname,
        "..",
        "config",
        "multi-hop-terminal-table-rules.json",
      ),
      maxDepth: 2,
      maxTasks: 20,
      maxEdges: 100,
      discoveryMinIntervalMs: 0,
      discoveryAttempts: 1,
      now: () => FIXED_NOW,
      sleep: () => undefined,
      openCliRunner: (args) => {
        if (args[0] === "horae" && args[2] === "A") return [];
        if (args[0] === "szdata" && args[1] === "table") return [];
        throw new Error(`UNEXPECTED_OPENCLI_CALL:${args.join(" ")}`);
      },
      collectTaskPacks: () => {
        throw new Error("UNEXPECTED_COLLECTION");
      },
    });

    expect(result.report).toMatchObject({
      status: "COMPLETE",
      nonHiveSourceBoundaries: ["oracle.source_table"],
      issues: [],
    });
  });
});
