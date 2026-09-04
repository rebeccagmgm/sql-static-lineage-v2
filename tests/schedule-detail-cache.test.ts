import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  collectOneSparkIndexTask,
  HoraeSerialGate,
} from "../scripts/input/mainline/collect-one-task-input-pack-sparkindex.ts";
import {
  fillSzdataScheduleDetailCache,
  taskIdsFromScheduleEvidenceCache,
} from "../scripts/input/mainline/fill-szdata-schedule-detail-cache.ts";
import {
  sparkIndexTaskIdsFromHoraeTypeCache,
} from "../scripts/input/mainline/fill-sparkindex-schedule-detail-cache.ts";
import {
  normalizeSzdataScheduleDetail,
  readSzdataScheduleDetailCache,
  scheduleDetailCommandArguments,
  ScheduleDetailSerialGate,
  szdataScheduleDetailCachePath,
  writeSzdataScheduleDetailCache,
} from "../scripts/input/mainline/szdata-schedule-detail-cache.ts";
import {
  horaeTaskTypeCachePath,
  writeHoraeTaskTypeCache,
} from "../scripts/reconcile/consumer/one-hop/schedule-evidence-cache.ts";

const taskId = "66411";

function detail(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    taskId,
    targetTable: "dm_index_n.hold_tag_relation",
    insertMode: "overwrite",
    querySql: "SELECT id FROM source_table",
    ...overrides,
  };
}

function scheduleDetailRow(): Record<string, unknown> {
  return {
    task: {
      task_id: 66411,
      task_name: "hold tag relation",
      task_type: 64,
      cycle_num: 1,
      cycle_unit: "D",
    },
    taskext: [
      {
        prop_name: "target.table.name",
        prop_value: "dm_index_n.hold_tag_relation",
      },
      { prop_name: "target.table.save.mode", prop_value: "overwrite" },
      {
        prop_name: "query.sql",
        prop_value: "SELECT tag_id FROM dm_tag_source WHERE trade_date = '${YYYY-MM-DD}'",
      },
      { prop_name: "prepare.sqls", prop_value: "set hive.exec.dynamic.partition=true" },
      {
        prop_name: "truncate.sql",
        prop_value: "truncate table dm_index_n.hold_tag_relation",
      },
      {
        prop_name: "finish.sqls",
        prop_value: "analyze table dm_index_n.hold_tag_relation compute statistics",
      },
    ],
  };
}

function makeTaskDirectories(cacheRoot: string, ids: readonly string[]): void {
  for (const id of ids)
    mkdirSync(join(cacheRoot, "schedule-evidence", "tasks", id), {
      recursive: true,
    });
}

