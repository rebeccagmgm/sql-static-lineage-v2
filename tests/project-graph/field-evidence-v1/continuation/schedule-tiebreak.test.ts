import { describe, expect, it } from "vitest";

import type { UnionContinuationIndexCandidate } from "../../../../scripts/reconcile/consumer/target-table-upstream-causal-closure/union-continuation-candidate-source.ts";
import { applyScheduleTiebreak } from "../../../../scripts/project-graph/field-evidence-v1/continuation/rules/schedule-tiebreak.ts";
import { continuationCandidateFromIndex } from "../../../../scripts/project-graph/field-evidence-v1/continuation/types.ts";
import { DEFAULT_CONTINUATION_POLICY } from "../../../../scripts/project-graph/field-evidence-v1/continuation/policy.ts";
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
      qualifiedName,
    }),
  };
}

describe("schedule-tiebreak rule", () => {
  it("keeps UNKNOWN same-table writers even when a unique Horae parent exists", () => {
    const lookup = createHoraeScheduleRelationLookupFromScheduleEdges([
      { consumerTaskId: "consumer-root", producerTaskId: "producer-preferred" },
    ]);
    const candidates = [
      indexCandidate({ taskId: "producer-preferred" }),
      indexCandidate({
        taskId: "producer-other",
        writeObservationId: "write-observation:producer-other:0",
      }),
    ].map(continuationCandidateFromIndex);

    const result = applyScheduleTiebreak({
      consumerTaskId: "consumer-root",
      candidates,
      ports: ports(lookup),
      policy: DEFAULT_CONTINUATION_POLICY,
    });

    expect(result.map((candidate) => candidate.index.taskId).sort()).toEqual([
      "producer-other",
      "producer-preferred",
    ]);
  });

  it("keeps only the unique Horae parent among overlapping same-table writers", () => {
    const lookup = createHoraeScheduleRelationLookupFromScheduleEdges([
      { consumerTaskId: "consumer-root", producerTaskId: "producer-preferred" },
    ]);
    const candidates = [
      indexCandidate({
        taskId: "producer-preferred",
        partitionMatchStatus: "ASSUMED",
      }),
      indexCandidate({
        taskId: "producer-other",
        writeObservationId: "write-observation:producer-other:0",
        partitionMatchStatus: "CONFIRMED",
      }),
    ].map(continuationCandidateFromIndex);

    const result = applyScheduleTiebreak({
      consumerTaskId: "consumer-root",
      candidates,
      ports: ports(lookup),
      policy: DEFAULT_CONTINUATION_POLICY,
    });

    expect(result.map((candidate) => candidate.index.taskId)).toEqual([
      "producer-preferred",
    ]);
    expect(result[0]?.continuationEligible).toBe(false);
  });

  it("keeps UNKNOWN writers when dropping overlapping non-parents", () => {
    const lookup = createHoraeScheduleRelationLookupFromScheduleEdges([
      { consumerTaskId: "consumer-root", producerTaskId: "producer-preferred" },
    ]);
    const candidates = [
      indexCandidate({
        taskId: "producer-preferred",
        partitionMatchStatus: "ASSUMED",
      }),
      indexCandidate({
        taskId: "producer-other",
        writeObservationId: "write-observation:producer-other:0",
        partitionMatchStatus: "ASSUMED",
      }),
      indexCandidate({
        taskId: "producer-unknown",
        writeObservationId: "write-observation:producer-unknown:0",
        partitionMatchStatus: "UNKNOWN",
      }),
    ].map(continuationCandidateFromIndex);

    const result = applyScheduleTiebreak({
      consumerTaskId: "consumer-root",
      candidates,
      ports: ports(lookup),
      policy: DEFAULT_CONTINUATION_POLICY,
    });

    expect(result.map((candidate) => candidate.index.taskId).sort()).toEqual([
      "producer-preferred",
      "producer-unknown",
    ]);
  });

  it("does not drop when Horae lookup is unavailable", () => {
    const candidates = [
      indexCandidate({
        taskId: "producer-preferred",
        partitionMatchStatus: "ASSUMED",
      }),
      indexCandidate({
        taskId: "producer-other",
        writeObservationId: "write-observation:producer-other:0",
        partitionMatchStatus: "ASSUMED",
      }),
    ].map(continuationCandidateFromIndex);

    const result = applyScheduleTiebreak({
      consumerTaskId: "consumer-root",
      candidates,
      ports: ports(null),
      policy: DEFAULT_CONTINUATION_POLICY,
    });

    expect(result).toHaveLength(2);
  });

  it("keeps all overlapping writers when Horae parents are 0 or many", () => {
    const lookup = createHoraeScheduleRelationLookupFromScheduleEdges([
      { consumerTaskId: "consumer-root", producerTaskId: "producer-a" },
      { consumerTaskId: "consumer-root", producerTaskId: "producer-b" },
    ]);
    const candidates = [
      indexCandidate({
        taskId: "producer-a",
        partitionMatchStatus: "ASSUMED",
      }),
      indexCandidate({
        taskId: "producer-b",
        writeObservationId: "write-observation:producer-b:0",
        partitionMatchStatus: "ASSUMED",
      }),
    ].map(continuationCandidateFromIndex);

    const result = applyScheduleTiebreak({
      consumerTaskId: "consumer-root",
      candidates,
      ports: ports(lookup),
      policy: DEFAULT_CONTINUATION_POLICY,
    });

    expect(result).toHaveLength(2);
  });
});
