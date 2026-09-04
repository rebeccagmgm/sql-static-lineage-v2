import { describe, expect, it } from "vitest";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildSparkIndexTaskEvidence,
  collectOneSparkIndexTask,
  HoraeSerialGate,
  horaeDetailCommandArguments,
  mergeSparkIndexEvidence,
} from "../scripts/input/mainline/collect-one-task-input-pack-sparkindex.ts";
import {
  resolveSparkIndexTables,
  SparkIndexTableMcpGate,
  sparkIndexStableTableKey,
} from "../scripts/input/shared/sparkindex-table-evidence.ts";
import {
  writeTableInput,
  writeTaskInput,
  type TaskEvidence,
} from "../scripts/input/shared/input-pack.ts";
import {
  horaeTaskTypeCachePath,
  readHoraeTaskTypeCache,
  writeHoraeTaskTypeCache,
} from "../scripts/reconcile/consumer/one-hop/schedule-evidence-cache.ts";
import { ScheduleDetailSerialGate } from "../scripts/input/mainline/szdata-schedule-detail-cache.ts";

const FIXED_NOW = () => new Date("2026-08-31T00:00:00.000Z");

function writeMetadataSnapshot(
  path: string,
  qualifiedNames: readonly string[],
  duplicateName?: string,
): void {
  const names = duplicateName === undefined
    ? qualifiedNames
    : [...qualifiedNames, duplicateName];
  writeFileSync(
    path,
    `${names
      .map((qualifiedName) =>
        JSON.stringify({
          qualifiedname_clean: qualifiedName,
          datasource: "gfhive",
          status: "ACTIVE",
          type_name: "hive_table",
        }),
      )
      .join("\n")}\n`,
    "utf8",
  );
}

function scheduleDetail(
  taskId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    taskId,
    taskName: `spark_${taskId}`,
    taskType: "100",
    topicName: "DM_INDEX_N",
    targetTable: "db.target",
    insertMode: "overwrite",
    querySql: "SELECT 1",
    ...overrides,
  };
}

function tableDdl(name: string): string {
  return `CREATE TABLE ${name} (id BIGINT);`;
}

function tableDirectories(dataRoot: string): string[] {
  const root = join(dataRoot, "tables", "hive");
  return existsSync(root)
    ? readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()
    : [];
}

function taskDocument(directory: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(directory, "task.json"), "utf8")) as Record<
    string,
    unknown
  >;
}

