import { describe, expect, it } from "vitest";

import {
  horaeRelationWorkerArguments,
  shouldRestartWorker,
} from "../scripts/input/mainline/supervise-horae-relation-sqlite.ts";

describe("superviseHoraeRelationSqlite", () => {
  it("builds one-direction worker arguments", () => {
    expect(
      horaeRelationWorkerArguments("cache", "up", "desc", 1000, 10),
    ).toEqual([
      "run",
      "input-pack:fill-horae-relation-sqlite",
      "--",
      "--cache-root",
      "cache",
      "--direction",
      "up",
      "--order",
      "desc",
      "--interval-ms",
      "1000",
      "--max-errors",
      "10",
    ]);
  });

  it("restarts only when the worker did not complete successfully", () => {
    expect(shouldRestartWorker(0, null)).toBe(false);
    expect(shouldRestartWorker(1, null)).toBe(true);
    expect(shouldRestartWorker(null, "SIGTERM")).toBe(true);
  });
});
