import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { prefetchHoraeRelations } from "../scripts/pipeline/lineage-all.ts";
import {
  horaeTaskTypeCachePath,
  readHoraeTaskTypeCache,
} from "../scripts/reconcile/consumer/one-hop/schedule-evidence-cache.ts";

describe("Horae task detail cache", () => {
  it("caches complete detail rows beside relation evidence and deduplicates IDs", async () => {
    const cacheRoot = mkdtempSync(join(tmpdir(), "horae-detail-cache-"));
    const calls: string[][] = [];
    try {
      const run = async (args: readonly string[]) => {
        calls.push([...args]);
        if (args[1] === "relation")
          return [{ task_id: "upstream", task_name: "upstream-task" }];
        return [
          {
            id: args[2],
            taskType: "sparkIndex",
            querySql: "SELECT id FROM source_table",
            syncInfo: { targetTable: "dm.target_table", loadMode: "overwrite" },
          },
        ];
      };

      await prefetchHoraeRelations(["owner"], {
        cacheRoot,
        cacheTaskDetails: true,
        horaeMinIntervalMs: 0,
        run,
      });

      expect(calls).toEqual([
        [
          "horae",
          "relation",
          "owner",
          "--direction",
          "up",
          "--depth",
          "1",
          "-f",
          "json",
        ],
        ["horae", "detail", "owner", "-f", "json"],
        ["horae", "detail", "upstream", "-f", "json"],
      ]);
      expect(readHoraeTaskTypeCache("owner", cacheRoot)).toMatchObject({
        status: "HIT",
        detail: {
          taskType: "sparkIndex",
          querySql: "SELECT id FROM source_table",
        },
      });
      expect(readHoraeTaskTypeCache("upstream", cacheRoot).status).toBe("HIT");
      expect(
        readFileSync(horaeTaskTypeCachePath("owner", cacheRoot), "utf8"),
      ).toContain('"syncInfo"');

      await prefetchHoraeRelations(["owner"], {
        cacheRoot,
        cacheTaskDetails: true,
        horaeMinIntervalMs: 0,
        run,
      });
      expect(calls).toHaveLength(3);
    } finally {
      rmSync(cacheRoot, { recursive: true, force: true });
    }
  });

  it("serializes relation and detail calls even with multiple workers", async () => {
    let active = 0;
    let peak = 0;
    const cacheRoot = mkdtempSync(join(tmpdir(), "horae-detail-serial-"));
    try {
      await prefetchHoraeRelations(["a", "b", "c"], {
        cacheRoot,
        cacheTaskDetails: true,
        concurrency: 3,
        horaeMinIntervalMs: 0,
        run: async (args) => {
          active += 1;
          peak = Math.max(peak, active);
          await new Promise((resolve) => setTimeout(resolve, 2));
          active -= 1;
          if (args[1] === "relation") return [{ task_id: args[2] }];
          return [{ id: args[2], taskType: "64" }];
        },
      });
      expect(peak).toBe(1);
    } finally {
      rmSync(cacheRoot, { recursive: true, force: true });
    }
  });
});
