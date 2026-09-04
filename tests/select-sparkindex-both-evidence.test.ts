import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  SPARKINDEX_QUALIFIED_CACHE_FILES,
  selectSparkIndexQualifiedTaskIds,
} from "../scripts/input/mainline/select-sparkindex-both-evidence.ts";

function writeFour(taskDir: string): void {
  mkdirSync(taskDir, { recursive: true });
  for (const fileName of SPARKINDEX_QUALIFIED_CACHE_FILES) {
    if (fileName === "horae-task-type.json") {
      writeFileSync(
        join(taskDir, fileName),
        JSON.stringify({
          detail: { id: "144127", taskType: "sparkIndex", name: "demo" },
        }),
        "utf8",
      );
      continue;
    }
    if (fileName === "szdata-schedule-detail.json") {
      writeFileSync(
        join(taskDir, fileName),
        JSON.stringify({
          detail: {
            taskId: "144127",
            taskType: "64",
            targetTable: "dm.demo",
          },
        }),
        "utf8",
      );
      continue;
    }
    writeFileSync(join(taskDir, fileName), "{}", "utf8");
  }
}

describe("selectSparkIndexQualifiedTaskIds", () => {
  it("requires all four 144127-style cache files and excludes manual", () => {
    const cacheTasksDir = mkdtempSync(join(tmpdir(), "sparkindex-four-"));
    writeFour(join(cacheTasksDir, "144127"));

    mkdirSync(join(cacheTasksDir, "246708"), { recursive: true });
    writeFileSync(
      join(cacheTasksDir, "246708", "horae-task-type.json"),
      JSON.stringify({ detail: { id: "246708", taskType: "sparkIndex" } }),
      "utf8",
    );

    writeFour(join(cacheTasksDir, "100486"));
    writeFileSync(
      join(cacheTasksDir, "100486", "horae-task-type.json"),
      JSON.stringify({ detail: { id: "100486", taskType: "sparkIndex" } }),
      "utf8",
    );

    const selection = selectSparkIndexQualifiedTaskIds({
      cacheTasksDir,
      manualTaskIds: new Set(["100486"]),
    });

    expect(selection.selected).toEqual(["144127"]);
    expect(selection.skip.missingSzdataScheduleDetail).toBeGreaterThanOrEqual(1);
    expect(selection.skip.manual).toBe(1);
    expect(selection.rule).toContain("four cache files");
  });
});
