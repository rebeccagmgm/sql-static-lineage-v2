import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import {
  collectHoraeTaskCatalog,
  rowsFromHoraeTaskCatalogPayload,
} from "../scripts/input/mainline/collect-horae-task-catalog.ts";
import { exportHoraeNonManualTaskIds } from "../scripts/input/mainline/export-horae-non-manual-task-ids.ts";

describe("collectHoraeTaskCatalog", () => {
  it("writes paged rows to SQLite, preserves raw JSON, and classifies manual ids", () => {
    const root = mkdtempSync(join(tmpdir(), "horae-task-catalog-"));
    const databasePath = join(root, "catalog.sqlite");
    const result = collectHoraeTaskCatalog({
      databasePath,
      pageSize: 2,
      intervalMs: 0,
      manualTaskIds: new Set(["20"]),
      searchPage: (page) =>
        page === 1
          ? {
              total: 3,
              rows: [
                { id: "10", name: "daily", cycle: "每日" },
                { id: "20", name: "manual", cycle: "每日" },
              ],
            }
          : { total: 3, rows: [{ id: "30", cycle: "手工" }] },
    });

    expect(result.pages).toBe(2);
    expect(result.taskCount).toBe(3);
    const database = new DatabaseSync(databasePath, { readOnly: true });
    expect(
      database
        .prepare(
          "SELECT task_id, is_manual, raw_json FROM horae_task_catalog ORDER BY task_id",
        )
        .all(),
    ).toEqual([
      {
        task_id: "10",
        is_manual: 0,
        raw_json: '{"id":"10","name":"daily","cycle":"每日"}',
      },
      {
        task_id: "20",
        is_manual: 1,
        raw_json: '{"id":"20","name":"manual","cycle":"每日"}',
      },
      { task_id: "30", is_manual: 1, raw_json: '{"id":"30","cycle":"手工"}' },
    ]);
    database.close();
  });

  it("supports common response envelopes", () => {
    expect(
      rowsFromHoraeTaskCatalogPayload({ data: [{ id: "1" }], total: "1" }),
    ).toEqual({
      rows: [{ id: "1" }],
      total: 1,
    });
  });

  it("exports non-manual catalog ids into bounded chunks", () => {
    const root = mkdtempSync(join(tmpdir(), "horae-task-catalog-export-"));
    const databasePath = join(root, "catalog.sqlite");
    const database = new DatabaseSync(databasePath);
    database.exec(`
      CREATE TABLE horae_task_catalog (
        task_id TEXT PRIMARY KEY,
        is_manual INTEGER NOT NULL
      );
    `);
    database
      .prepare(
        "INSERT INTO horae_task_catalog(task_id, is_manual) VALUES (?, ?)",
      )
      .run("10", 0);
    database
      .prepare(
        "INSERT INTO horae_task_catalog(task_id, is_manual) VALUES (?, ?)",
      )
      .run("20", 1);
    database
      .prepare(
        "INSERT INTO horae_task_catalog(task_id, is_manual) VALUES (?, ?)",
      )
      .run("30", 0);
    database.close();

    const outputDir = join(root, "chunks");
    const result = exportHoraeNonManualTaskIds({
      databasePath,
      outputDir,
      chunkSize: 1,
    });
    expect(result.taskCount).toBe(2);
    expect(result.chunkCount).toBe(2);
    expect(readFileSync(join(outputDir, "part-00001.txt"), "utf8")).toBe(
      "10\n",
    );
    expect(readFileSync(join(outputDir, "part-00002.txt"), "utf8")).toBe(
      "30\n",
    );
  });
});
