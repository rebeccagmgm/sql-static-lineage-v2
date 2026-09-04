import { describe, expect, it } from "vitest";

import type { FieldImpactFrontierCandidate } from "../../../scripts/project-graph/field-evidence-v1/impact-result-contract.ts";
import { impactQuery, type ImpactQueryInput } from "../../../scripts/project-graph/field-evidence-v1/impact-query.ts";
import {
  createHoraeScheduleRelationLookupFromScheduleEdges,
  enrichFrontierCandidates,
} from "../../../scripts/project-graph/field-evidence-v1/schedule-preference.ts";

function frontierCandidate(
  overrides: Partial<FieldImpactFrontierCandidate> = {},
): FieldImpactFrontierCandidate {
  return {
    taskId: "producer-a",
    writeObservationId: "write-observation:producer-a:0",
    partitionMatchStatus: "CONFIRMED",
    l1Eligible: false,
    schedulePreferred: false,
    scheduleRelation: "HORAE_UNAVAILABLE",
    ...overrides,
  };
}

describe("schedule-preference", () => {
  const lookup = createHoraeScheduleRelationLookupFromScheduleEdges([
    { consumerTaskId: "consumer-1", producerTaskId: "producer-b" },
    { consumerTaskId: "consumer-1", producerTaskId: "producer-c" },
    { consumerTaskId: "consumer-1", producerTaskId: "producer-a" },
    { consumerTaskId: "consumer-2", producerTaskId: "producer-a" },
  ]);

  it("marks a unique Horae parent as schedulePreferred and sorts it first", () => {
    const candidates = [
      frontierCandidate({ taskId: "producer-a", l1Eligible: false }),
      frontierCandidate({ taskId: "producer-b", l1Eligible: true }),
      frontierCandidate({ taskId: "producer-c", l1Eligible: false }),
    ];
    const result = enrichFrontierCandidates({
      consumerTaskId: "consumer-2",
      readOccurrenceId: "read:consumer-2:0",
      column: "amount",
      candidates,
      lookup,
    });

    expect(result.gaps).toEqual([]);
    expect(result.candidates.map((candidate) => candidate.taskId)).toEqual([
      "producer-a",
      "producer-b",
      "producer-c",
    ]);
    expect(result.candidates[0]).toMatchObject({
      taskId: "producer-a",
      schedulePreferred: true,
      scheduleRelation: "DIRECT_PARENT",
      l1Eligible: false,
    });
    expect(result.candidates[1]).toMatchObject({
      taskId: "producer-b",
      schedulePreferred: false,
      scheduleRelation: "NOT_IN_HORAE_UPSTREAM",
      l1Eligible: true,
    });
  });

  it("emits SCHEDULE_PARENT_AMBIGUOUS when multiple candidates are Horae parents", () => {
    const candidates = [
      frontierCandidate({ taskId: "producer-b" }),
      frontierCandidate({ taskId: "producer-c" }),
      frontierCandidate({ taskId: "producer-d" }),
    ];
    const result = enrichFrontierCandidates({
      consumerTaskId: "consumer-1",
      readOccurrenceId: "read:consumer-1:0",
      column: "amount",
      candidates,
      lookup,
    });

    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0]?.reasonCode).toBe("SCHEDULE_PARENT_AMBIGUOUS");
    expect(result.candidates.every((candidate) => candidate.schedulePreferred === false)).toBe(true);
    expect(result.candidates.filter((candidate) =>
      candidate.scheduleRelation === "DIRECT_PARENT",
    )).toHaveLength(2);
  });

  it("returns HORAE_UNAVAILABLE when lookup is missing", () => {
    const candidates = [
      frontierCandidate({ taskId: "producer-a" }),
      frontierCandidate({ taskId: "producer-b" }),
    ];
    const result = enrichFrontierCandidates({
      consumerTaskId: "consumer-1",
      readOccurrenceId: "read:consumer-1:0",
      column: "amount",
      candidates,
      lookup: null,
    });

    expect(result.gaps).toEqual([]);
    expect(result.candidates.every((candidate) =>
      candidate.scheduleRelation === "HORAE_UNAVAILABLE"
      && candidate.schedulePreferred === false,
    )).toBe(true);
    expect(result.candidates.map((candidate) => candidate.taskId)).toEqual([
      "producer-a",
      "producer-b",
    ]);
  });

  it("preserves l1Eligible on enriched frontier candidates", () => {
    const candidates = [
      frontierCandidate({ taskId: "producer-a", l1Eligible: true }),
      frontierCandidate({ taskId: "producer-b", l1Eligible: false }),
      frontierCandidate({ taskId: "producer-c", l1Eligible: false }),
    ];
    const result = enrichFrontierCandidates({
      consumerTaskId: "consumer-2",
      readOccurrenceId: "read:consumer-2:0",
      column: "amount",
      candidates,
      lookup,
    });

    for (const candidate of result.candidates) {
      const original = candidates.find((entry) => entry.taskId === candidate.taskId);
      expect(candidate.l1Eligible).toBe(original!.l1Eligible);
    }
  });

  it("does not change CONFIRMED recursion when schedule lookup is present", () => {
    const projection = {
      schemaVersion: "1.3.0",
      artifactType: "TASK_LOCAL_PROJECTION",
      generatedAt: "2026-09-04T00:00:00.000Z",
      taskId: "consumer-1",
      coverageStatus: "PROJECTED",
      failureReasonCode: null,
      contentHash: "projection-hash",
      nodes: [
        { nodeId: "task:consumer-1", nodeType: "TASK", properties: {} },
        {
          nodeId: "physical-field:amount",
          nodeType: "PHYSICAL_FIELD",
          properties: { qualifiedName: "warehouse.example_table", column: "amount" },
        },
        {
          nodeId: "target-write:consumer-1:0",
          nodeType: "TARGET_WRITE",
          properties: { writeObservationId: "write-observation:consumer-1:0" },
        },
      ],
      edges: [{
        edgeId: "field-edge:amount",
        edgeType: "FIELD_DIRECT",
        fromNodeId: "physical-field:amount",
        toNodeId: "target-write:consumer-1:0",
        properties: {
          bindingId: "binding:amount",
          outputColumn: "amount",
          subtype: "IDENTITY",
          sourceReadOccurrenceId: "task:consumer-1:statement:0:relation:read.example",
          sourceReadOccurrenceStatus: "RESOLVED",
          expressionId: "expr:amount",
          sourceRelationId: "task:consumer-1:statement:0:relation:read.example",
        },
      }],
      localClosure: {
        finalWrites: [{
          writeObservationId: "write-observation:consumer-1:0",
          targetWriteNodeId: "target-write:consumer-1:0",
        }],
        readOccurrences: [],
      },
      gaps: [],
    };

    const index = {
      entryForRead: () => ({
        consumerTaskId: "consumer-1",
        readOccurrenceId: "task:consumer-1:statement:0:relation:read.example",
        readOccurrenceNodeId: "read-node:example",
        datasetNodeId: "dataset:example",
        qualifiedName: "warehouse.example_table",
        identityStatus: "CONFIRMED",
        partitionPredicateStatus: "NONE",
        candidates: [
          {
            taskId: "producer-a",
            writeObservationId: "write-observation:producer-a:0",
            targetWriteNodeId: "target-write:producer-a:0",
            datasetNodeId: "dataset:example",
            qualifiedName: "warehouse.example_table",
            source: "IN_UNION_FINAL_WRITE",
            partitionMatchStatus: "CONFIRMED",
            partition: [],
            evidenceLayer: "L1",
            l1Eligible: true,
          },
        ],
        prunedWriteObservationIds: [],
        gaps: [],
      }),
    };

    const producerProjection = {
      ...projection,
      taskId: "producer-a",
      nodes: [
        { nodeId: "task:producer-a", nodeType: "TASK", properties: {} },
        {
          nodeId: "physical-field:amount",
          nodeType: "PHYSICAL_FIELD",
          properties: { qualifiedName: "warehouse.example_table", column: "amount" },
        },
        {
          nodeId: "target-write:producer-a:0",
          nodeType: "TARGET_WRITE",
          properties: { writeObservationId: "write-observation:producer-a:0" },
        },
      ],
      edges: [{
        edgeId: "field-edge:amount",
        edgeType: "FIELD_DIRECT",
        fromNodeId: "physical-field:amount",
        toNodeId: "target-write:producer-a:0",
        properties: {
          bindingId: "binding:amount",
          outputColumn: "amount",
          subtype: "IDENTITY",
          sourceReadOccurrenceId: "task:producer-a:statement:0:relation:read.example",
          sourceReadOccurrenceStatus: "RESOLVED",
          expressionId: "expr:amount",
          sourceRelationId: "task:producer-a:statement:0:relation:read.example",
        },
      }],
      localClosure: {
        finalWrites: [{
          writeObservationId: "write-observation:producer-a:0",
          targetWriteNodeId: "target-write:producer-a:0",
        }],
        readOccurrences: [],
      },
    };

    const anchor = {
      taskId: "consumer-1",
      writeObservationId: "write-observation:consumer-1:0",
      outputColumn: "amount",
    };
    const baseInput = {
      anchor,
      index,
      projectionForTask: (taskId: string) => {
        if (taskId === "consumer-1") return projection;
        if (taskId === "producer-a") return producerProjection;
        return null;
      },
    } as unknown as ImpactQueryInput;

    const withoutSchedule = impactQuery(baseInput);
    const withSchedule = impactQuery({
      ...baseInput,
      scheduleRelationLookup: lookup,
    });

    expect(withoutSchedule.value.map((entry) => entry.evidenceStatus)).toEqual(
      withSchedule.value.map((entry) => entry.evidenceStatus),
    );
    expect(withoutSchedule.frontier).toHaveLength(0);
    expect(withSchedule.frontier).toHaveLength(0);
    expect(withSchedule.value.some((entry) => entry.depth === 1 && entry.evidenceStatus === "CONFIRMED")).toBe(true);
  });
});