describe("collect-one-task-input-pack-sparkindex", () => {
  it("builds a SparkIndex Task Pack from Horae detail SQL", () => {
    const evidence = buildSparkIndexTaskEvidence("100931", {
      taskType: 64,
      taskName: "index task",
      topicName: "index topic",
      writeTable: "dm_index_n.index_grp_assm_trust_auth_end_date",
      insertMode: "overwrite",
      createSql:
        "CREATE TABLE dm_index_n.index_grp_assm_trust_auth_end_date (id BIGINT);",
      prepareSql:
        "ALTER TABLE dm_index_n.index_grp_assm_trust_auth_end_date DROP IF EXISTS PARTITION (busi_date='${YYYY-MM-DD}');",
      querySql: "SELECT id FROM source_table",
    });

    expect(evidence.taskCategory).toBe("sparkIndex");
    expect(evidence.taskType).toBe("64");
    expect(evidence.target).toBe(
      "dm_index_n.index_grp_assm_trust_auth_end_date",
    );
    expect(evidence.writeMode).toBe("overwrite");
    expect(evidence.sql?.create).toMatchObject({
      evidenceProvider: "opencli:horae.detail",
    });
    expect(evidence.sql?.query).toMatchObject({
      content: "SELECT id FROM source_table",
    });
  });

  it("normalizes '-' to null and keeps a no-SQL task partial", () => {
    const evidence = buildSparkIndexTaskEvidence("99614", {
      source: "-",
      targetTable: "-",
      querySql: "-",
      prepareSql: null,
    });
    expect(evidence.source).toBeNull();
    expect(evidence.target).toBeNull();
    expect(evidence.sql).toEqual({});

    const dataRoot = mkdtempSync(join(tmpdir(), "sparkindex-input-pack-"));
    const cacheRoot = mkdtempSync(join(tmpdir(), "sparkindex-cache-"));
    try {
      const result = collectOneSparkIndexTask(dataRoot, "99614", {
        cacheRoot,
        metadataSnapshotPath: null,
        scheduleDetailGate: new ScheduleDetailSerialGate({ minIntervalMs: 0 }),
        horaeGate: new HoraeSerialGate({ minIntervalMs: 0 }),
        runScheduleDetail: () =>
          scheduleDetail("99614", {
            targetTable: "-",
            insertMode: "-",
            querySql: "-",
          }),
        runHoraeDetail: () => ({}),
        now: FIXED_NOW,
      });
      expect(result.collectionStatus).toBe("PARTIAL");
      expect(result.sqlSlots).toEqual([]);
      expect(existsSync(join(result.directory, "task.json"))).toBe(true);
      expect(taskDocument(result.directory).sqlFiles).toEqual([]);
    } finally {
      rmSync(dataRoot, { recursive: true, force: true });
      rmSync(cacheRoot, { recursive: true, force: true });
    }
  });

  it("keeps Horae calls serial with a two-second minimum interval", () => {
    let now = 1_000;
    const sleeps: number[] = [];
    const gate = new HoraeSerialGate({
      now: () => now,
      sleep: (milliseconds) => {
        sleeps.push(milliseconds);
        now += milliseconds;
      },
    });

    gate.beforeCall();
    gate.beforeCall();
    now += 2_000;
    gate.beforeCall();

    expect(sleeps).toEqual([2_000]);
  });

  it("materializes the 66411 structured five-table shape offline", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "sparkindex-input-pack-"));
    const cacheRoot = mkdtempSync(join(tmpdir(), "sparkindex-cache-"));
    const snapshotPath = join(cacheRoot, "hive-snapshot.jsonl");
    const names = [
      "dm_index_n.hold_tag_relation",
      "dm_index_n.tag_def",
      "dm_index_n.hold_tag_relation_pre",
      "dm_index_n.hold_def_hot",
      "pdata_news_n.t02_scr_type",
    ];
    writeMetadataSnapshot(snapshotPath, names);
    const guidToName = new Map<string, string>();
    const guidCalls: string[] = [];
    const ddlCalls: string[] = [];
    try {
      const result = collectOneSparkIndexTask(dataRoot, "66411", {
        cacheRoot,
        metadataSnapshotPath: snapshotPath,
        scheduleDetailGate: new ScheduleDetailSerialGate({ minIntervalMs: 0 }),
        tableMcpGate: new SparkIndexTableMcpGate({ minIntervalMs: 0 }),
        runScheduleDetail: () =>
          scheduleDetail("66411", {
            taskName: "dm_index_n.hold_tag_relation_v3_complex_27",
            targetTable: "dm_index_n.hold_tag_relation",
            querySql:
              "SELECT h.id FROM dm_index_n.tag_def h JOIN dm_index_n.hold_tag_relation_pre p ON h.id = p.id",
            prepareSql:
              "ALTER TABLE dm_index_n.hold_tag_relation DROP IF EXISTS PARTITION (dt='${YYYYMMDD}');\nALTER TABLE dm_index_n.hold_tag_relation_pre DROP IF EXISTS PARTITION (dt='${YYYYMMDD}');\nINSERT OVERWRITE TABLE dm_index_n.hold_tag_relation_pre SELECT h.id FROM dm_index_n.hold_def_hot h JOIN pdata_news_n.t02_scr_type s ON h.type = s.type;",
          }),
        runTableGuid: (database, table) => {
          const qualifiedName = `${database}.${table}`;
          const guid = `temporary-locator-${table}`;
          guidCalls.push(qualifiedName);
          guidToName.set(guid, qualifiedName);
          return [{ guid, qualifiedName: `${qualifiedName}@gfhive`, dataSource: "gfhive" }];
        },
        runTableDdl: (guid) => {
          const qualifiedName = guidToName.get(guid);
          ddlCalls.push(guid);
          return [
            {
              qualifiedName: `${qualifiedName}@gfhive`,
              ddl: tableDdl(qualifiedName ?? "db.missing"),
            },
          ];
        },
        now: FIXED_NOW,
      });

      expect(result.collectionStatus).toBe("SUCCESS");
      expect([...result.tableCandidates].sort()).toEqual(names.slice().sort());
      expect(result.tablesWritten).toBe(5);
      expect(result.tablesUnavailable).toEqual([]);
      expect(guidCalls).toHaveLength(5);
      expect(ddlCalls).toHaveLength(5);
      expect(tableDirectories(dataRoot)).toEqual(
        names.map((name) => `${name}__gfhive`).sort(),
      );
      expect(tableDirectories(dataRoot).some((name) => name.includes("@gfhive"))).toBe(false);

      const document = taskDocument(result.directory);
      expect(document.target).toEqual({
        platform: "hive",
        qualifiedName: "dm_index_n.hold_tag_relation",
        dataSource: "gfhive",
      });
      expect(document.writeMode).toBe("overwrite");
      expect(
        readFileSync(join(result.directory, "sql", "query.sql"), "utf8"),
      ).toContain("dm_index_n.tag_def");
      expect(
        readFileSync(join(result.directory, "sql", "prepare.sql"), "utf8"),
      ).toContain("pdata_news_n.t02_scr_type");
      for (const directory of tableDirectories(dataRoot)) {
        const table = JSON.parse(
          readFileSync(join(dataRoot, "tables", "hive", directory, "table.json"), "utf8"),
        ) as Record<string, unknown>;
        expect(table).not.toHaveProperty("guid");
        expect(
          existsSync(join(dataRoot, "tables", "hive", directory, "ddl.sql")),
        ).toBe(true);
      }
    } finally {
      rmSync(dataRoot, { recursive: true, force: true });
      rmSync(cacheRoot, { recursive: true, force: true });
    }
  });

  it("keeps the Task Pack when an MCP runner fails and aborts later MCP calls", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "sparkindex-input-pack-"));
    const cacheRoot = mkdtempSync(join(tmpdir(), "sparkindex-cache-"));
    const snapshotPath = join(cacheRoot, "hive-snapshot.jsonl");
    writeMetadataSnapshot(snapshotPath, ["db.a", "db.b"]);
    const guidCalls: string[] = [];
    const ddlCalls: string[] = [];
    try {
      const result = collectOneSparkIndexTask(dataRoot, "mcp-error", {
        cacheRoot,
        metadataSnapshotPath: snapshotPath,
        scheduleDetailGate: new ScheduleDetailSerialGate({ minIntervalMs: 0 }),
        tableMcpGate: new SparkIndexTableMcpGate({ minIntervalMs: 0 }),
        runScheduleDetail: () =>
          scheduleDetail("mcp-error", {
            targetTable: "db.a",
            querySql: "SELECT 1 FROM db.b",
          }),
        runTableGuid: (database, table) => {
          guidCalls.push(`${database}.${table}`);
          throw new Error("403 Forbidden");
        },
        runTableDdl: () => {
          ddlCalls.push("ddl");
          throw new Error("TABLE_DDL_MUST_NOT_RUN_AFTER_GUID_ERROR");
        },
        now: FIXED_NOW,
      });

      expect(result.collectionStatus).toBe("PARTIAL");
      expect(result.tablesWritten).toBe(0);
      expect(result.tablesUnavailable).toEqual(["db.a", "db.b"]);
      expect(result.tableResolutionReasons[0]).toContain(
        "MCP_TABLE_GUID_FAILED:403 Forbidden",
      );
      expect(result.tableResolutionReasons[1]).toContain(
        "MCP_ABORTED_AFTER_ERROR:MCP_TABLE_GUID_FAILED",
      );
      expect(guidCalls).toEqual(["db.a"]);
      expect(ddlCalls).toEqual([]);
      expect(existsSync(join(result.directory, "task.json"))).toBe(true);
    } finally {
      rmSync(dataRoot, { recursive: true, force: true });
      rmSync(cacheRoot, { recursive: true, force: true });
    }
  });

  it("enforces the MCP gate and never uses a GUID as the stable key", () => {
    let now = 1_000;
    const sleeps: number[] = [];
    const gate = new SparkIndexTableMcpGate({
      minIntervalMs: 2_000,
      now: () => now,
      sleep: (milliseconds) => {
        sleeps.push(milliseconds);
        now += milliseconds;
      },
    });
    gate.beforeCall();
    gate.beforeCall();
    expect(sleeps).toEqual([2_000]);
    expect(sparkIndexStableTableKey("DB.Table", "GFHIVE")).toBe(
      "db.table@gfhive",
    );
  });

  it("caches the Hive snapshot by absolute path and file stat", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "sparkindex-input-pack-"));
    const cacheRoot = mkdtempSync(join(tmpdir(), "sparkindex-cache-"));
    const snapshotPath = join(cacheRoot, "hive-snapshot.jsonl");
    writeMetadataSnapshot(snapshotPath, ["db.snapshot_target"]);
    const evidence = buildSparkIndexTaskEvidence("snapshot-cache", {
      targetTable: "db.snapshot_target",
    });
    try {
      const first = resolveSparkIndexTables(dataRoot, evidence, {
        metadataSnapshotPath: snapshotPath,
        runTableGuid: () => [],
        now: FIXED_NOW,
      });
      expect(first.unavailable[0]?.reason).toBe("MCP_TABLE_GUID_NOT_UNIQUE");

      writeMetadataSnapshot(snapshotPath, ["db.other_snapshot_target"]);
      const second = resolveSparkIndexTables(dataRoot, evidence, {
        metadataSnapshotPath: snapshotPath,
        runTableGuid: () => [],
        now: FIXED_NOW,
      });
      expect(second.unavailable[0]?.reason).toBe("SNAPSHOT_NO_UNIQUE_ACTIVE");
    } finally {
      rmSync(dataRoot, { recursive: true, force: true });
      rmSync(cacheRoot, { recursive: true, force: true });
    }
  });

  it("reuses a shared Table Pack across two tasks without a second MCP call", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "sparkindex-input-pack-"));
    const cacheRoot = mkdtempSync(join(tmpdir(), "sparkindex-cache-"));
    const snapshotPath = join(cacheRoot, "hive-snapshot.jsonl");
    writeMetadataSnapshot(snapshotPath, ["db.shared_target"]);
    const guidCalls: string[] = [];
    const ddlCalls: string[] = [];
    try {
      const first = collectOneSparkIndexTask(dataRoot, "task-a", {
        cacheRoot,
        metadataSnapshotPath: snapshotPath,
        scheduleDetailGate: new ScheduleDetailSerialGate({ minIntervalMs: 0 }),
        tableMcpGate: new SparkIndexTableMcpGate({ minIntervalMs: 0 }),
        runScheduleDetail: () =>
          scheduleDetail("task-a", { targetTable: "db.shared_target" }),
        runTableGuid: (database, table) => {
          guidCalls.push(`${database}.${table}`);
          return [
            {
              guid: "guid-is-only-a-locator",
              qualifiedName: `${database}.${table}`,
              dataSource: "gfhive",
            },
          ];
        },
        runTableDdl: () => {
          ddlCalls.push("ddl");
          return [
            {
              qualifiedName: "db.shared_target",
              ddl: tableDdl("db.shared_target"),
            },
          ];
        },
        now: FIXED_NOW,
      });
      expect(first.tablesWritten).toBe(1);

      const second = collectOneSparkIndexTask(dataRoot, "task-b", {
        cacheRoot,
        metadataSnapshotPath: snapshotPath,
        scheduleDetailGate: new ScheduleDetailSerialGate({ minIntervalMs: 0 }),
        runScheduleDetail: () =>
          scheduleDetail("task-b", { targetTable: "db.shared_target" }),
        runTableGuid: () => {
          throw new Error("TABLE_GUID_MUST_NOT_RUN_ON_TABLE_PACK_HIT");
        },
        runTableDdl: () => {
          throw new Error("TABLE_DDL_MUST_NOT_RUN_ON_TABLE_PACK_HIT");
        },
        now: FIXED_NOW,
      });

      expect(second.collectionStatus).toBe("SUCCESS");
      expect(second.tablesWritten).toBe(1);
      expect(guidCalls).toEqual(["db.shared_target"]);
      expect(ddlCalls).toEqual(["ddl"]);
      expect(tableDirectories(dataRoot)).toEqual(["db.shared_target__gfhive"]);
      expect(tableDirectories(dataRoot)).not.toContain("db.shared_target@gfhive");
    } finally {
      rmSync(dataRoot, { recursive: true, force: true });
      rmSync(cacheRoot, { recursive: true, force: true });
    }
  });

  it("uses a valid existing Table Pack before MCP", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "sparkindex-input-pack-"));
    const cacheRoot = mkdtempSync(join(tmpdir(), "sparkindex-cache-"));
    const snapshotPath = join(cacheRoot, "hive-snapshot.jsonl");
    writeMetadataSnapshot(
      snapshotPath,
      ["db.cached_target"],
      "db.cached_target",
    );
    try {
      writeTableInput(dataRoot, {
        platform: "hive",
        dataSource: "gfhive",
        qualifiedName: "db.cached_target",
        objectType: "hive_table",
        ddl: tableDdl("db.cached_target"),
        evidenceProvider: "test:table-pack",
        collectedAt: "2026-08-31T00:00:00.000Z",
      });
      const result = collectOneSparkIndexTask(dataRoot, "cached-task", {
        cacheRoot,
        metadataSnapshotPath: snapshotPath,
        scheduleDetailGate: new ScheduleDetailSerialGate({ minIntervalMs: 0 }),
        runScheduleDetail: () =>
          scheduleDetail("cached-task", { targetTable: "db.cached_target" }),
        runTableGuid: () => {
          throw new Error("TABLE_GUID_MUST_NOT_RUN_ON_LOCAL_HIT");
        },
        runTableDdl: () => {
          throw new Error("TABLE_DDL_MUST_NOT_RUN_ON_LOCAL_HIT");
        },
        now: FIXED_NOW,
      });
      expect(result.collectionStatus).toBe("SUCCESS");
      expect(result.tablesUnavailable).toEqual([]);
      expect(tableDirectories(dataRoot)).toEqual(["db.cached_target__gfhive"]);
      expect(tableDirectories(dataRoot)).not.toContain("db.cached_target@gfhive");
    } finally {
      rmSync(dataRoot, { recursive: true, force: true });
      rmSync(cacheRoot, { recursive: true, force: true });
    }
  });

  it("does not materialize exact CREATE without a usable metadata snapshot", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "sparkindex-input-pack-"));
    const cacheRoot = mkdtempSync(join(tmpdir(), "sparkindex-cache-"));
    const missingSnapshotPath = join(cacheRoot, "missing-snapshot.jsonl");
    try {
      const result = collectOneSparkIndexTask(dataRoot, "create-no-snapshot", {
        cacheRoot,
        metadataSnapshotPath: missingSnapshotPath,
        scheduleDetailGate: new ScheduleDetailSerialGate({ minIntervalMs: 0 }),
        runScheduleDetail: () =>
          scheduleDetail("create-no-snapshot", {
            targetTable: "db.create_without_snapshot",
            createSql: "CREATE TABLE db.create_without_snapshot (id BIGINT);",
          }),
        runTableGuid: () => {
          throw new Error("TABLE_GUID_MUST_NOT_RUN_WITHOUT_SNAPSHOT");
        },
        runTableDdl: () => {
          throw new Error("TABLE_DDL_MUST_NOT_RUN_WITHOUT_SNAPSHOT");
        },
        now: FIXED_NOW,
      });

      expect(result.collectionStatus).toBe("PARTIAL");
      expect(result.tablesWritten).toBe(0);
      expect(result.tableResolutionReasons).toContain(
        "db.create_without_snapshot:SNAPSHOT_UNAVAILABLE",
      );
      expect(tableDirectories(dataRoot)).toEqual([]);
      expect(existsSync(join(result.directory, "task.json"))).toBe(true);
    } finally {
      rmSync(dataRoot, { recursive: true, force: true });
      rmSync(cacheRoot, { recursive: true, force: true });
    }
  });

  it("treats a Table Pack DDL hash mismatch as a cache miss", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "sparkindex-input-pack-"));
    const cacheRoot = mkdtempSync(join(tmpdir(), "sparkindex-cache-"));
    const snapshotPath = join(cacheRoot, "hive-snapshot.jsonl");
    writeMetadataSnapshot(snapshotPath, ["db.invalid_target"]);
    try {
      const existing = writeTableInput(dataRoot, {
        platform: "hive",
        dataSource: "gfhive",
        qualifiedName: "db.invalid_target",
        objectType: "hive_table",
        ddl: tableDdl("db.invalid_target"),
        evidenceProvider: "test:table-pack",
        collectedAt: "2026-08-31T00:00:00.000Z",
      });
      writeFileSync(join(existing.directory, "ddl.sql"), "CORRUPTED\n", "utf8");
      let guidCalls = 0;
      const result = collectOneSparkIndexTask(dataRoot, "invalid-cache", {
        cacheRoot,
        metadataSnapshotPath: snapshotPath,
        scheduleDetailGate: new ScheduleDetailSerialGate({ minIntervalMs: 0 }),
        tableMcpGate: new SparkIndexTableMcpGate({ minIntervalMs: 0 }),
        runScheduleDetail: () =>
          scheduleDetail("invalid-cache", { targetTable: "db.invalid_target" }),
        runTableGuid: () => {
          guidCalls += 1;
          return [
            {
              guid: "fresh-locator",
              qualifiedName: "db.invalid_target",
              dataSource: "gfhive",
            },
          ];
        },
        runTableDdl: () => [
          {
            qualifiedName: "db.invalid_target",
            ddl: tableDdl("db.invalid_target"),
          },
        ],
        now: FIXED_NOW,
      });
      expect(guidCalls).toBe(1);
      expect(result.tablesWritten).toBe(1);
      expect(result.collectionStatus).toBe("SUCCESS");
    } finally {
      rmSync(dataRoot, { recursive: true, force: true });
      rmSync(cacheRoot, { recursive: true, force: true });
    }
  });

  it("binds exact CREATE only to its own table and rejects create conflicts", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "sparkindex-input-pack-"));
    const cacheRoot = mkdtempSync(join(tmpdir(), "sparkindex-cache-"));
    const snapshotPath = join(cacheRoot, "hive-snapshot.jsonl");
    writeMetadataSnapshot(snapshotPath, ["db.target", "db.other"]);
    try {
      const evidence: TaskEvidence = buildSparkIndexTaskEvidence("create-a", {
        targetTable: "db.target",
        querySql: "SELECT 1",
        createSql: "CREATE TABLE db.other (id BIGINT);",
      });
      const guidCalls: string[] = [];
      const resolution = resolveSparkIndexTables(dataRoot, evidence, {
        metadataSnapshotPath: snapshotPath,
        tableMcpGate: new SparkIndexTableMcpGate({ minIntervalMs: 0 }),
        runTableGuid: (database, table) => {
          guidCalls.push(`${database}.${table}`);
          return [
            {
              guid: "locator",
              qualifiedName: "db.not_target",
              dataSource: "gfhive",
            },
          ];
        },
        runTableDdl: () => {
          throw new Error("DDL_MUST_NOT_RUN_AFTER_LOCATOR_MISMATCH");
        },
        now: FIXED_NOW,
      });
      expect(resolution.resolved.map((item) => item.candidate.qualifiedName)).toEqual([
        "db.other",
      ]);
      expect(resolution.unavailable).toMatchObject([
        { candidate: { qualifiedName: "db.target" } },
      ]);
      expect(guidCalls).toEqual(["db.target"]);

      const conflict = buildSparkIndexTaskEvidence("create-b", {
        targetTable: "db.target",
        querySql: "SELECT 1",
        createSql:
          "CREATE TABLE db.target (id BIGINT); CREATE TABLE db.target (id STRING);",
      });
      const conflictResolution = resolveSparkIndexTables(
        dataRoot,
        conflict,
        {
          metadataSnapshotPath: snapshotPath,
          runTableGuid: () => {
            throw new Error("MCP_MUST_NOT_RUN_ON_CREATE_CONFLICT");
          },
          runTableDdl: () => {
            throw new Error("DDL_MUST_NOT_RUN_ON_CREATE_CONFLICT");
          },
          now: FIXED_NOW,
        },
      );
      expect(conflictResolution.resolved).toEqual([]);
      expect(conflictResolution.unavailable).toMatchObject([
        {
          candidate: { qualifiedName: "db.target" },
          reason: "SQL_CREATE_CONFLICT",
        },
      ]);
    } finally {
      rmSync(dataRoot, { recursive: true, force: true });
      rmSync(cacheRoot, { recursive: true, force: true });
    }
  });

  it("fails closed for duplicate snapshot ACTIVE rows and MCP qname/datasource mismatches", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "sparkindex-input-pack-"));
    const cacheRoot = mkdtempSync(join(tmpdir(), "sparkindex-cache-"));
    const duplicateSnapshot = join(cacheRoot, "duplicate.jsonl");
    writeMetadataSnapshot(
      duplicateSnapshot,
      ["db.temporary_target"],
      "db.temporary_target",
    );
    try {
      const duplicateCalls: string[] = [];
      const duplicate = collectOneSparkIndexTask(dataRoot, "duplicate", {
        cacheRoot,
        metadataSnapshotPath: duplicateSnapshot,
        scheduleDetailGate: new ScheduleDetailSerialGate({ minIntervalMs: 0 }),
        runScheduleDetail: () =>
          scheduleDetail("duplicate", { targetTable: "db.temporary_target" }),
        runTableGuid: () => {
          duplicateCalls.push("guid");
          throw new Error("MCP_MUST_NOT_RUN_FOR_AMBIGUOUS_SNAPSHOT");
        },
        runTableDdl: () => {
          throw new Error("DDL_MUST_NOT_RUN_FOR_AMBIGUOUS_SNAPSHOT");
        },
        now: FIXED_NOW,
      });
      expect(duplicate.collectionStatus).toBe("PARTIAL");
      expect(duplicate.tablesWritten).toBe(0);
      expect(duplicate.tablesUnavailable).toEqual(["db.temporary_target"]);
      expect(duplicateCalls).toEqual([]);
      expect(existsSync(join(duplicate.directory, "task.json"))).toBe(true);

      const mismatchSnapshot = join(cacheRoot, "mismatch.jsonl");
      writeMetadataSnapshot(mismatchSnapshot, ["db.mismatch_target"]);
      const mismatch = collectOneSparkIndexTask(dataRoot, "mismatch", {
        cacheRoot,
        metadataSnapshotPath: mismatchSnapshot,
        scheduleDetailGate: new ScheduleDetailSerialGate({ minIntervalMs: 0 }),
        tableMcpGate: new SparkIndexTableMcpGate({ minIntervalMs: 0 }),
        runScheduleDetail: () =>
          scheduleDetail("mismatch", { targetTable: "db.mismatch_target" }),
        runTableGuid: () => [
          {
            guid: "locator",
            qualifiedName: "db.mismatch_target",
            dataSource: "gfhive",
          },
        ],
        runTableDdl: () => [
          {
            qualifiedName: "db.mismatch_target@other-source",
            ddl: tableDdl("db.mismatch_target"),
          },
        ],
        now: FIXED_NOW,
      });
      expect(mismatch.collectionStatus).toBe("PARTIAL");
      expect(mismatch.tablesWritten).toBe(0);
      expect(mismatch.tableResolutionReasons).toContain(
        "db.mismatch_target:MCP_TABLE_DDL_IDENTITY_MISMATCH",
      );
    } finally {
      rmSync(dataRoot, { recursive: true, force: true });
      rmSync(cacheRoot, { recursive: true, force: true });
    }
  });

  it("trims only for conflict comparison while preserving schedule-detail SQL", () => {
    const primary = buildSparkIndexTaskEvidence("trim", {
      targetTable: "db.target",
      querySql: "  SELECT 1 FROM db.source  \n",
    }, "opencli:szdata.schedule-detail");
    const fallback = buildSparkIndexTaskEvidence("trim", {
      targetTable: "db.target",
      querySql: "SELECT 1 FROM db.source",
    }, "opencli:horae.detail");
    const merged = mergeSparkIndexEvidence(primary, fallback);
    expect(merged.sql?.query).toMatchObject({
      content: "  SELECT 1 FROM db.source  \n",
      evidenceProvider: "opencli:szdata.schedule-detail",
    });

    const materiallyDifferent = buildSparkIndexTaskEvidence("trim", {
      targetTable: "db.target",
      querySql: "SELECT 2 FROM db.source",
    }, "opencli:horae.detail");
    expect(() =>
      mergeSparkIndexEvidence(primary, materiallyDifferent),
    ).toThrow("SPARKINDEX_EVIDENCE_CONFLICT:sql.query");
  });

  it("does not manufacture a physical table from a task name or bare SQL label", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "sparkindex-input-pack-"));
    const evidence = buildSparkIndexTaskEvidence("no-guess", {
      taskName: "db.guessed_from_task_name",
      querySql: "SELECT 1 FROM source_label",
    });
    try {
      const resolution = resolveSparkIndexTables(dataRoot, evidence, {
        metadataSnapshotPath: null,
      });
      expect(resolution.candidates).toEqual([]);
    } finally {
      rmSync(dataRoot, { recursive: true, force: true });
    }
  });

  it("writes one task without any MCP provider", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "sparkindex-input-pack-"));
    const cacheRoot = mkdtempSync(join(tmpdir(), "sparkindex-cache-"));
    const calls: string[] = [];
    try {
      const gate = new HoraeSerialGate({ minIntervalMs: 0 });
      const result = collectOneSparkIndexTask(dataRoot, "100931", {
        cacheRoot,
        horaeGate: gate,
        runHoraeDetail: (taskId) => {
          calls.push(taskId);
          return {
            writeTable: "dm_index_n.target_table",
            querySql: "SELECT id FROM source_table",
          };
        },
      });

      expect(calls).toEqual(["100931"]);
      expect(result.cacheStatus).toBe("MISS_REFRESHED");
      expect(result.taskCategory).toBe("sparkIndex");
      expect(result.sqlSlots).toEqual(["query"]);
      expect(result.evidenceProvider).toBe("opencli:horae.detail");
      expect(result.directory).toContain("tasks\\sparkIndex\\100931");
      expect(readHoraeTaskTypeCache("100931", cacheRoot)).toMatchObject({
        status: "HIT",
        detail: {
          writeTable: "dm_index_n.target_table",
          querySql: "SELECT id FROM source_table",
        },
      });
    } finally {
      rmSync(dataRoot, { recursive: true, force: true });
      rmSync(cacheRoot, { recursive: true, force: true });
    }
  });

  it("uses a valid task-type cache without calling Horae detail", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "sparkindex-input-pack-"));
    const cacheRoot = mkdtempSync(join(tmpdir(), "sparkindex-cache-"));
    try {
      writeHoraeTaskTypeCache(
        "100931",
        "2026-08-31T00:00:00.000Z",
        {
          taskType: "sparkIndex",
          writeTable: "dm_index_n.cached_target",
          querySql: "SELECT id FROM cached_source",
        },
        cacheRoot,
      );

      const result = collectOneSparkIndexTask(dataRoot, "100931", {
        cacheRoot,
        runHoraeDetail: () => {
          throw new Error("HORAE_DETAIL_MUST_NOT_RUN_ON_CACHE_HIT");
        },
      });

      expect(result.cacheStatus).toBe("HIT");
      expect(result.sqlSlots).toEqual(["query"]);
    } finally {
      rmSync(dataRoot, { recursive: true, force: true });
      rmSync(cacheRoot, { recursive: true, force: true });
    }
  });

  it("archives a frozen direct collection instead of writing the main pack", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "sparkindex-input-pack-"));
    const cacheRoot = mkdtempSync(join(tmpdir(), "sparkindex-cache-"));
    const taskId = "67485";
    try {
      writeTaskInput(dataRoot, {
        taskId,
        taskCategory: "sparkIndex",
        scheduleStatus: "Y",
        sql: { query: "SELECT 1" },
        evidenceProvider: "test",
      });

      const result = collectOneSparkIndexTask(dataRoot, taskId, {
        cacheRoot,
        runScheduleDetail: () => ({
          status: "F",
          querySql: "SELECT 1",
        }),
      });

      expect(result.collectionStatus).toBe("EXCLUDED");
      expect(result.changed).toBe(true);
      expect(existsSync(join(dataRoot, "tasks", "sparkIndex", taskId))).toBe(
        false,
      );
      expect(
        existsSync(
          join(`${dataRoot}.manual-tasks`, "tasks", "sparkIndex", taskId),
        ),
      ).toBe(true);
    } finally {
      rmSync(dataRoot, { recursive: true, force: true });
      rmSync(`${dataRoot}.manual-tasks`, { recursive: true, force: true });
      rmSync(cacheRoot, { recursive: true, force: true });
    }
  });

  it("refreshes an invalid task-type cache after a successful detail call", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "sparkindex-input-pack-"));
    const cacheRoot = mkdtempSync(join(tmpdir(), "sparkindex-cache-"));
    const taskId = "100931";
    try {
      writeHoraeTaskTypeCache(
        taskId,
        "2026-08-31T00:00:00.000Z",
        { querySql: "SELECT stale FROM source_table" },
        cacheRoot,
      );
      writeFileSync(horaeTaskTypeCachePath(taskId, cacheRoot), "{}\n", "utf8");

      const result = collectOneSparkIndexTask(dataRoot, taskId, {
        cacheRoot,
        horaeGate: new HoraeSerialGate({ minIntervalMs: 0 }),
        runHoraeDetail: () => ({
          querySql: "SELECT fresh FROM source_table",
        }),
      });

      expect(result.cacheStatus).toBe("INVALID_REFRESHED");
      expect(readHoraeTaskTypeCache(taskId, cacheRoot)).toMatchObject({
        status: "HIT",
        detail: { querySql: "SELECT fresh FROM source_table" },
      });
    } finally {
      rmSync(dataRoot, { recursive: true, force: true });
      rmSync(cacheRoot, { recursive: true, force: true });
    }
  });

  it("uses the Horae detail command only", () => {
    expect(horaeDetailCommandArguments("100931")).toEqual([
      "horae",
      "detail",
      "100931",
      "-f",
      "json",
    ]);
  });
});
