import { describe, expect, it } from "vitest";

import { createContinuationPorts } from "../../../../scripts/project-graph/field-evidence-v1/impact-query-harness.ts";
import {
  createHoraeScheduleRelationLookupFromScheduleEdges,
} from "../../../../scripts/project-graph/field-evidence-v1/schedule-preference.ts";

describe("continuation read scope from facts bundle", () => {
  it("builds read scope when facts bundle is present", () => {
    const ports = createContinuationPorts({
      scheduleRelationLookup: createHoraeScheduleRelationLookupFromScheduleEdges([]),
      writerCatalogPath: null,
      factsBundleForTask: () => ({ relationNodes: [], relationEdges: [] }),
      taskCategoryFor: () => "oracle2hive",
    });
    expect(ports.readScopeFor({
      consumerTaskId: "consumer-sync",
      readOccurrenceId: "read:consumer-sync:0",
      qualifiedName: "source_schema.example_table",
    }).kind).toBe("OK");
  });

  it("returns READ_SCOPE_UNAVAILABLE when facts bundle is missing", () => {
    const ports = createContinuationPorts({
      scheduleRelationLookup: createHoraeScheduleRelationLookupFromScheduleEdges([]),
      writerCatalogPath: null,
      factsBundleForTask: () => null,
      taskCategoryFor: () => "sparkIndex",
    });
    expect(ports.readScopeFor({
      consumerTaskId: "consumer-hive",
      readOccurrenceId: "read:consumer-hive:0",
      qualifiedName: "schema.example_table",
    })).toEqual({
      kind: "UNAVAILABLE",
      reasonCode: "READ_SCOPE_UNAVAILABLE",
    });
  });
});
