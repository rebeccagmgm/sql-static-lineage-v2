import { DatabaseSync } from "node:sqlite";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { listMissingEvidenceFromSqlite } from "../scripts/input/mainline/list-missing-evidence-sqlite.ts";

describe("listMissingEvidenceFromSqlite", () => {
  it("writes task ids missing the requested evidence", () => {
    const root = mkdtempSync(join(tmpdir(), "missing-evidence-sqlite-"));
    const evidenceRoot = join(root, "schedule-evidence");
    const dbPath = join(evidenceRoot, "tasks-sqlite", "schedule-evidence.sqlite");
    mkdirSync(join(evidenceRoot, "tasks-sqlite"), { recursive: true });
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE task_inventory (task_id TEXT PRIMARY KEY);
      CREATE TABLE evidence (
        task_id TEXT NOT NULL,
        evidence_type TEXT NOT NULL,
        direction TEXT NOT NULL,
        depth INTEGER NOT NULL
      );
      INSERT INTO task_inventory VALUES ('10'), ('20'), ('30');
      INSERT INTO evidence VALUES ('10', 'horae-task-type', '', 0);
    `);
    db.close();

    const output = join(root, "missing.txt");
    const result = listMissingEvidenceFromSqlite({
      cacheRoot: root,
      databasePath: dbPath,
      outputPath: output,
    });

    expect(result.missing).toBe(2);
    expect(readFileSync(output, "utf8")).toBe("20\n30\n");
  });
});
