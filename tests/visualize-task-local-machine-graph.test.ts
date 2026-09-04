import { describe, expect, it } from "vitest";

import {
  buildGoldChainDemoProjections,
  buildMachineGraphModel,
} from "../scripts/visualize/task-local-machine-graph.ts";

describe("task-local-machine-graph", () => {
  it("builds the gold-chain cross-task pairs for 105387 → 119044 → 176827", () => {
    const projections = buildGoldChainDemoProjections();
    const model = buildMachineGraphModel(projections);
    expect(projections.map((projection) => projection.taskId)).toEqual(["105387", "119044", "176827"]);
    const pairs = model.edges.filter((edge) => edge.kind === "CROSS_TASK_PAIR");
    expect(pairs.length).toBeGreaterThanOrEqual(2);
    expect(model.nodes.some((node) => node.kind === "TASK" && node.label.startsWith("105387"))).toBe(true);
    expect(model.nodes.some((node) => node.kind === "TASK" && node.label.startsWith("176827"))).toBe(true);
  }, 90_000);
});
