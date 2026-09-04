import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { buildPartialInventory } from "../scripts/input/mainline/inventory-input-pack-partials.ts";

function fixture(): { readonly dataRoot: string; readonly cacheRoot: string; readonly statusFile: string } {
  const dataRoot = resolve(mkdtempSync(join(tmpdir(), "partial-inventory-data-")));
  const cacheRoot = resolve(mkdtempSync(join(tmpdir(), "partial-inventory-cache-")));
  const taskId = "42";
  const taskPack = join(dataRoot, "tasks", "hiveTask", taskId);
  const cacheTask = join(cacheRoot, "schedule-evidence", "tasks", taskId);
  const logDir = join(cacheRoot, "schedule-evidence", "script-log");
  mkdirSync(join(taskPack, "sql"), { recursive: true });
  mkdirSync(cacheTask, { recursive: true });
  mkdirSync(logDir, { recursive: true });
  writeFileSync(
    join(taskPack, "task.json"),
    JSON.stringify({ sqlFiles: [{ slot: "query" }] }),
    "utf8",
  );
  writeFileSync(join(cacheTask, "horae-task-type.json"), "{}", "utf8");
  writeFileSync(join(cacheTask, "hive-task.sql"), "-- sqlStatus: UNAVAILABLE\n", "utf8");
  writeFileSync(join(cacheTask, "horae-relation-up-depth-1.json"), "{}", "utf8");
  writeFileSync(join(logDir, `${taskId}_20260827.log`), "log", "utf8");
  const statusFile = `${dataRoot}.input-pack-status.json`;
  writeFileSync(
    statusFile,
    JSON.stringify({
      schemaVersion: "1.0.0",
      dataRoot,
      tasks: {
        [taskId]: {
          taskId,
          status: "PARTIAL",
          taskCategory: "hiveTask",
          directory: taskPack,
          warnings: ["demo.table:HIVE_DDL_MISS"],
          tablesUnavailable: ["demo.table"],
          updatedAt: "2026-09-03T00:00:00.000Z",
        },
      },
    }),
    "utf8",
  );
  return { dataRoot, cacheRoot, statusFile };
}

describe("current Input Pack partial inventory", () => {
  it("uses current status, records local evidence, and excludes relation-only files", () => {
    const paths = fixture();
    const inventory = buildPartialInventory({
      ...paths,
      activeWriters: () => [],
      now: () => new Date("2026-09-03T01:02:03.000Z"),
    });
    expect(inventory).toMatchObject({
      artifactType: "INPUT_PACK_PARTIAL_INVENTORY",
      stable: true,
      statusCounts: { PARTIAL: 1 },
    });
    expect(inventory.rows[0]).toMatchObject({
      taskId: "42",
      candidateNames: ["demo.table"],
      sqlSlots: ["query"],
      cacheFiles: ["horae-task-type.json", "hive-task.sql"],
      hasScriptLog: true,
    });
    expect(inventory.rows[0]?.cacheFiles).not.toContain(
      "horae-relation-up-depth-1.json",
    );
  });

  it("refuses final inventory while a relevant cache writer is active", () => {
    const paths = fixture();
    expect(() =>
      buildPartialInventory({
        ...paths,
        activeWriters: () => ["npm run input-pack:fill-hive-task-sql-cache"],
      }),
    ).toThrow("CACHE_WRITERS_ACTIVE");
  });

  it("can emit an unstable diagnostic only when explicitly requested", () => {
    const paths = fixture();
    const inventory = buildPartialInventory({
      ...paths,
      requireStable: false,
      activeWriters: () => ["npm run input-pack:fill-hive-task-sql-cache"],
    });
    expect(inventory.stable).toBe(false);
    expect(inventory.activeWriters).toHaveLength(1);
  });
});
