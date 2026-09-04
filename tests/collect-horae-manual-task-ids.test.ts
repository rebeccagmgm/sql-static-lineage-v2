import { describe, expect, it } from "vitest";

import { collectHoraeManualTaskIds } from "../scripts/input/mainline/collect-horae-manual-task-ids.ts";

describe("collectHoraeManualTaskIds", () => {
  it("paginates serially, filters manual cycles, and deduplicates ids", () => {
    const calls: number[] = [];
    const checkpoints: number[] = [];
    const result = collectHoraeManualTaskIds({
      pageSize: 2,
      intervalMs: 0,
      onPage: (progress) => checkpoints.push(progress.manualTaskIds.length),
      searchPage: (page, size) => {
        calls.push(page * 1000 + size);
        if (page === 1)
          return {
            total: 3,
            rows: [
              { id: "10", cycle: "手工" },
              { id: "20", cycle: "每日" },
            ],
          };
        return {
          total: 3,
          rows: [
            { id: "10", cycle: "manual" },
            { task_id: "30", cycle: "手动" },
          ],
        };
      },
    });

    expect(calls).toEqual([1002, 2002]);
    expect(checkpoints).toEqual([1, 2]);
    expect(result.rowsSeen).toBe(4);
    expect(result.reportedTotal).toBe(3);
    expect(result.manualTaskIds).toEqual(["10", "30"]);
  });

  it("stops when a short page is returned", () => {
    let calls = 0;
    const result = collectHoraeManualTaskIds({
      pageSize: 500,
      intervalMs: 0,
      searchPage: () => {
        calls += 1;
        return { rows: [{ id: "1", cycle: "手工" }] };
      },
    });

    expect(calls).toBe(1);
    expect(result.manualTaskIds).toEqual(["1"]);
  });

  it("continues from an existing page checkpoint", () => {
    const requestedPages: number[] = [];
    const result = collectHoraeManualTaskIds({
      initialPage: 52,
      initialRowsSeen: 26000,
      initialTaskIds: ["10"],
      maxPages: 53,
      intervalMs: 0,
      searchPage: (page) => {
        requestedPages.push(page);
        return { rows: [{ id: "30", cycle: "手工" }] };
      },
    });

    expect(requestedPages).toEqual([53]);
    expect(result.pages).toBe(53);
    expect(result.rowsSeen).toBe(26001);
    expect(result.manualTaskIds).toEqual(["10", "30"]);
  });
});
