import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { HoraeSerialGate } from "../scripts/input/mainline/collect-one-task-input-pack-sparkindex.ts";
import {
  expandHoraeRelationClosure,
  fillHoraeRelationCache,
  neighborTaskIdsFromRelationCache,
  parseTaskIdOrder,
  rowsOfHoraeRelation,
  sortTaskIds,
  taskIdsFromFile,
} from "../scripts/input/mainline/fill-horae-relation-cache.ts";
import {
  readHoraeRelationCache,
  resolveScheduleEvidenceCacheRoot,
  writeHoraeRelationCache,
} from "../scripts/reconcile/consumer/one-hop/schedule-evidence-cache.ts";

function makeTaskDirectories(
  cacheRoot: string,
  taskIds: readonly string[],
): void {
  const tasksRoot = join(resolveScheduleEvidenceCacheRoot(cacheRoot), "tasks");
  for (const taskId of taskIds) {
    mkdirSync(join(tasksRoot, taskId), { recursive: true });
  }
}

describe("fillHoraeRelationCache", () => {
  it("skips HIT, fills MISS serially, and resumes from start-task-id", async () => {
    const cacheRoot = mkdtempSync(join(tmpdir(), "horae-relation-fill-"));
    try {
      makeTaskDirectories(cacheRoot, ["100", "200", "300", "400"]);
      writeHoraeRelationCache(
        "100",
        "2026-08-31T00:00:00.000Z",
        [{ task_id: "100" }],
        cacheRoot,
        "down",
      );
      writeHoraeRelationCache(
        "200",
        "2026-08-31T00:00:00.000Z",
        [{ task_id: "200" }],
        cacheRoot,
        "down",
      );

      const starts: string[] = [];
      const summary = await fillHoraeRelationCache({
        cacheRoot,
        startTaskId: "200",
        direction: "down",
        maxErrors: 3,
        minIntervalMs: 0,
        gate: new HoraeSerialGate({ minIntervalMs: 0 }),
        runner: (taskId) => {
          starts.push(taskId);
          return [{ task_id: `child-${taskId}` }];
        },
      });

      expect(summary).toMatchObject({
        total: 3,
        skipped: 1,
        cached: 2,
        errors: 0,
        stopped: false,
        direction: "down",
        startTaskId: "200",
      });
      expect(starts).toEqual(["300", "400"]);
      expect(readHoraeRelationCache("300", cacheRoot, "down")).toMatchObject({
        status: "HIT",
      });
      expect(readHoraeRelationCache("400", cacheRoot, "down")).toMatchObject({
        status: "HIT",
      });
    } finally {
      rmSync(cacheRoot, { recursive: true, force: true });
    }
  });

  it("stops after max-errors and leaves failed tasks as MISS", async () => {
    const cacheRoot = mkdtempSync(join(tmpdir(), "horae-relation-errors-"));
    try {
      makeTaskDirectories(cacheRoot, ["1", "2", "3"]);
      const summary = await fillHoraeRelationCache({
        cacheRoot,
        direction: "down",
        maxErrors: 2,
        minIntervalMs: 0,
        gate: new HoraeSerialGate({ minIntervalMs: 0 }),
        runner: (taskId) => {
          throw new Error(`HTTP 429 for ${taskId}`);
        },
      });
      expect(summary.errors).toBe(2);
      expect(summary.stopped).toBe(true);
      expect(summary.failedTaskIds).toEqual(["1", "2"]);
      expect(readHoraeRelationCache("1", cacheRoot, "down").status).toBe(
        "MISS",
      );
      expect(readHoraeRelationCache("3", cacheRoot, "down").status).toBe(
        "MISS",
      );
    } finally {
      rmSync(cacheRoot, { recursive: true, force: true });
    }
  });

  it("skips task ids from the shared manual-task list", async () => {
    const cacheRoot = mkdtempSync(join(tmpdir(), "horae-relation-manual-"));
    try {
      makeTaskDirectories(cacheRoot, ["1", "2"]);
      writeFileSync(
        join(
          resolveScheduleEvidenceCacheRoot(cacheRoot),
          "manual-task-ids.txt",
        ),
        "1\n",
        "utf8",
      );
      writeFileSync(
        join(
          resolveScheduleEvidenceCacheRoot(cacheRoot),
          "manual-task-ids.txt.meta.json",
        ),
        JSON.stringify({ status: "COMPLETED" }),
        "utf8",
      );
      const started: string[] = [];
      const summary = await fillHoraeRelationCache({
        cacheRoot,
        direction: "up",
        maxErrors: 1,
        minIntervalMs: 0,
        gate: new HoraeSerialGate({ minIntervalMs: 0 }),
        runner: (taskId) => {
          started.push(taskId);
          return [];
        },
      });

      expect(summary.total).toBe(1);
      expect(started).toEqual(["2"]);
    } finally {
      rmSync(cacheRoot, { recursive: true, force: true });
    }
  });

  it("supports descending task-id order", async () => {
    const cacheRoot = mkdtempSync(join(tmpdir(), "horae-relation-order-"));
    try {
      const starts: string[] = [];
      const summary = await fillHoraeRelationCache({
        cacheRoot,
        taskIds: ["10", "2", "30"],
        order: "desc",
        startTaskId: "20",
        direction: "down",
        maxErrors: 1,
        minIntervalMs: 0,
        gate: new HoraeSerialGate({ minIntervalMs: 0 }),
        runner: (taskId) => {
          starts.push(taskId);
          return [];
        },
      });

      expect(summary).toMatchObject({
        total: 2,
        cached: 2,
        errors: 0,
        order: "desc",
      });
      expect(starts).toEqual(["10", "2"]);
      expect(sortTaskIds(["10", "2", "30"], "desc")).toEqual(["30", "10", "2"]);
      expect(parseTaskIdOrder("desc")).toBe("desc");
      expect(parseTaskIdOrder(undefined)).toBe("asc");
    } finally {
      rmSync(cacheRoot, { recursive: true, force: true });
    }
  });

  it("parses empty relation envelopes as empty rows", () => {
    expect(rowsOfHoraeRelation([], "1")).toEqual([]);
    expect(rowsOfHoraeRelation({ records: [] }, "1")).toEqual([]);
  });

  it("reads task ids from file and harvests missing down neighbors", () => {
    const cacheRoot = mkdtempSync(join(tmpdir(), "horae-relation-neighbors-"));
    const idsFile = join(cacheRoot, "ids.txt");
    try {
      makeTaskDirectories(cacheRoot, ["10", "20"]);
      writeHoraeRelationCache(
        "10",
        "2026-08-31T00:00:00.000Z",
        [{ task_id: "10" }, { task_id: "99" }, { task_id: "20" }],
        cacheRoot,
        "down",
      );
      writeFileSync(idsFile, "# seed\n99\n\n88\n99\n", "utf8");
      expect(taskIdsFromFile(idsFile)).toEqual(["88", "99"]);
      expect(taskIdsFromFile(idsFile, "desc")).toEqual(["99", "88"]);
      expect(neighborTaskIdsFromRelationCache(cacheRoot, "down")).toEqual([
        "99",
      ]);
      expect(
        neighborTaskIdsFromRelationCache(cacheRoot, "down", {
          onlyMissingTaskDirs: false,
        }),
      ).toEqual(["10", "20", "99"]);
    } finally {
      rmSync(cacheRoot, { recursive: true, force: true });
    }
  });

  it("fills an explicit task-id list even when directories are missing", async () => {
    const cacheRoot = mkdtempSync(join(tmpdir(), "horae-relation-explicit-"));
    try {
      const summary = await fillHoraeRelationCache({
        cacheRoot,
        taskIds: ["501", "502"],
        direction: "up",
        maxErrors: 1,
        minIntervalMs: 0,
        gate: new HoraeSerialGate({ minIntervalMs: 0 }),
        runner: (taskId) => [{ task_id: `parent-${taskId}` }],
      });
      expect(summary).toMatchObject({
        total: 2,
        skipped: 0,
        cached: 2,
        errors: 0,
        direction: "up",
      });
      expect(readHoraeRelationCache("501", cacheRoot, "up").status).toBe("HIT");
      expect(readHoraeRelationCache("502", cacheRoot, "up").status).toBe("HIT");
    } finally {
      rmSync(cacheRoot, { recursive: true, force: true });
    }
  });

  it("BFS-closes over cached up and down relations and records missing hops", () => {
    const cacheRoot = mkdtempSync(join(tmpdir(), "horae-relation-closure-"));
    try {
      makeTaskDirectories(cacheRoot, ["1", "2", "3"]);
      writeHoraeRelationCache(
        "1",
        "2026-08-31T00:00:00.000Z",
        [{ task_id: "2" }],
        cacheRoot,
        "up",
      );
      writeHoraeRelationCache(
        "1",
        "2026-08-31T00:00:00.000Z",
        [],
        cacheRoot,
        "down",
      );
      writeHoraeRelationCache(
        "2",
        "2026-08-31T00:00:00.000Z",
        [{ task_id: "3" }],
        cacheRoot,
        "up",
      );
      const result = expandHoraeRelationClosure({
        cacheRoot,
        seedTaskIds: ["1"],
      });
      expect(result.seed).toBe(1);
      expect(result.hops).toBe(2);
      expect(result.closure).toEqual(["1", "2", "3"]);
      expect(result.missingUp).toEqual(["3"]);
      expect(result.missingDown).toEqual(["2", "3"]);
    } finally {
      rmSync(cacheRoot, { recursive: true, force: true });
    }
  });
});
