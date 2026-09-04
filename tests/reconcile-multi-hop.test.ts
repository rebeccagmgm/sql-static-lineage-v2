import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  canonicalHash,
  writeTableInput,
  writeTaskInput,
  type JsonValue,
  type TaskEvidence,
} from "../scripts/input/shared/input-pack.ts";
import {
  buildTableProducerIndex,
  fingerprintTableProducerInputs,
  type TableProducerIndex,
} from "../scripts/reconcile/producer/producer-index.ts";
import {
  reconcileOneHop,
  type OneHopReconciliationResult,
} from "../scripts/reconcile/consumer/one-hop/reconcile-one-hop.ts";
import {
  reconcileMultiHopBatch,
  reconcileMultiHop,
  validateMultiHopReconciliation,
} from "../scripts/reconcile/consumer/multi-hop/reconcile-multi-hop.ts";
import { buildTaskReadEvidenceRepository } from "../scripts/reconcile/consumer/multi-hop/task-read-evidence.ts";
import type { TerminalTableConfig } from "../scripts/reconcile/consumer/multi-hop/terminal-table-config.ts";
import { writeHoraeRelationCache } from "../scripts/reconcile/consumer/one-hop/schedule-evidence-cache.ts";

const FIXED_NOW = "2026-08-23T08:00:00.000Z";

const frozen86840It = existsSync(
  join(
    import.meta.dirname,
    "fixtures",
    "reconcile-one-hop",
    "86840-input-pack",
  ),
)
  ? it
  : it.skip;

function dataRoot(): string {
  return mkdtempSync(join(tmpdir(), "sql-lineage-multi-hop-"));
}

function writeTable(
  root: string,
  qualifiedName: string,
  partitionFields?: readonly string[],
): void {
  const [schema, name] = qualifiedName.split(".");
  writeTableInput(root, {
    platform: "hive",
    dataSource: "gfhive",
    qualifiedName,
    schema,
    name,
    objectType: "TABLE",
    ddl: `CREATE TABLE ${qualifiedName} (id bigint)${
      partitionFields && partitionFields.length > 0
        ? ` PARTITIONED BY (${partitionFields
            .map((field) => `${field} string`)
            .join(", ")})`
        : ""
    }`,
    evidenceProvider: "fixture:table",
    collectedAt: "2026-08-23T00:00:00.000Z",
    ...(partitionFields === undefined ? {} : { partitionFields }),
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
    collectedAt: "2026-08-23T00:00:00.000Z",
    evidenceProvider: evidence.evidenceProvider ?? "fixture:task",
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

function writeProducer(
  root: string,
  taskId: string,
  output: string,
  inputs: string[] = [],
): void {
  const select =
    inputs.length === 0
      ? "SELECT 1 AS id"
      : `SELECT s0.id FROM ${inputs
          .map((table, index) =>
            index === 0 ? `${table} s0` : `JOIN ${table} s${index} ON 1 = 1`,
          )
          .join(" ")}`;
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
        content: `INSERT OVERWRITE TABLE ${output} ${select}`,
        evidenceProvider: "fixture:sql",
      },
    },
  });
}

function rootOneHop(
  root: string,
  producerIndex: TableProducerIndex,
  taskId: string,
  horaeRows: readonly Record<string, unknown>[] = [],
): OneHopReconciliationResult {
  return reconcileOneHop(taskId, {
    dataRoot: root,
    producerIndex,
    now: () => FIXED_NOW,
    openCliRunner: (args) => {
      if (args[0] === "horae") return horaeRows;
      return null;
    },
  });
}

function run(
  root: string,
  producerIndex: TableProducerIndex,
  taskId: string,
  options: {
    maxDepth?: number;
    maxTasks?: number;
    maxEdges?: number;
    now?: () => string;
    rootOneHop?: OneHopReconciliationResult;
    terminalTableConfig?: TerminalTableConfig;
    scheduleEvidenceCacheRoot?: string | null;
  } = {},
) {
  return reconcileMultiHop(taskId, {
    dataRoot: root,
    producerIndex,
    maxDepth: options.maxDepth ?? 3,
    maxTasks: options.maxTasks ?? 100,
    maxEdges: options.maxEdges ?? 500,
    now: options.now ?? (() => FIXED_NOW),
    // Isolate fixtures from the workstation schedule cache unless a test opts in.
    scheduleEvidenceCacheRoot:
      options.scheduleEvidenceCacheRoot === undefined
        ? null
        : options.scheduleEvidenceCacheRoot,
    ...(options.rootOneHop ? { rootOneHop: options.rootOneHop } : {}),
    ...(options.terminalTableConfig
      ? { terminalTableConfig: options.terminalTableConfig }
      : {}),
  });
}

function bridgeKeys(result: ReturnType<typeof reconcileMultiHop>): string[] {
  return result.producerBridges.map(
    (bridge) =>
      `${bridge.consumerTaskId}:${bridge.table.qualifiedName}:${bridge.producerTaskId}:${bridge.producerDepth}`,
  );
}

function terminalReasons(
  result: ReturnType<typeof reconcileMultiHop>,
): string[] {
  return result.terminals.map((terminal) => terminal.reason);
}

function semanticSnapshot(
  result: ReturnType<typeof reconcileMultiHop>,
): unknown {
  const {
    generatedAt: _generatedAt,
    contentHash: _contentHash,
    ...semantic
  } = result;
  return semantic;
}

function rehashIndexForCurrentInputs(
  index: TableProducerIndex,
  root: string,
  changes: Partial<TableProducerIndex> = {},
): TableProducerIndex {
  const withoutHash = {
    ...index,
    ...changes,
    inputFingerprint: fingerprintTableProducerInputs(root),
  };
  return {
    ...withoutHash,
    contentHash: canonicalHash(withoutHash as unknown as JsonValue, [
      "generatedAt",
      "contentHash",
    ]),
  };
}

