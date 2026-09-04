import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { HoraeSerialGate } from "../scripts/input/mainline/collect-one-task-input-pack-sparkindex.ts";
import { fillHoraeRelationSqlite } from "../scripts/input/mainline/fill-horae-relation-sqlite.ts";
import { openScheduleEvidenceDatabase } from "../scripts/input/shared/sqlite-evidence-store.ts";

describe("fillHoraeRelationSqlite", () => {
  it("writes both directions serially and skips existing evidence", async () => {
    const root = mkdtempSync(join(tmpdir(), "horae-relation-sqlite-"));
    const databasePath = join(root, "schedule-evidence.sqlite");
    const database = openScheduleEvidenceDatabase(databasePath);
    const calls: string[] = [];
    const runner = (taskId: string, direction: "up" | "down") => {
      calls.push(`${direction}:${taskId}`);
      return [{ task_id: `${direction}-${taskId}` }];
    };

    try {
      const first = await fillHoraeRelationSqlite({
        database,
        taskIds: ["2", "1"],
        direction: "both",
        order: "asc",
        minIntervalMs: 0,
        gate: new HoraeSerialGate({ minIntervalMs: 0 }),
        runner,
      });
      expect(first).toMatchObject({
        totalTasks: 2,
        totalRequests: 4,
        cached: 4,
        skipped: 0,
        errors: 0,
        stopped: false,
      });
      expect(calls).toEqual(["up:1", "down:1", "up:2", "down:2"]);

      const second = await fillHoraeRelationSqlite({
        database,
        taskIds: ["1", "2"],
        direction: "both",
        minIntervalMs: 0,
        gate: new HoraeSerialGate({ minIntervalMs: 0 }),
        runner,
      });
      expect(second).toMatchObject({
        totalTasks: 2,
        totalRequests: 4,
        cached: 0,
        skipped: 4,
        errors: 0,
      });
      expect(calls).toHaveLength(4);
      expect(
        database
          .prepare(
            "SELECT COUNT(*) AS count FROM evidence WHERE evidence_type LIKE 'horae-relation-%'",
          )
          .get(),
      ).toEqual({ count: 4 });
    } finally {
      database.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
