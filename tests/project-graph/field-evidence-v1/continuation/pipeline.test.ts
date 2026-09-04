import { describe, expect, it } from "vitest";

import type { UnionContinuationIndexCandidate } from "../../../../scripts/reconcile/consumer/target-table-upstream-causal-closure/union-continuation-candidate-source.ts";
import { applyContinuationRules } from "../../../../scripts/project-graph/field-evidence-v1/continuation/pipeline.ts";
import type { ContinuationPorts } from "../../../../scripts/project-graph/field-evidence-v1/continuation/ports.ts";
import {
  createHoraeScheduleRelationLookupFromScheduleEdges,
} from "../../../../scripts/project-graph/field-evidence-v1/schedule-preference.ts";

function indexCandidate(
  overrides: Partial<UnionContinuationIndexCandidate> = {},
): UnionContinuationIndexCandidate {
  return {
    taskId: "producer-a",
    writeObservationId: "write-observation:producer-a:0",
    targetWriteNodeId: "target-write:producer-a:0",
    datasetNodeId: "dataset:example",
    qualifiedName: "warehouse.example_table",
    source: "IN_UNION_FINAL_WRITE",
    partitionMatchStatus: "UNKNOWN",
    partition: [],
    evidenceLayer: "L2",
    l1Eligible: false,
    ...overrides,
  };
}

function ports(lookup: ContinuationPorts["scheduleLookup"]): ContinuationPorts {
  return {
    scheduleLookup: lookup,
    writerCatalog: null,
    taskCategoryFor: () => "sparkIndex",
    readScopeFor: () => ({ kind: "UNAVAILABLE", reasonCode: "READ_SCOPE_UNAVAILABLE" }),
    tableIdentityFor: ({ qualifiedName }) => ({
      platform: "warehouse",
      dataSource: "default",
      qualifiedName: qualifiedName.split(".").slice(-1)[0] ?? qualifiedName,
    }),
  };
}

