import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  canonicalHash,
  sha256Text,
  type JsonValue,
} from "../scripts/input/shared/input-pack.ts";
import { repairStoredInputPacks } from "../scripts/input/repair/repair-stored-input-packs.ts";

describe("stored Input Pack SQL repair", () => {
  it("repairs a forward-compatible stored pack, backs it up, and is idempotent", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "stored-pack-repair-"));
    const taskDirectory = join(dataRoot, "tasks", "hiveTask", "103935");
    const sql =
      "CREATE TABLE x AS SELECT a -- first ,'b' AS b FROM (; SELECT c FROM db.t ) A;;\n";
    const task: Record<string, unknown> = {
      schemaVersion: "1.0.0",
      taskId: "103935",
      taskCategory: "hiveTask",
      taskName: "demo",
      sqlFiles: [
        {
          slot: "create",
          path: "sql/create.sql",
          sha256: sha256Text(sql),
          evidenceProvider: "sql-mcp",
        },
      ],
      collectedAt: "2026-08-24T00:00:00.000Z",
      codeEvidence: { status: "SUCCESS" },
      evidenceProvider: "sql-mcp",
    };
    task.contentHash = canonicalHash(
      task as JsonValue,
      ["collectedAt", "contentHash"],
    );
    mkdirSync(join(taskDirectory, "sql"), { recursive: true });
    writeFileSync(join(taskDirectory, "sql", "create.sql"), sql, "utf8");
    writeFileSync(join(taskDirectory, "task.json"), `${JSON.stringify(task, null, 2)}\n`, "utf8");

    const dryRun = repairStoredInputPacks({ dataRoot, apply: false });
    expect(dryRun.changedTaskPacks).toBe(1);
    expect(dryRun.changedSqlFiles).toBe(1);
    expect(readFileSync(join(taskDirectory, "sql", "create.sql"), "utf8")).toBe(sql);

    const backupRoot = join(dataRoot, "repair-backup");
    const applied = repairStoredInputPacks({ dataRoot, apply: true, backupRoot });
    expect(applied.changedTaskPacks).toBe(1);
    expect(readFileSync(join(backupRoot, "tasks", "hiveTask", "103935", "sql", "create.sql"), "utf8")).toBe(sql);
    const repaired = readFileSync(join(taskDirectory, "sql", "create.sql"), "utf8");
    expect(repaired).not.toBe(sql);
    expect(repaired).not.toContain("FROM (;\n");
    expect(repaired).not.toContain(";;");
    expect(JSON.parse(readFileSync(join(taskDirectory, "task.json"), "utf8")).contentHash).not.toBe(task.contentHash);

    const secondDryRun = repairStoredInputPacks({ dataRoot, apply: false });
    expect(secondDryRun.changedTaskPacks).toBe(0);
    expect(secondDryRun.changedSqlFiles).toBe(0);
  });
});
