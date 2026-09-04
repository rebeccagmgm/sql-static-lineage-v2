import { describe, expect, it } from "vitest";

import { manifestBase } from "../scripts/input/mainline/heal-rdbms-core-duplicates-from-snapshot.ts";

describe("input pack partial repair manifest", () => {
  it("always carries the current repair evidence discriminators", () => {
    expect(
      manifestBase("task-1", "dm.sample", "2026-09-05T00:00:00.000Z"),
    ).toEqual({
      schemaVersion: "1.0.0",
      artifactType: "INPUT_PACK_PARTIAL_REPAIR_EVIDENCE",
      taskId: "task-1",
      evidenceKind: "TABLE",
      qualifiedName: "dm.sample",
      route: "LOCAL",
      observedAt: "2026-09-05T00:00:00.000Z",
    });
  });
});
