import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { expandHoraeRelationClosureFromSqlite } from "../scripts/input/mainline/expand-horae-relation-closure.ts";
import { openScheduleEvidenceDatabase, upsertSqliteJsonEvidence } from "../scripts/input/shared/sqlite-evidence-store.ts";

describe("expandHoraeRelationClosureFromSqlite", () => {
  it("BFS-closes over sqlite horae-relation rows", () => {
    const root = mkdtempSync(join(tmpdir(), "relation-closure-sqlite-"));
    const databasePath = join(root, "schedule-evidence.sqlite");
    const database = openScheduleEvidenceDatabase(databasePath);
    try {
      upsertSqliteJsonEvidence(database, {
        taskId: "1",
        evidenceType: "horae-relation-up-depth-1",
        direction: "up",
        depth: 1,
        observedAt: "2026-09-04T00:00:00.000Z",
        contentSha256: "a".repeat(64),
        payloadJson: JSON.stringify({ rows: [{ task_id: "2" }] }),
        sourcePath: "1/up.json",
      });
      upsertSqliteJsonEvidence(database, {
        taskId: "1",
        evidenceType: "horae-relation-down-depth-1",
        direction: "down",
        depth: 1,
        observedAt: "2026-09-04T00:00:00.000Z",
        contentSha256: "b".repeat(64),
        payloadJson: JSON.stringify({ rows: [] }),
        sourcePath: "1/down.json",
      });
      upsertSqliteJsonEvidence(database, {
        taskId: "2",
        evidenceType: "horae-relation-up-depth-1",
        direction: "up",
        depth: 1,
        observedAt: "2026-09-04T00:00:00.000Z",
        contentSha256: "c".repeat(64),
        payloadJson: JSON.stringify({ rows: [{ task_id: "3" }] }),
        sourcePath: "2/up.json",
      });
      database.close();

      const result = expandHoraeRelationClosureFromSqlite({
        databasePath,
        seedTaskIds: ["1"],
      });
      expect(result.closure).toEqual(["1", "2", "3"]);
      expect(result.missingUp).toEqual(["3"]);
      expect(result.missingDown).toEqual(["2", "3"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