function materializeFrozenInputPack(sourceRoot: string): string {
  const root = dataRoot();
  cpSync(sourceRoot, root, { recursive: true });
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(path);
        continue;
      }
      const normalizeEvidenceFile = (relativePath: string): void => {
        const evidencePath = join(directory, relativePath);
        const normalized = readFileSync(evidencePath, "utf8").replaceAll(
          "\r\n",
          "\n",
        );
        writeFileSync(
          evidencePath,
          normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized,
        );
      };
      if (entry.name === "task.json") {
        const task = JSON.parse(readFileSync(path, "utf8")) as {
          sqlFiles?: { path: string }[];
        };
        for (const sqlFile of task.sqlFiles ?? [])
          normalizeEvidenceFile(sqlFile.path);
      }
      if (entry.name === "table.json") {
        const table = JSON.parse(readFileSync(path, "utf8")) as {
          ddlFile?: { path: string };
        };
        if (table.ddlFile) normalizeEvidenceFile(table.ddlFile.path);
      }
    }
  };
  visit(root);
  return root;
}

describe("reconcileMultiHop", () => {
  it("loads Task SQL only when a lazy repository visits that Task", () => {
    const root = dataRoot();
    writeTable(root, "lake.source");
    for (let index = 0; index < 24; index += 1)
      writeReader(root, `reader-${index}`, ["lake.source"]);

    const repository = buildTaskReadEvidenceRepository(root, {
      taskLoading: "LAZY",
    });

    expect(repository.diagnostics()).toEqual({
      taskPacksLoaded: 0,
      sqlFilesLoaded: 0,
      cachedTaskReadResults: 0,
    });

    repository.getTaskReads("reader-0");
    expect(repository.diagnostics()).toEqual({
      taskPacksLoaded: 1,
      sqlFilesLoaded: 1,
      cachedTaskReadResults: 1,
    });

    repository.getTaskReads("reader-0");
    expect(repository.diagnostics()).toEqual({
      taskPacksLoaded: 1,
      sqlFilesLoaded: 1,
      cachedTaskReadResults: 1,
    });
  });

  it("qualifies bare reads only when the Task Pack proves a default schema", () => {
    const root = dataRoot();
    writeTable(root, "pdata_news_n.t02_scr_base_info");
    writeTask(root, "103234", {
      taskName: "pdata_news_n.t02_tit_scr_base_info_TIT_ref_instrument_grp01",
      target: {
        platform: "hive",
        dataSource: "gfhive",
        qualifiedName: "pdata_news_n.t02_tit_scr_base_info",
      },
      targetEvidenceKind: "TABLE_TASK_RELATION_DIRECTION_UNKNOWN",
      sql: { query: "SELECT b.id FROM t02_scr_base_info b" },
      evidenceProvider: "fixture:table-task-relation",
    });
    writeTask(root, "missing-schema", {
      sql: { query: "SELECT b.id FROM t02_scr_base_info b" },
    });
    writeTask(root, "conflicting-schema", {
      taskName: "pdata_news_n.some_output",
      target: {
        platform: "hive",
        dataSource: "gfhive",
        qualifiedName: "other_schema.some_output",
      },
      targetEvidenceKind: "DIRECT_PLATFORM_TARGET",
      sql: { query: "SELECT b.id FROM t02_scr_base_info b" },
    });

    const repository = buildTaskReadEvidenceRepository(root);

    expect(repository.getTaskReads("103234").directReads).toEqual([
      expect.objectContaining({
        tableRef: {
          platform: "hive",
          dataSource: "gfhive",
          qualifiedName: "pdata_news_n.t02_scr_base_info",
          identityStatus: "RESOLVED",
        },
        resolutionStatus: "RESOLVED",
      }),
    ]);
    for (const taskId of ["missing-schema", "conflicting-schema"])
      expect(repository.getTaskReads(taskId).directReads).toEqual([
        expect.objectContaining({
          tableRef: {
            platform: null,
            dataSource: null,
            qualifiedName: "t02_scr_base_info",
            identityStatus: "QUALIFIED_NAME_ONLY",
          },
          resolutionStatus: "NON_RESOLVED",
          blockReason: "TABLE_IDENTITY_UNRESOLVED",
        }),
      ]);
  });

  it("stops at a configured reference/config table before producer lookup", () => {
    const root = dataRoot();
    writeTable(root, "dm_index_n.tag_def");
    writeTable(root, "lake.source");
    writeReader(root, "A", ["dm_index_n.tag_def"]);
    writeProducer(root, "B", "dm_index_n.tag_def", ["lake.source"]);
    const index = buildTableProducerIndex(root, { now: () => FIXED_NOW });

    const result = run(root, index, "A", {
      terminalTableConfig: {
        version: "test-1",
        stopRoles: ["REFERENCE_CONFIG"],
        roles: {
          REFERENCE_CONFIG: { qualifiedNameTerms: ["tag_def"] },
        },
      },
    });

    expect(result.taskNodes.map((node) => node.taskId)).toEqual(["A"]);
    expect(result.producerBridges).toEqual([]);
    expect(result.terminals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: "A",
          reason: "REFERENCE_CONFIG",
          table: expect.objectContaining({
            qualifiedName: "dm_index_n.tag_def",
          }),
          detail: { role: "REFERENCE_CONFIG", configVersion: "test-1" },
        }),
      ]),
    );
    expect(result.terminalTableConfig).toEqual({
      version: "test-1",
      stopRoles: ["REFERENCE_CONFIG"],
    });
  });

  it("traverses a linear producer chain to depth two and exposes the graph contract", () => {
    const root = dataRoot();
    for (const table of ["lake.t1", "lake.t2"]) writeTable(root, table);
    writeReader(root, "A", ["lake.t1"]);
    writeProducer(root, "B", "lake.t1", ["lake.t2"]);
    writeProducer(root, "C", "lake.t2");
    const index = buildTableProducerIndex(root, { now: () => FIXED_NOW });

    const result = run(root, index, "A", { maxDepth: 2 });

    expect(
      result.taskNodes.map((node) => [
        node.taskId,
        node.minDepth,
        node.expansionStatus,
      ]),
    ).toEqual([
      ["A", 0, "EXPANDED"],
      ["B", 1, "EXPANDED"],
      ["C", 2, "TERMINAL"],
    ]);
    expect(bridgeKeys(result)).toEqual(["A:lake.t1:B:1", "B:lake.t2:C:2"]);
    expect(result.terminals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: "C",
          reason: "MAX_DEPTH_REACHED",
        }),
      ]),
    );
    expect(result).toMatchObject({
      artifactType: "TABLE_MULTI_HOP_RECONCILIATION",
      rootTaskId: "A",
      coverage: { status: "PARTIAL_EVIDENCE" },
      limits: {
        maxDepth: 2,
        maxTasks: 100,
        maxEdges: 500,
        truncated: true,
        truncationReason: "MAX_DEPTH_REACHED",
      },
      counts: {
        taskNodes: 3,
        tableNodes: 2,
        readEdges: 2,
        writeEdges: 2,
        producerBridges: 2,
      },
      countSemantics: "NODE_AND_UNIQUE_EDGE_COUNTS",
      scheduleSkeleton: {
        boundary: "ROOT_DEPTH_1_ONLY",
      },
      boundaries: {
        staticSqlOnly: true,
        openCli: "NOT_USED",
        producerCandidatesAreWrites: false,
        partitionScope: "TASK_TO_TABLE_WRITE",
        schedulerExecution: "NOT_EVALUATED",
        runtimeDelivery: "NOT_EVALUATED",
        businessCorrectness: "NOT_EVALUATED",
      },
    });
    expect(result.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("uses each task's final upstream primary as the only BFS entry", () => {
    const root = dataRoot();
    for (const table of [
      "lake.primary",
      "lake.additional",
      "lake.primary-upstream",
      "lake.additional-upstream",
    ])
      writeTable(root, table);
    writeReader(root, "A", ["lake.primary", "lake.additional"]);
    writeProducer(root, "scheduled-primary", "lake.primary", [
      "lake.primary-upstream",
    ]);
    writeProducer(root, "additional-producer", "lake.additional", [
      "lake.additional-upstream",
    ]);
    writeProducer(root, "primary-upstream", "lake.primary-upstream");
    writeProducer(root, "additional-upstream", "lake.additional-upstream");
    const index = buildTableProducerIndex(root, { now: () => FIXED_NOW });
    const snapshot = rootOneHop(root, index, "A", [
      { task_id: "scheduled-primary", direction: "上游" },
    ]);

    expect(snapshot.finalUpstreamTaskIds).toEqual({
      primary: ["scheduled-primary"],
      additional: ["additional-producer"],
      unknown: [],
      decision: "SCHEDULE_DATA_INTERSECTION",
    });
    const result = run(root, index, "A", {
      maxDepth: 2,
      rootOneHop: snapshot,
    });

    expect(result.taskNodes.map((node) => node.taskId)).toEqual([
      "A",
      "additional-producer",
      "scheduled-primary",
      "primary-upstream",
    ]);
    expect(result.taskNodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: "additional-producer",
          expansionStatus: "TERMINAL",
          upstreamDecision: null,
        }),
        expect.objectContaining({
          taskId: "scheduled-primary",
          expansionStatus: "EXPANDED",
        }),
      ]),
    );
    expect(result.taskNodes.map((node) => node.taskId)).not.toContain(
      "additional-upstream",
    );
    expect(result.scheduleEdges).toEqual([
      expect.objectContaining({
        consumerTaskId: "A",
        producerTaskId: "scheduled-primary",
        producerDepth: 1,
      }),
    ]);
  });

  it("preserves occurrence-specific primary and candidate producer bridges", () => {
    const root = dataRoot();
    writeTable(root, "lake.shared_history", ["src_tbl"]);
    writeTable(root, "mart.current");
    writeTable(root, "raw.seed");
    writeTask(root, "A", {
      sql: {
        query: {
          content: `SELECT c.id AS trade_id, k.id AS book_id
FROM (SELECT id FROM lake.shared_history WHERE src_tbl = 'TRADE') c
JOIN (SELECT id FROM lake.shared_history WHERE src_tbl = 'BOOK') k
  ON c.id = k.id`,
          evidenceProvider: "fixture:sql",
        },
      },
    });
    for (const [taskId, srcTbl] of [
      ["book-direct", "BOOK"],
      ["trade-direct", "TRADE"],
      ["trade-alternate", "TRADE"],
    ] as const)
      writeTask(root, taskId, {
        target: {
          platform: "hive",
          dataSource: "gfhive",
          qualifiedName: "lake.shared_history",
        },
        targetEvidenceKind: "DIRECT_PLATFORM_TARGET",
        partition: { src_tbl: srcTbl },
        sql: {
          query: {
            content: `INSERT OVERWRITE TABLE lake.shared_history PARTITION (src_tbl='${srcTbl}') SELECT id FROM raw.seed`,
            evidenceProvider: "fixture:sql",
          },
        },
      });
    const index = buildTableProducerIndex(root, { now: () => FIXED_NOW });
    const snapshot = rootOneHop(root, index, "A", [
      { task_id: "book-direct", direction: "上游" },
      { task_id: "trade-direct", direction: "上游" },
    ]);

    const result = run(root, index, "A", {
      maxDepth: 1,
      rootOneHop: snapshot,
    });

    expect(
      result.producerBridges.map((bridge) => ({
        taskId: bridge.producerTaskId,
        occurrenceId: bridge.readOccurrence?.occurrenceId,
        role: bridge.producerRole,
      })),
    ).toEqual([
      expect.objectContaining({ taskId: "book-direct", role: "PRIMARY" }),
      expect.objectContaining({
        taskId: "trade-alternate",
        role: "CANDIDATE",
      }),
      expect.objectContaining({ taskId: "trade-direct", role: "PRIMARY" }),
    ]);
    expect(
      result.producerBridges
        .filter((bridge) => bridge.producerRole === "PRIMARY")
        .map((bridge) => bridge.readOccurrence?.readRelationId),
    ).toEqual(["root.k.read.shared_history", "root.c.read.shared_history"]);
  });

  it("retains a partition-unknown primary but never recurses through it", () => {
    const root = dataRoot();
    for (const table of ["lake.input", "lake.upstream"])
      writeTable(root, table);
    writeReader(root, "A", ["lake.input"]);
    writeProducer(root, "B", "lake.input", ["lake.upstream"]);
    writeProducer(root, "C", "lake.upstream");
    const index = buildTableProducerIndex(root, { now: () => FIXED_NOW });
    const snapshot = rootOneHop(root, index, "A", [
      { task_id: "B", direction: "上游" },
    ]);
    const unknownSnapshot: OneHopReconciliationResult = {
      ...snapshot,
      partitionAwareNextDataTaskIds: {
        candidates: [],
        proven: [],
        possible: [],
        unknown: ["B"],
      },
    };

    const result = run(root, index, "A", {
      maxDepth: 2,
      rootOneHop: unknownSnapshot,
    });

    expect(result.taskNodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: "B",
          expansionStatus: "TERMINAL",
          upstreamDecision: null,
        }),
      ]),
    );
    expect(result.taskNodes.map((node) => node.taskId)).not.toContain("C");
    expect(result.taskNodes[0]?.upstreamDecision).toMatchObject({
      primary: ["B"],
      unknown: ["B"],
    });
  });

  it("uses an explicit offline one-hop input and never invokes default Horae", () => {
    const root = dataRoot();
    writeTable(root, "lake.input");
    writeReader(root, "A", ["lake.input"]);
    writeProducer(root, "B", "lake.input");
    const index = buildTableProducerIndex(root, { now: () => FIXED_NOW });

    const result = run(root, index, "A", { maxDepth: 1 });

    expect(result.taskNodes[0]?.upstreamDecision).toMatchObject({
      source: "ONE_HOP_FINAL_UPSTREAM",
      primary: ["B"],
      additional: [],
      unknown: [],
      decision: "DATA_FALLBACK",
    });
    expect(result.taskNodes[0]?.upstreamDecision?.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "HORAE_RELATION",
          provider: "offline:horae.relation",
          observedAt: null,
        }),
      ]),
    );
  });

  it("does not recurse through multiple overlapping overwrite producers without schedule evidence", () => {
    const root = dataRoot();
    for (const table of ["lake.shared", "lake.current", "lake.seed"])
      writeTable(root, table);
    writeReader(root, "A", ["lake.shared"]);
    writeProducer(root, "B", "lake.shared", ["lake.seed"]);
    writeProducer(root, "C", "lake.shared", ["lake.seed"]);
    const index = buildTableProducerIndex(root, { now: () => FIXED_NOW });

    const result = run(root, index, "A", { maxDepth: 3 });

    expect(result.taskNodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: "B",
          upstreamDecision: null,
          expansionStatus: "TERMINAL",
        }),
        expect.objectContaining({
          taskId: "C",
          upstreamDecision: null,
          expansionStatus: "TERMINAL",
        }),
      ]),
    );
    expect(result.taskNodes).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ taskId: "B", upstreamDecision: expect.anything() }),
        expect.objectContaining({ taskId: "C", upstreamDecision: expect.anything() }),
      ]),
    );
    expect(result.terminals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: "A",
          reason: "MULTIPLE_OVERLAPPING_PRODUCERS",
          detail: expect.objectContaining({ action: "STOP_BRANCH" }),
        }),
      ]),
    );
  });

  it("uses offline schedule cache to pick the unique parent among overlapping overwrite producers", () => {
    const root = dataRoot();
    const cacheRoot = mkdtempSync(join(tmpdir(), "sql-lineage-schedule-cache-"));
    for (const table of ["lake.shared", "lake.current", "lake.seed"])
      writeTable(root, table);
    writeReader(root, "A", ["lake.shared"]);
    writeProducer(root, "B", "lake.shared", ["lake.seed"]);
    writeProducer(root, "C", "lake.shared", ["lake.seed"]);
    writeHoraeRelationCache(
      "A",
      FIXED_NOW,
      [{ task_id: "B", task_name: "producer-b", direction: "上游" }],
      cacheRoot,
    );
    const index = buildTableProducerIndex(root, { now: () => FIXED_NOW });

    const result = run(root, index, "A", {
      maxDepth: 2,
      scheduleEvidenceCacheRoot: cacheRoot,
    });

    expect(result.taskNodes[0]?.upstreamDecision).toMatchObject({
      primary: ["B"],
      additional: [],
      unknown: [],
      decision: "SCHEDULE_DATA_INTERSECTION",
    });
    expect(
      result.producerBridges.find(
        (bridge) =>
          bridge.consumerTaskId === "A" && bridge.producerTaskId === "B",
      )?.producerRole,
    ).toBe("PRIMARY");
    expect(
      result.producerBridges.find(
        (bridge) =>
          bridge.consumerTaskId === "A" && bridge.producerTaskId === "C",
      )?.producerRole,
    ).toBe("CANDIDATE");
    expect(result.taskNodes.map((node) => node.taskId)).toEqual(
      expect.arrayContaining(["A", "B"]),
    );
    expect(result.taskNodes.find((node) => node.taskId === "B")).toMatchObject({
      expansionStatus: expect.stringMatching(/EXPANDED|TERMINAL/),
    });
    expect(result.taskNodes.find((node) => node.taskId === "C")).toMatchObject({
      expansionStatus: "TERMINAL",
      upstreamDecision: null,
    });
    expect(result.terminals).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: "MULTIPLE_OVERLAPPING_PRODUCERS" }),
      ]),
    );
  });

  it("reuses a prepared evidence context without changing the graph result", () => {
    const root = dataRoot();
    for (const table of ["lake.t1", "lake.t2"]) writeTable(root, table);
    writeReader(root, "A", ["lake.t1"]);
    writeProducer(root, "B", "lake.t1", ["lake.t2"]);
    writeProducer(root, "C", "lake.t2");
    const index = buildTableProducerIndex(root, { now: () => FIXED_NOW });
    const standalone = run(root, index, "A", { maxDepth: 2 });
    const [prepared] = reconcileMultiHopBatch([{ taskId: "A" }], {
      dataRoot: root,
      producerIndex: index,
      maxDepth: 2,
      maxTasks: 100,
      maxEdges: 500,
      now: () => FIXED_NOW,
      scheduleEvidenceCacheRoot: null,
    });

    expect(semanticSnapshot(prepared!)).toEqual(semanticSnapshot(standalone));
  });

  it("does not recurse through a mutation-only table write", () => {
    const root = dataRoot();
    writeTable(root, "lake.mutated");
    writeReader(root, "A", ["lake.mutated"]);
    writeTask(root, "truncate-task", {
      target: {
        platform: "hive",
        dataSource: "gfhive",
        qualifiedName: "lake.mutated",
      },
      targetEvidenceKind: "DIRECT_PLATFORM_TARGET",
      writeMode: "truncate",
      sql: { truncate: "TRUNCATE TABLE lake.mutated" },
    });
    const index = buildTableProducerIndex(root, { now: () => FIXED_NOW });
    const result = run(root, index, "A", { maxDepth: 2 });

    expect(result.taskNodes.map((node) => node.taskId)).toEqual(["A"]);
    expect(result.producerBridges).toEqual([]);
    expect(result.writeEdges).toEqual([]);
    expect(result.terminals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: "A",
          reason: "NO_CONFIRMED_PRODUCER_OBSERVED",
          table: expect.objectContaining({ qualifiedName: "lake.mutated" }),
        }),
      ]),
    );
  });

  it("keeps every confirmed producer for one table but never recurses through a non-confirmed candidate", () => {
    const root = dataRoot();
    writeTable(root, "lake.shared");
    writeReader(root, "A", ["lake.shared"]);
    writeProducer(root, "B", "lake.shared");
    writeProducer(root, "C", "lake.shared");
    writeTask(root, "candidate", {
      target: {
        platform: "hive",
        dataSource: "gfhive",
        qualifiedName: "lake.shared",
      },
      targetEvidenceKind: "TABLE_TASK_RELATION_DIRECTION_UNKNOWN",
      evidenceProvider: "fixture:table-task-relation",
    });
    const index = buildTableProducerIndex(root, { now: () => FIXED_NOW });

    const result = run(root, index, "A", { maxDepth: 1 });

    expect(bridgeKeys(result)).toEqual([
      "A:lake.shared:B:1",
      "A:lake.shared:C:1",
    ]);
    expect(result.taskNodes.map((node) => node.taskId)).toEqual([
      "A",
      "B",
      "C",
    ]);
    expect(result.taskNodes.map((node) => node.taskId)).not.toContain(
      "candidate",
    );
    expect(result.producerBridges).toHaveLength(2);
  });

  it("stops an input table with only UNKNOWN direction evidence", () => {
    const root = dataRoot();
    writeTable(root, "lake.candidate_only");
    writeReader(root, "A", ["lake.candidate_only"]);
    writeTask(root, "candidate", {
      target: {
        platform: "hive",
        dataSource: "gfhive",
        qualifiedName: "lake.candidate_only",
      },
      targetEvidenceKind: "TABLE_TASK_RELATION_DIRECTION_UNKNOWN",
      evidenceProvider: "fixture:table-task-relation",
    });
    const index = buildTableProducerIndex(root, { now: () => FIXED_NOW });

    const result = run(root, index, "A");

    expect(result.taskNodes.map((node) => node.taskId)).toEqual(["A"]);
    expect(result.producerBridges).toEqual([]);
    expect(result.terminals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: "A",
          table: expect.objectContaining({
            qualifiedName: "lake.candidate_only",
          }),
          reason: "NO_CONFIRMED_PRODUCER_OBSERVED",
        }),
      ]),
    );
  });

  it("retains a producer with an invalid Task Pack as a terminal instead of using its stale SQL", () => {
    const root = dataRoot();
    for (const table of ["lake.input", "lake.upstream"])
      writeTable(root, table);
    writeReader(root, "A", ["lake.input"]);
    writeProducer(root, "B", "lake.input", ["lake.upstream"]);
    const built = buildTableProducerIndex(root, { now: () => FIXED_NOW });
    const queryPath = join(
      root,
      "tasks",
      "hiveTask-2.0",
      "B",
      "sql",
      "query.sql",
    );
    writeFileSync(queryPath, "SELECT changed_after_hash FROM lake.upstream");
    const index = rehashIndexForCurrentInputs(built, root);

    const result = run(root, index, "A", { maxDepth: 2 });

    expect(bridgeKeys(result)).toEqual(["A:lake.input:B:1"]);
    expect(result.readEdges).toHaveLength(1);
    expect(result.taskNodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: "B",
          minDepth: 1,
          expansionStatus: "TERMINAL",
        }),
      ]),
    );
    expect(terminalReasons(result)).toContain("TASK_INPUT_PACK_INVALID");
  });

  it("retains a confirmed producer whose Task Pack is missing as a terminal", () => {
    const root = dataRoot();
    writeTable(root, "lake.input");
    writeReader(root, "A", ["lake.input"]);
    writeProducer(root, "B", "lake.input");
    const built = buildTableProducerIndex(root, { now: () => FIXED_NOW });
    rmSync(join(root, "tasks", "hiveTask-2.0", "B"), {
      recursive: true,
      force: true,
    });
    const index = rehashIndexForCurrentInputs(built, root);

    const result = run(root, index, "A", { maxDepth: 2 });

    expect(bridgeKeys(result)).toEqual(["A:lake.input:B:1"]);
    expect(result.taskNodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: "B",
          minDepth: 1,
          expansionStatus: "TERMINAL",
        }),
      ]),
    );
    expect(terminalReasons(result)).toContain("TASK_INPUT_PACK_MISSING");
  });

  it("treats the same taskId in two task categories as ambiguous and does not expand it", () => {
    const root = dataRoot();
    writeTable(root, "lake.input");
    writeReader(root, "A", ["lake.input"]);
    writeProducer(root, "B", "lake.input");
    const built = buildTableProducerIndex(root, { now: () => FIXED_NOW });
    writeTaskInput(root, {
      taskId: "B",
      taskCategory: "hiveTask-1.0",
      collectedAt: "2026-08-23T00:00:00.000Z",
      evidenceProvider: "fixture:duplicate-task-category",
      sql: { query: "SELECT 1 AS id" },
    });
    const index = rehashIndexForCurrentInputs(built, root);

    const result = run(root, index, "A", { maxDepth: 2 });

    expect(bridgeKeys(result)).toEqual(["A:lake.input:B:1"]);
    expect(result.taskNodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: "B",
          minDepth: 1,
          expansionStatus: "TERMINAL",
          taskInputPackStatus: "TASK_INPUT_PACK_AMBIGUOUS",
        }),
      ]),
    );
    expect(result.terminals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: "B",
          reason: "TASK_INPUT_PACK_AMBIGUOUS",
        }),
      ]),
    );
  });

  it("blocks a bad statement while still traversing a clean statement in the same Task Pack", () => {
    const root = dataRoot();
    for (const table of ["lake.bad_branch", "lake.good_branch"])
      writeTable(root, table);
    writeTask(root, "A", {
      sql: {
        query: [
          "SELECT id FROM lake.bad_branch WHERE id = ;",
          "SELECT id FROM lake.good_branch;",
        ].join("\n"),
      },
    });
    writeProducer(root, "bad-producer", "lake.bad_branch");
    writeProducer(root, "good-producer", "lake.good_branch");
    const index = buildTableProducerIndex(root, { now: () => FIXED_NOW });

    const result = run(root, index, "A", { maxDepth: 1 });
    const badRead = result.readEdges.find(
      (edge) => edge.table.qualifiedName === "lake.bad_branch",
    );
    const goodRead = result.readEdges.find(
      (edge) => edge.table.qualifiedName === "lake.good_branch",
    );

    expect(badRead).toMatchObject({
      consumerTaskId: "A",
      recursionStatus: "BLOCKED",
      eligibleStatementIndexes: [],
      blockedStatementIndexes: [0],
      blockReasons: ["SQL_PARSE_FAILED"],
    });
    expect(goodRead).toMatchObject({
      consumerTaskId: "A",
      recursionStatus: "ELIGIBLE",
      eligibleStatementIndexes: [1],
      blockedStatementIndexes: [],
      blockReasons: [],
    });
    expect(bridgeKeys(result)).toEqual(["A:lake.good_branch:good-producer:1"]);
    expect(result.taskNodes.map((node) => node.taskId)).not.toContain(
      "bad-producer",
    );
    expect(result.terminals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: "A",
          table: expect.objectContaining({
            qualifiedName: "lake.bad_branch",
          }),
          reason: "SQL_PARSE_FAILED",
        }),
      ]),
    );
  });

  it("retains an ambiguous table READ but does not query its confirmed producer edge", () => {
    const root = dataRoot();
    writeTable(root, "lake.ambiguous");
    writeTableInput(root, {
      platform: "hive",
      dataSource: "secondary-hive",
      qualifiedName: "lake.ambiguous",
      schema: "lake",
      name: "ambiguous",
      objectType: "TABLE",
      ddl: "CREATE TABLE lake.ambiguous (id bigint)",
      evidenceProvider: "fixture:second-table-identity",
      collectedAt: "2026-08-23T00:00:00.000Z",
    });
    writeReader(root, "A", ["lake.ambiguous"]);
    writeProducer(root, "B", "lake.ambiguous");
    const index = buildTableProducerIndex(root, { now: () => FIXED_NOW });
    expect(
      index.confirmedProducerEdges.some((edge) => edge.taskId === "B"),
    ).toBe(true);

    const result = run(root, index, "A", { maxDepth: 2 });

    expect(result.readEdges).toEqual([
      expect.objectContaining({
        consumerTaskId: "A",
        table: expect.objectContaining({
          qualifiedName: "lake.ambiguous",
          identityStatus: "AMBIGUOUS",
          platform: null,
          dataSource: null,
        }),
        recursionStatus: "BLOCKED",
        blockReasons: ["TABLE_IDENTITY_UNRESOLVED"],
      }),
    ]);
    expect(result.producerBridges).toEqual([]);
    expect(result.taskNodes.map((node) => node.taskId)).toEqual(["A"]);
    expect(result.terminals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: "A",
          table: expect.objectContaining({
            qualifiedName: "lake.ambiguous",
            identityStatus: "AMBIGUOUS",
          }),
          reason: "TABLE_IDENTITY_UNRESOLVED",
        }),
      ]),
    );
  });

  it("skips external producer recursion for TEMP tables", () => {
    const root = dataRoot();
    writeTable(root, "temp.resolved_scratch");
    writeReader(root, "A", ["temp.resolved_scratch", "temp.unresolved_scratch"]);
    const index = buildTableProducerIndex(root, { now: () => FIXED_NOW });

    const result = run(root, index, "A", { maxDepth: 2 });

    expect(result.taskNodes.map((node) => node.taskId)).toEqual(["A"]);
    expect(result.producerBridges).toEqual([]);
    expect(result.terminals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: "A",
          reason: "TASK_LOCAL_MATERIALIZATION",
          table: expect.objectContaining({ qualifiedName: "temp.resolved_scratch" }),
          detail: { rule: "QUALIFIED_NAME_PREFIX", pattern: "TEMP.*" },
        }),
        expect.objectContaining({
          taskId: "A",
          reason: "TASK_LOCAL_MATERIALIZATION",
          table: expect.objectContaining({ qualifiedName: "temp.unresolved_scratch" }),
          detail: { rule: "QUALIFIED_NAME_PREFIX", pattern: "TEMP.*" },
        }),
      ]),
    );
    expect(terminalReasons(result)).not.toContain("NO_CONFIRMED_PRODUCER_OBSERVED");
    expect(terminalReasons(result)).not.toContain("TABLE_IDENTITY_UNRESOLVED");
  });

  it("detects self and two-task cycles without repeatedly expanding tasks", () => {
    const selfRoot = dataRoot();
    writeTable(selfRoot, "lake.self");
    writeProducer(selfRoot, "A", "lake.self", ["lake.self"]);
    const selfIndex = buildTableProducerIndex(selfRoot, {
      now: () => FIXED_NOW,
    });
    const selfResult = run(selfRoot, selfIndex, "A", { maxDepth: 5 });

    expect(selfResult.taskNodes.map((node) => node.taskId)).toEqual(["A"]);
    expect(bridgeKeys(selfResult)).toEqual(["A:lake.self:A:1"]);
    expect(terminalReasons(selfResult)).toContain("CYCLE");

    const pairRoot = dataRoot();
    for (const table of ["lake.a", "lake.b"]) writeTable(pairRoot, table);
    writeProducer(pairRoot, "A", "lake.a", ["lake.b"]);
    writeProducer(pairRoot, "B", "lake.b", ["lake.a"]);
    const pairIndex = buildTableProducerIndex(pairRoot, {
      now: () => FIXED_NOW,
    });
    const pairResult = run(pairRoot, pairIndex, "A", { maxDepth: 5 });

    expect(pairResult.taskNodes.map((node) => node.taskId)).toEqual(["A", "B"]);
    expect(bridgeKeys(pairResult)).toEqual(["A:lake.b:B:1", "B:lake.a:A:2"]);
    expect(terminalReasons(pairResult)).toContain("CYCLE");
  });

  it("deduplicates a diamond task node while retaining both producer bridges", () => {
    const root = dataRoot();
    for (const table of ["lake.left", "lake.right", "lake.shared_upstream"])
      writeTable(root, table);
    writeReader(root, "A", ["lake.left", "lake.right"]);
    writeProducer(root, "B", "lake.left", ["lake.shared_upstream"]);
    writeProducer(root, "C", "lake.right", ["lake.shared_upstream"]);
    writeProducer(root, "D", "lake.shared_upstream");
    const index = buildTableProducerIndex(root, { now: () => FIXED_NOW });

    const result = run(root, index, "A", { maxDepth: 2 });

    expect(result.taskNodes.map((node) => node.taskId)).toEqual([
      "A",
      "B",
      "C",
      "D",
    ]);
    expect(bridgeKeys(result)).toEqual([
      "A:lake.left:B:1",
      "A:lake.right:C:1",
      "B:lake.shared_upstream:D:2",
      "C:lake.shared_upstream:D:2",
    ]);
    expect(
      result.writeEdges.filter((edge) => edge.producerTaskId === "D"),
    ).toHaveLength(1);
    expect(
      result.terminals.filter(
        (terminal) =>
          terminal.taskId === "D" && terminal.reason === "MAX_DEPTH_REACHED",
      ),
    ).toHaveLength(1);
  });

  it("applies deterministic maxTasks and maxEdges truncation", () => {
    const root = dataRoot();
    writeTable(root, "lake.shared");
    writeReader(root, "A", ["lake.shared"]);
    writeProducer(root, "B", "lake.shared");
    writeProducer(root, "C", "lake.shared");
    writeProducer(root, "D", "lake.shared");
    const index = buildTableProducerIndex(root, { now: () => FIXED_NOW });

    const first = run(root, index, "A", {
      maxTasks: 2,
      now: () => "2026-08-23T08:00:00.000Z",
    });
    const second = run(root, index, "A", {
      maxTasks: 2,
      now: () => "2026-08-23T09:00:00.000Z",
    });

    expect(first.taskNodes.map((node) => node.taskId)).toEqual(["A", "B"]);
    expect(
      first.producerBridges.every((bridge) =>
        first.taskNodes.some((node) => node.taskId === bridge.producerTaskId),
      ),
    ).toBe(true);
    expect(
      first.producerBridges.map((bridge) => bridge.producerTaskId),
    ).toEqual(["B"]);
    expect(
      first.taskNodes.find((node) => node.taskId === "A")?.expansionStatus,
    ).toBe("TRUNCATED");
    expect(first.coverage.status).toBe("PARTIAL_EVIDENCE");
    expect(first.limits).toMatchObject({
      maxTasks: 2,
      truncated: true,
      truncationReason: "MAX_TASKS_REACHED",
    });
    expect(terminalReasons(first)).toContain("MAX_TASKS_REACHED");
    expect(semanticSnapshot(second)).toEqual(semanticSnapshot(first));
    expect(second.contentHash).toBe(first.contentHash);

    const edgeLimited = run(root, index, "A", { maxEdges: 1 });
    expect(
      edgeLimited.readEdges.length + edgeLimited.writeEdges.length,
    ).toBeLessThanOrEqual(1);
    expect(edgeLimited.limits).toMatchObject({
      maxEdges: 1,
      truncated: true,
      truncationReason: "MAX_EDGES_REACHED",
    });
    expect(
      edgeLimited.taskNodes.find((node) => node.taskId === "A")
        ?.expansionStatus,
    ).toBe("TRUNCATED");
    expect(edgeLimited.coverage.status).toBe("PARTIAL_EVIDENCE");
    expect(terminalReasons(edgeLimited)).toContain("MAX_EDGES_REACHED");
  });

  it("preserves a parser failure with no physical input instead of reporting no reads", () => {
    const root = dataRoot();
    writeTask(root, "A", { sql: { query: "THIS IS NOT SQL" } });
    const index = buildTableProducerIndex(root, { now: () => FIXED_NOW });

    const result = run(root, index, "A");

    expect(result.readEdges).toEqual([]);
    expect(terminalReasons(result)).toContain("SQL_PARSE_FAILED");
    expect(terminalReasons(result)).not.toContain("NO_DIRECT_READS");
    expect(result.taskNodes).toEqual([
      expect.objectContaining({
        taskId: "A",
        expansionStatus: "TERMINAL",
      }),
    ]);
  });

  it("fails closed on a stale producer index before traversing root SQL", () => {
    const root = dataRoot();
    writeTable(root, "lake.input");
    writeReader(root, "A", ["lake.input"]);
    writeProducer(root, "B", "lake.input");
    const index = buildTableProducerIndex(root, { now: () => FIXED_NOW });
    writeTask(root, "input-added-after-index", {
      sql: { query: "SELECT 1" },
    });

    expect(() =>
      reconcileMultiHop("A", {
        dataRoot: root,
        producerIndex: index,
        maxDepth: 2,
        maxTasks: 100,
        maxEdges: 500,
        now: () => FIXED_NOW,
      }),
    ).toThrow("PRODUCER_INDEX_STALE");
  });

  it("consumes confirmed edges from a valid PARTIAL index and marks evidence coverage partial", () => {
    const root = dataRoot();
    writeTable(root, "lake.input");
    writeReader(root, "A", ["lake.input"]);
    writeProducer(root, "B", "lake.input");
    writeTask(root, "unrelated-invalid", {
      sql: { query: "SELECT 1" },
    });
    const invalidPath = join(
      root,
      "tasks",
      "hiveTask-2.0",
      "unrelated-invalid",
      "sql",
      "query.sql",
    );
    writeFileSync(invalidPath, "SELECT changed_after_hash");
    const index = buildTableProducerIndex(root, { now: () => FIXED_NOW });
    expect(index.buildStatus).toBe("PARTIAL");

    const result = run(root, index, "A", { maxDepth: 1 });

    expect(bridgeKeys(result)).toEqual(["A:lake.input:B:1"]);
    expect(result.coverage).toMatchObject({
      status: "PARTIAL_EVIDENCE",
      producerIndexStatus: "VALID_PARTIAL",
    });
  });

  it("keeps the root depth-1 schedule snapshot separate from data traversal", () => {
    const root = dataRoot();
    writeTable(root, "lake.input");
    writeReader(root, "A", ["lake.input"]);
    writeProducer(root, "data-producer", "lake.input");
    const index = buildTableProducerIndex(root, { now: () => FIXED_NOW });
    const snapshot = rootOneHop(root, index, "A", [
      {
        task_id: "schedule-only-parent",
        task_name: "schedule only",
        direction: "上游",
      },
    ]);

    const result = run(root, index, "A", {
      maxDepth: 1,
      rootOneHop: snapshot,
    });

    expect(result.scheduleSkeleton).toMatchObject({
      boundary: "ROOT_DEPTH_1_ONLY",
      parents: [expect.objectContaining({ taskId: "schedule-only-parent" })],
    });
    expect(result.taskNodes.map((node) => node.taskId)).toEqual([
      "A",
      "data-producer",
    ]);
    expect(result.taskNodes.map((node) => node.taskId)).not.toContain(
      "schedule-only-parent",
    );
  });

  frozen86840It(
    "replays frozen 86840 at depth one with 27 reads, 22 local producers, and ref_dw_cd_val terminal",
    () => {
      const fixtureRoot = join(
        import.meta.dirname,
        "fixtures",
        "reconcile-one-hop",
      );
      const frozenEvidence = JSON.parse(
        readFileSync(join(fixtureRoot, "86840-evidence.json"), "utf8"),
      ) as { horaeRows: Record<string, unknown>[] };
      const root = materializeFrozenInputPack(
        join(fixtureRoot, "86840-input-pack"),
      );
      const index = buildTableProducerIndex(root, { now: () => FIXED_NOW });
      const snapshot = rootOneHop(
        root,
        index,
        "86840",
        frozenEvidence.horaeRows,
      );

      const result = run(root, index, "86840", {
        maxDepth: 1,
        maxTasks: 100,
        maxEdges: 500,
        rootOneHop: snapshot,
      });

      expect(result.readEdges).toHaveLength(27);
      expect(result.producerBridges).toHaveLength(22);
      expect(result.taskNodes).toHaveLength(23);
      expect(result.scheduleSkeleton.parents).toHaveLength(26);
      expect(result.terminals).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            taskId: "86840",
            table: expect.objectContaining({
              qualifiedName: "pdata_n.ref_dw_cd_val",
            }),
            reason: "NO_CONFIRMED_PRODUCER_OBSERVED",
          }),
        ]),
      );
      expect(
        result.producerBridges.some(
          (bridge) => bridge.table.qualifiedName === "pdata_n.ref_dw_cd_val",
        ),
      ).toBe(false);
    },
  );

  it("publishes and enforces a closed multi-hop artifact contract", () => {
    const root = dataRoot();
    writeTable(root, "lake.input");
    writeReader(root, "A", ["lake.input"]);
    writeProducer(root, "B", "lake.input");
    const index = buildTableProducerIndex(root, { now: () => FIXED_NOW });
    const result = run(root, index, "A", { maxDepth: 1 });

    expect(() => validateMultiHopReconciliation(result)).not.toThrow();
    expect(() =>
      validateMultiHopReconciliation({
        ...result,
        readEdges: [{ table: result.readEdges[0]!.table }],
      }),
    ).toThrow("CONSUMERTASKID_INVALID");
    expect(() =>
      validateMultiHopReconciliation({
        ...result,
        tableNodes: [
          {
            platform: "hive",
            dataSource: "default",
            qualifiedName: "lake.input",
            identityStatus: "RESOLVED",
          },
        ],
      }),
    ).toThrow("RESOLVED_IDENTITY_INVALID");
    const withoutTableNodes = {
      ...result,
      tableNodes: [],
      counts: { ...result.counts, tableNodes: 0 },
    };
    const missingTableEndpoint = {
      ...withoutTableNodes,
      contentHash: canonicalHash(withoutTableNodes as unknown as JsonValue, [
        "generatedAt",
        "contentHash",
      ]),
    };
    expect(() => validateMultiHopReconciliation(missingTableEndpoint)).toThrow(
      "READ_EDGE_TABLE_MISSING",
    );
    const wrongProducerIndex = {
      ...result,
      writeEdges: result.writeEdges.map((edge) => ({
        ...edge,
        producerIndexContentHash: "0".repeat(64),
      })),
    };
    expect(() => validateMultiHopReconciliation(wrongProducerIndex)).toThrow(
      "WRITE_EDGE_PRODUCER_INDEX_MISMATCH",
    );

    const schema = JSON.parse(
      readFileSync(
        join(
          process.cwd(),
          "schemas",
          "table-multi-hop-reconciliation.schema.json",
        ),
        "utf8",
      ),
    ) as {
      properties: Record<string, Record<string, unknown>>;
    };
    for (const field of ["readEdges", "writeEdges", "producerBridges"])
      expect(
        (schema.properties[field]!.items as Record<string, unknown>)
          .additionalProperties,
      ).toBe(false);
    const writeObservation = (
      schema as unknown as { $defs: Record<string, unknown> }
    ).$defs.writeObservation as { properties: Record<string, unknown> };
    for (const field of [
      "targetEvidenceKind",
      "writeDirection",
      "operationClass",
      "dataPathRole",
    ])
      expect(writeObservation.properties[field]).toBeDefined();
    expect(schema.properties.coverage!.additionalProperties).toBe(false);
  });

  it("rejects malformed root schedule evidence before copying it", () => {
    const root = dataRoot();
    writeTable(root, "lake.input");
    writeReader(root, "A", ["lake.input"]);
    writeProducer(root, "B", "lake.input");
    const index = buildTableProducerIndex(root, { now: () => FIXED_NOW });
    const snapshot = rootOneHop(root, index, "A", [
      { task_id: "schedule-parent", direction: "上游" },
    ]);
    const malformed = {
      ...snapshot,
      schedule: {
        ...snapshot.schedule,
        parents: snapshot.schedule.parents.map((parent) => ({
          ...parent,
          evidence: [
            {
              source: "HORAE_RELATION",
              provider: "fixture:horae",
              locator: "fixture:missing-observed-at",
            },
          ],
        })),
      },
    };

    expect(() =>
      reconcileMultiHop("A", {
        dataRoot: root,
        producerIndex: index,
        maxDepth: 1,
        maxTasks: 100,
        maxEdges: 500,
        rootOneHop: malformed as unknown as OneHopReconciliationResult,
      }),
    ).toThrow("ROOT_ONE_HOP_INVALID");
  });
});