describe("continuation pipeline", () => {
  it("does not use Horae to drop UNKNOWN writers after DISJOINT prune", () => {
    const lookup = createHoraeScheduleRelationLookupFromScheduleEdges([
      { consumerTaskId: "consumer-root", producerTaskId: "producer-preferred" },
    ]);
    const candidates = [
      indexCandidate({ taskId: "producer-preferred", writeObservationId: "write-observation:producer-preferred:0" }),
      indexCandidate({ taskId: "producer-other-a", writeObservationId: "write-observation:producer-other-a:0" }),
      indexCandidate({ taskId: "producer-other-b", writeObservationId: "write-observation:producer-other-b:0" }),
      indexCandidate({ taskId: "producer-other-c", writeObservationId: "write-observation:producer-other-c:0" }),
      indexCandidate({ taskId: "producer-other-d", writeObservationId: "write-observation:producer-other-d:0" }),
      indexCandidate({ taskId: "producer-other-e", writeObservationId: "write-observation:producer-other-e:0" }),
      indexCandidate({ taskId: "producer-other-f", writeObservationId: "write-observation:producer-other-f:0" }),
    ];
    const result = applyContinuationRules({
      pipeline: {
        consumerTaskId: "consumer-root",
        readOccurrenceId: "read:consumer-root:0",
        column: "amount",
        candidates,
      },
      qualifiedName: "warehouse.example_table",
      ports: ports(lookup),
    });

    expect(result.candidates).toHaveLength(7);
    expect(result.candidates.every((candidate) => candidate.continuationEligible === false)).toBe(true);
    expect(result.gaps.some((gap) => gap.reasonCode === "WRITER_CATALOG_UNAVAILABLE")).toBe(true);
  });

  it("tie-breaks overlapping writers to the unique Horae parent after rematch skip", () => {
    const lookup = createHoraeScheduleRelationLookupFromScheduleEdges([
      { consumerTaskId: "consumer-root", producerTaskId: "producer-preferred" },
    ]);
    const result = applyContinuationRules({
      pipeline: {
        consumerTaskId: "consumer-root",
        readOccurrenceId: "read:consumer-root:0",
        column: "amount",
        candidates: [
          indexCandidate({
            taskId: "producer-preferred",
            partitionMatchStatus: "ASSUMED",
          }),
          indexCandidate({
            taskId: "producer-other-a",
            writeObservationId: "write-observation:producer-other-a:0",
            partitionMatchStatus: "ASSUMED",
          }),
        ],
      },
      qualifiedName: "warehouse.example_table",
      ports: ports(lookup),
    });

    expect(result.candidates.map((candidate) => candidate.index.taskId)).toEqual([
      "producer-preferred",
    ]);
    expect(result.candidates[0]?.continuationEligible).toBe(false);
  });

  it("does not schedule-prune when Horae lookup is unavailable", () => {
    const candidates = [
      indexCandidate({ taskId: "producer-preferred" }),
      indexCandidate({ taskId: "producer-other-a", writeObservationId: "write-observation:producer-other-a:0" }),
    ];
    const result = applyContinuationRules({
      pipeline: {
        consumerTaskId: "consumer-root",
        readOccurrenceId: "read:consumer-root:0",
        column: "amount",
        candidates,
      },
      qualifiedName: "warehouse.example_table",
      ports: ports(null),
    });

    expect(result.candidates).toHaveLength(2);
  });

  it("always prunes DISJOINT candidates regardless of Horae availability", () => {
    const candidates = [
      indexCandidate({ taskId: "producer-preferred", partitionMatchStatus: "DISJOINT" }),
      indexCandidate({ taskId: "producer-other-a", writeObservationId: "write-observation:producer-other-a:0" }),
    ];
    const result = applyContinuationRules({
      pipeline: {
        consumerTaskId: "consumer-root",
        readOccurrenceId: "read:consumer-root:0",
        column: "amount",
        candidates,
      },
      qualifiedName: "warehouse.example_table",
      ports: ports(null),
    });

    expect(result.candidates.map((candidate) => candidate.index.taskId)).toEqual(["producer-other-a"]);
  });

  it("does not confirm on POSSIBLE_OVERLAP after reduce", () => {
    const result = applyContinuationRules({
      pipeline: {
        consumerTaskId: "consumer-1",
        readOccurrenceId: "read:consumer-1:0",
        column: "amount",
        candidates: [indexCandidate({
          taskId: "producer-a",
          partitionMatchStatus: "ASSUMED",
          l1Eligible: true,
        })],
      },
      qualifiedName: "warehouse.example_table",
      ports: ports(null),
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.continuationEligible).toBe(false);
  });

  it("keeps unique Horae parent with UNKNOWN overlap at frontier", () => {
    const lookup = createHoraeScheduleRelationLookupFromScheduleEdges([
      { consumerTaskId: "consumer-2", producerTaskId: "producer-a" },
    ]);
    const result = applyContinuationRules({
      pipeline: {
        consumerTaskId: "consumer-2",
        readOccurrenceId: "read:consumer-2:0",
        column: "amount",
        candidates: [indexCandidate({
          taskId: "producer-a",
          partitionMatchStatus: "UNKNOWN",
          l1Eligible: true,
        })],
      },
      qualifiedName: "warehouse.example_table",
      ports: ports(lookup),
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.continuationEligible).toBe(false);
    expect(result.scheduleParentAmbiguous).toBe(false);
  });

  it("emits SCHEDULE_PARENT_AMBIGUOUS when multiple Horae parents remain", () => {
    const lookup = createHoraeScheduleRelationLookupFromScheduleEdges([
      { consumerTaskId: "consumer-1", producerTaskId: "producer-b" },
      { consumerTaskId: "consumer-1", producerTaskId: "producer-c" },
    ]);
    const result = applyContinuationRules({
      pipeline: {
        consumerTaskId: "consumer-1",
        readOccurrenceId: "read:consumer-1:0",
        column: "amount",
        candidates: [
          indexCandidate({ taskId: "producer-b", partitionMatchStatus: "CONFIRMED", l1Eligible: true }),
          indexCandidate({ taskId: "producer-c", writeObservationId: "write-observation:producer-c:0", partitionMatchStatus: "CONFIRMED", l1Eligible: true }),
          indexCandidate({ taskId: "producer-d", writeObservationId: "write-observation:producer-d:0" }),
        ],
      },
      qualifiedName: "warehouse.example_table",
      ports: ports(lookup),
    });

    expect(result.scheduleParentAmbiguous).toBe(true);
    expect(result.gaps.some((gap) => gap.reasonCode === "SCHEDULE_PARENT_AMBIGUOUS")).toBe(true);
    expect(result.candidates.every((candidate) => candidate.continuationEligible === false)).toBe(true);
  });
});
