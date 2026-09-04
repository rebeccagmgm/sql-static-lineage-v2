import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import {
  discoverUpstreamTaskIds,
  missingUpstreamTaskIds,
} from "../scripts/input/mainline/fill-upstream-task-type-evidence-loop.ts";
import {
  writeHoraeRelationCache,
  writeHoraeTaskTypeCache,
} from "../scripts/reconcile/consumer/one-hop/schedule-evidence-cache.ts";

describe("upstream task type evidence loop discovery", () => {
  it("collects unique upstream ids from cached up relations", () => {
    const cacheRoot = mkdtempSync(join(tmpdir(), "upstream-type-loop-"));
    try {
      mkdirSync(join(cacheRoot, "schedule-evidence", "tasks", "source"), {
        recursive: true,
      });
      writeHoraeRelationCache(
        "source",
        "2026-09-03T00:00:00.000Z",
        [
          { task_id: "parent-b" },
          { task_id: "parent-a" },
          { task_id: "parent-b" },
        ],
        cacheRoot,
        "up",
      );
      writeHoraeTaskTypeCache(
        "parent-a",
        "2026-09-03T00:00:00.000Z",
        { taskType: "hiveTask" },
        cacheRoot,
      );

      const discovery = discoverUpstreamTaskIds(cacheRoot);
      expect(discovery.relationCacheFiles).toBe(1);
      expect(discovery.relationCacheHits).toBe(1);
      expect(discovery.upstreamTaskIds).toEqual(["parent-a", "parent-b"]);
      expect(
        missingUpstreamTaskIds(
          cacheRoot,
          discovery.upstreamTaskIds,
          new Set(["parent-a"]),
        ),
      ).toEqual(["parent-b"]);
    } finally {
      rmSync(cacheRoot, { recursive: true, force: true });
    }
  });
});