describe("SZData schedule-detail evidence cache", () => {
  it("distinguishes MISS/HIT/INVALID and validates task id, hash, and atomic output", () => {
    const cacheRoot = mkdtempSync(join(tmpdir(), "szdata-detail-cache-"));
    try {
      const path = szdataScheduleDetailCachePath(taskId, cacheRoot);
      const directScheduleRoot = join(cacheRoot, "schedule-evidence");
      expect(szdataScheduleDetailCachePath(taskId, directScheduleRoot)).toBe(
        path,
      );
      expect(horaeTaskTypeCachePath(taskId, directScheduleRoot)).toBe(
        horaeTaskTypeCachePath(taskId, cacheRoot),
      );
      expect(readSzdataScheduleDetailCache(taskId, cacheRoot)).toMatchObject({
        status: "MISS",
        path,
      });

      writeSzdataScheduleDetailCache(
        taskId,
        "2026-08-31T00:00:00.000Z",
        detail(),
        cacheRoot,
      );
      const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
      expect(raw).toMatchObject({
        schema_version: "1.0.0",
        artifact_type: "SZDATA_PORTAL_SCHEDULE_DETAIL",
        task_id: taskId,
        provenance: "opencli:szdata.schedule-detail",
      });
      expect(readSzdataScheduleDetailCache(taskId, cacheRoot)).toMatchObject({
        status: "HIT",
        detail: { targetTable: "dm_index_n.hold_tag_relation" },
      });
      expect(readSzdataScheduleDetailCache(taskId, directScheduleRoot)).toMatchObject({
        status: "HIT",
      });
      expect(taskIdsFromScheduleEvidenceCache(directScheduleRoot)).toContain(
        taskId,
      );
      expect(
        readdirSync(dirname(path)).some((name) => name.endsWith(".tmp")),
      ).toBe(false);

      writeFileSync(
        path,
        JSON.stringify({ ...raw, detail: detail({ querySql: "tampered" }) }),
        "utf8",
      );
      expect(readSzdataScheduleDetailCache(taskId, cacheRoot)).toMatchObject({
        status: "INVALID",
        reason: "CONTENT_HASH_MISMATCH",
      });

      writeFileSync(
        path,
        JSON.stringify({ ...raw, task_id: "other-task" }),
        "utf8",
      );
      expect(readSzdataScheduleDetailCache(taskId, cacheRoot)).toMatchObject({
        status: "INVALID",
        reason: "TASK_ID_MISMATCH",
      });
    } finally {
      rmSync(cacheRoot, { recursive: true, force: true });
    }
  });

  it("normalizes the 66411 Portal shape and rejects previews or sentinel SQL", () => {
    const normalized = normalizeSzdataScheduleDetail([scheduleDetailRow()], taskId);
    expect(normalized).toMatchObject({
      taskId,
      targetTable: "dm_index_n.hold_tag_relation",
      insertMode: "overwrite",
      querySql: "SELECT tag_id FROM dm_tag_source WHERE trade_date = '${YYYY-MM-DD}'",
      prepareSql: "set hive.exec.dynamic.partition=true",
      truncateSql: "truncate table dm_index_n.hold_tag_relation",
      finishSql:
        "analyze table dm_index_n.hold_tag_relation compute statistics",
    });
    expect(
      normalizeSzdataScheduleDetail(
        {
          taskId,
          taskName: "sentinel-only-fields",
          querySql: "-",
          targetTable: "-",
          insertMode: "-",
        },
        taskId,
      ),
    ).not.toHaveProperty("querySql");
    expect(() =>
      normalizeSzdataScheduleDetail(
        { taskId, querySqlPreview: "select ...<2048 chars>" },
        taskId,
      ),
    ).toThrow("SZDATA_SCHEDULE_DETAIL_SQL_TRUNCATED:query");
    expect(() =>
      normalizeSzdataScheduleDetail(
        { taskId, querySqlPreview: "select short" },
        taskId,
      ),
    ).toThrow("SZDATA_SCHEDULE_DETAIL_SQL_PREVIEW_ONLY:query");
    expect(() =>
      normalizeSzdataScheduleDetail({ taskId: "other-task" }, taskId),
    ).toThrow("SZDATA_SCHEDULE_DETAIL_TASK_ID_MISMATCH:66411");
    expect(() =>
      normalizeSzdataScheduleDetail(
        { status: "error", error: "HTTP 403 Forbidden" },
        taskId,
      ),
    ).toThrow("SZDATA_SCHEDULE_DETAIL_UPSTREAM_ERROR:66411:HTTP 403 Forbidden");
  });

  it("uses the optimized OpenCLI contract instead of a large preview", () => {
    expect(scheduleDetailCommandArguments(taskId)).toEqual([
      "szdata",
      "schedule-detail",
      "--task-id",
      taskId,
      "--full",
      "true",
      "--sql-preview",
      "0",
      "-f",
      "json",
    ]);
  });

  it("fills only MISS/INVALID entries serially with start-to-start limiting", async () => {
    const cacheRoot = mkdtempSync(join(tmpdir(), "szdata-detail-fill-"));
    const ids = ["95044", "95045", "95046"];
    makeTaskDirectories(cacheRoot, ids);
    const starts: Array<{ id: string; time: number }> = [];
    const sleeps: number[] = [];
    let now = 0;
    let active = 0;
    let peak = 0;
    try {
      writeSzdataScheduleDetailCache(
        "95044",
        "2026-08-31T00:00:00.000Z",
        detail({ taskId: "95044" }),
        cacheRoot,
      );
      const gate = new ScheduleDetailSerialGate({
        minIntervalMs: 5_000,
        now: () => now,
        sleep: (milliseconds) => {
          sleeps.push(milliseconds);
          now += milliseconds;
        },
      });
      const summary = await fillSzdataScheduleDetailCache({
        cacheRoot,
        gate,
        runner: async (id) => {
          starts.push({ id, time: now });
          active += 1;
          peak = Math.max(peak, active);
          await Promise.resolve();
          active -= 1;
          now += 100;
          return detail({ taskId: id, querySql: `SELECT '${id}'` });
        },
      });

      expect(summary).toMatchObject({
        total: 3,
        skipped: 1,
        cached: 2,
        errors: 0,
        stopped: false,
      });
      expect(starts).toEqual([
        { id: "95045", time: 0 },
        { id: "95046", time: 5_000 },
      ]);
      expect(sleeps).toEqual([4_900]);
      expect(peak).toBe(1);
      expect(readSzdataScheduleDetailCache("95045", cacheRoot).status).toBe(
        "HIT",
      );
      expect(readSzdataScheduleDetailCache("95046", cacheRoot).status).toBe(
        "HIT",
      );
    } finally {
      rmSync(cacheRoot, { recursive: true, force: true });
    }
  });

  it("selects SparkIndex tasks from validated Horae task-type evidence", () => {
    const cacheRoot = mkdtempSync(join(tmpdir(), "szdata-detail-spark-select-"));
    try {
      makeTaskDirectories(cacheRoot, ["100015", "100016", "100017"]);
      writeHoraeTaskTypeCache(
        "100015",
        "2026-08-31T00:00:00.000Z",
        { taskType: "sparkIndex" },
        cacheRoot,
      );
      writeHoraeTaskTypeCache(
        "100016",
        "2026-08-31T00:00:00.000Z",
        { taskType: "hiveTask" },
        cacheRoot,
      );
      expect(sparkIndexTaskIdsFromHoraeTypeCache(cacheRoot)).toEqual(["100015"]);
    } finally {
      rmSync(cacheRoot, { recursive: true, force: true });
    }
  });

  it("preserves 403/429-style errors and never writes an empty cache", async () => {
    const cacheRoot = mkdtempSync(join(tmpdir(), "szdata-detail-errors-"));
    try {
      const summary = await fillSzdataScheduleDetailCache({
        cacheRoot,
        taskIds: ["403", "429"],
        maxErrors: 2,
        minIntervalMs: 0,
        gate: new ScheduleDetailSerialGate({ minIntervalMs: 0 }),
        runner: (id) => {
          throw new Error(id === "403" ? "HTTP 403 Forbidden" : "HTTP 429 Too Many Requests");
        },
      });
      expect(summary.errors).toBe(2);
      expect(summary.stopped).toBe(true);
      expect(summary.errorDetails.map((item) => item.message)).toEqual([
        "HTTP 403 Forbidden",
        "HTTP 429 Too Many Requests",
      ]);
      expect(readSzdataScheduleDetailCache("403", cacheRoot).status).toBe(
        "MISS",
      );
      expect(readSzdataScheduleDetailCache("429", cacheRoot).status).toBe(
        "MISS",
      );
    } finally {
      rmSync(cacheRoot, { recursive: true, force: true });
    }
  });

  it("supports descending task-id order", async () => {
    const cacheRoot = mkdtempSync(join(tmpdir(), "szdata-detail-order-"));
    try {
      const starts: string[] = [];
      const summary = await fillSzdataScheduleDetailCache({
        cacheRoot,
        taskIds: ["10", "2", "30"],
        order: "desc",
        maxErrors: 1,
        minIntervalMs: 0,
        gate: new ScheduleDetailSerialGate({ minIntervalMs: 0 }),
        runner: (id) => {
          starts.push(id);
          return detail({ taskId: id });
        },
      });

      expect(summary).toMatchObject({
        total: 3,
        cached: 3,
        errors: 0,
        order: "desc",
      });
      expect(starts).toEqual(["30", "10", "2"]);
    } finally {
      rmSync(cacheRoot, { recursive: true, force: true });
    }
  });

  it("lets the offline SparkIndex collector use 66411 target/mode/SQL slots", () => {
    const cacheRoot = mkdtempSync(join(tmpdir(), "szdata-detail-spark-cache-"));
    const dataRoot = mkdtempSync(join(tmpdir(), "szdata-detail-spark-pack-"));
    try {
      const result = collectOneSparkIndexTask(dataRoot, taskId, {
        cacheRoot,
        metadataSnapshotPath: join(cacheRoot, "missing-snapshot.jsonl"),
        scheduleDetailGate: new ScheduleDetailSerialGate({ minIntervalMs: 0 }),
        runScheduleDetail: () => [scheduleDetailRow()],
        runTableGuid: () => {
          throw new Error("TABLE_GUID_MUST_NOT_RUN_WITHOUT_SNAPSHOT");
        },
        runTableDdl: () => {
          throw new Error("TABLE_DDL_MUST_NOT_RUN_WITHOUT_SNAPSHOT");
        },
        now: () => new Date("2026-08-31T00:00:00.000Z"),
      });
      const taskPath = join(result.directory, "task.json");
      const task = JSON.parse(readFileSync(taskPath, "utf8")) as Record<string, unknown>;

      expect(result.evidenceProvider).toBe("opencli:szdata.schedule-detail");
      expect(task.target).toBe("dm_index_n.hold_tag_relation");
      expect(task.writeMode).toBe("overwrite");
      expect(task.sqlFiles).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ slot: "query" }),
          expect.objectContaining({ slot: "prepare" }),
          expect.objectContaining({ slot: "truncate" }),
          expect.objectContaining({ slot: "finish" }),
        ]),
      );
      expect(readFileSync(join(result.directory, "sql", "query.sql"), "utf8")).toContain(
        "SELECT tag_id",
      );
      expect(readSzdataScheduleDetailCache(taskId, cacheRoot)).toMatchObject({
        status: "HIT",
        detail: { targetTable: "dm_index_n.hold_tag_relation" },
      });
      expect(existsSync(horaeTaskTypeCachePath(taskId, cacheRoot))).toBe(false);
    } finally {
      rmSync(dataRoot, { recursive: true, force: true });
      rmSync(cacheRoot, { recursive: true, force: true });
    }
  });

  it("fails closed when the independent Horae source conflicts", () => {
    const cacheRoot = mkdtempSync(join(tmpdir(), "szdata-detail-conflict-"));
    const dataRoot = mkdtempSync(join(tmpdir(), "szdata-detail-conflict-pack-"));
    try {
      writeSzdataScheduleDetailCache(
        taskId,
        "2026-08-31T00:00:00.000Z",
        detail(),
        cacheRoot,
      );
      writeHoraeTaskTypeCache(
        taskId,
        "2026-08-31T00:00:00.000Z",
        {
          writeTable: "dm_index_n.different_target",
          querySql: "SELECT id FROM source_table",
        },
        cacheRoot,
      );

      expect(() =>
        collectOneSparkIndexTask(dataRoot, taskId, {
          cacheRoot,
          runScheduleDetail: () => {
            throw new Error("SCHEDULE_DETAIL_MUST_NOT_RUN_ON_HIT");
          },
        }),
      ).toThrow("SPARKINDEX_EVIDENCE_CONFLICT:target");
    } finally {
      rmSync(dataRoot, { recursive: true, force: true });
      rmSync(cacheRoot, { recursive: true, force: true });
    }
  });
});
