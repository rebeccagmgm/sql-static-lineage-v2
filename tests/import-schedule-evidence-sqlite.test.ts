import { DatabaseSync } from "node:sqlite";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { importScheduleEvidenceToSqlite } from "../scripts/input/mainline/import-schedule-evidence-sqlite.ts";

describe("importScheduleEvidenceToSqlite", () => {
  it("imports task inventory and JSON/SQL evidence idempotently", () => {
    const cacheRoot = mkdtempSync(join(tmpdir(), "schedule-evidence-sqlite-"));
    const taskRoot = join(cacheRoot, "schedule-evidence", "tasks", "100");
    mkdirSync(taskRoot, { recursive: true });
    writeFileSync(
      join(taskRoot, "horae-task-type.json"),
      JSON.stringify({
        task_id: "100",
        observed_at: "2026-09-04T00:00:00.000Z",
        detail: { taskType: "hiveTask" },
        content_sha256: "a".repeat(64),
      }),
    );
    writeFileSync(join(taskRoot, "hive-task.sql"), "select 1;\n");
    writeFileSync(
      join(taskRoot, "horae-relation-up-depth-1.json"),
      JSON.stringify({ task_id: "100", direction: "up", depth: 1, rows: [] }),
    );

    const databasePath = join(
      cacheRoot,
      "schedule-evidence",
      "tasks-sqlite",
      "schedule-evidence.sqlite",
    );
    const first = importScheduleEvidenceToSqlite({ cacheRoot, databasePath });
    const second = importScheduleEvidenceToSqlite({ cacheRoot, databasePath });

    expect(first.taskDirectories).toBe(1);
    expect(first.filesSeen).toBe(3);
    expect(first.inserted).toBe(3);
    expect(second.inserted).toBe(0);
    expect(second.updated).toBe(0);
    expect(second.unchanged).toBe(3);

    const database = new DatabaseSync(databasePath);
    expect(database.prepare("SELECT COUNT(*) AS count FROM task_inventory").get()).toEqual({
      count: 1,
    });
    expect(database.prepare("SELECT COUNT(*) AS count FROM evidence").get()).toEqual({
      count: 3,
    });
    expect(
      database
        .prepare(
          "SELECT direction, depth, format, payload_text FROM evidence WHERE evidence_type = ?",
        )
        .get("horae-relation-up-depth-1"),
    ).toMatchObject({ direction: "up", depth: 1, format: "json", payload_text: null });
    expect(readFileSync(join(taskRoot, "hive-task.sql"), "utf8")).toBe("select 1;\n");
    database.close();
  });
});
