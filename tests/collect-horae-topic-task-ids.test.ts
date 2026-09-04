import { describe, expect, it } from "vitest";

import {
  collectHoraeKeywordTaskIds,
  rowsFromHoraeSearchPayload,
} from "../scripts/input/mainline/collect-horae-topic-task-ids.ts";

describe("collectHoraeKeywordTaskIds", () => {
  it("collects and deduplicates ids across pages", () => {
    const calls: number[] = [];
    const checkpoints: number[] = [];
    const result = collectHoraeKeywordTaskIds({
      pageSize: 2,
      intervalMs: 0,
      searchPage: (page, size) => {
        calls.push(page * 1000 + size);
        if (page === 1)
          return {
            total: 3,
            rows: [{ id: "10" }, { task_id: "20" }],
          };
        return {
          total: 3,
          rows: [{ id: "10" }, { taskId: "30" }],
        };
      },
      onPage: (progress) => checkpoints.push(progress.taskIds.length),
    });

    expect(calls).toEqual([1002, 2002]);
    expect(checkpoints).toEqual([2, 3]);
    expect(result.taskIds).toEqual(["10", "20", "30"]);
    expect(result.rowsSeen).toBe(4);
  });

  it("supports the common JSON envelope shapes", () => {
    expect(
      rowsFromHoraeSearchPayload({ data: [{ id: "1" }], total: "1" }),
    ).toEqual({
      rows: [{ id: "1" }],
      total: 1,
    });
  });
});
