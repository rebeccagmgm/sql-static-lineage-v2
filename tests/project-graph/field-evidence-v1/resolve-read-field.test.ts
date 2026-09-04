import { describe, expect, it } from "vitest";

import {
  createUnionContinuationCandidateSource,
  type UnionContinuationIndex,
  type UnionContinuationIndexCandidate,
  type UnionContinuationIndexEntry,
} from "../../../scripts/reconcile/consumer/target-table-upstream-causal-closure/union-continuation-candidate-source.ts";
import { canonicalJson, sha256 } from "../../../scripts/machine-facts/machine-facts-contract.ts";
import type { ContinuationPorts } from "../../../scripts/project-graph/field-evidence-v1/continuation/ports.ts";
import { buildFieldEdgeIndex } from "../../../scripts/project-graph/field-evidence-v1/field-edge-index.ts";
import { resolveReadField } from "../../../scripts/project-graph/field-evidence-v1/resolve-read-field.ts";
import {
  createHoraeScheduleRelationLookupFromScheduleEdges,
} from "../../../scripts/project-graph/field-evidence-v1/schedule-preference.ts";
import type { TaskLocalProjection } from "../../../scripts/project-graph/task-local/contract.ts";

function continuationPorts(
  lookup: ContinuationPorts["scheduleLookup"],
): ContinuationPorts {
  return {
    scheduleLookup: lookup,
    writerCatalog: null,
    readScopeFor: () => ({ kind: "UNAVAILABLE", reasonCode: "READ_SCOPE_UNAVAILABLE" }),
    tableIdentityFor: ({ qualifiedName }) => ({
      platform: "warehouse",
      dataSource: "default",
      qualifiedName: qualifiedName.split(".").slice(-1)[0] ?? qualifiedName,
    }),
    taskCategoryFor: () => "sparkIndex",
  };
}

function candidate(
  overrides: Partial<UnionContinuationIndexCandidate> = {},
): UnionContinuationIndexCandidate {
  return {
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
    ...overrides,
  };
}

function entry(
  consumerTaskId: string,
  readOccurrenceId: string,
  candidates: readonly UnionContinuationIndexCandidate[],
): UnionContinuationIndexEntry {
  return {
    consumerTaskId,
    readOccurrenceId,
    readOccurrenceNodeId: `read-node:${readOccurrenceId}`,
    datasetNodeId: "dataset:example",
    qualifiedName: "warehouse.example_table",
    identityStatus: "CONFIRMED",
    partitionPredicateStatus: "NONE",
    candidates,
    prunedWriteObservationIds: [],
    gaps: [],
  };
}

function index(entries: readonly UnionContinuationIndexEntry[]) {
  const body = {
    schemaVersion: "1.0.0" as const,
    artifactType: "UNION_CONTINUATION_INDEX" as const,
    generatedAt: "2026-09-04T00:00:00.000Z",
    input: {
      batchManifestRef: { contentHash: "batch-hash" },
      producerIndex: { contentHash: "producer-hash", inputFingerprint: "input-hash" },
      taskProjections: [],
    },
    entries,
  };
  const { generatedAt: _generatedAt, ...stableBody } = body;
  return {
    ...body,
    contentHash: sha256(canonicalJson(stableBody)),
  } satisfies UnionContinuationIndex;
}

function projectionWithBinding(input: {
  readonly taskId: string;
  readonly writeObservationId: string;
  readonly outputColumn: string;
  readonly readOccurrenceId: string;
}): TaskLocalProjection {
  const targetWriteNodeId = `target-write:${input.taskId}:0`;
  const fieldNodeId = "physical-field:amount";
  return {
    schemaVersion: "1.3.0",
    artifactType: "TASK_LOCAL_PROJECTION",
    generatedAt: "2026-09-04T00:00:00.000Z",
    taskId: input.taskId,
    coverageStatus: "PROJECTED",
    failureReasonCode: null,
    contentHash: "projection-hash",
    nodes: [
      { nodeId: `task:${input.taskId}`, nodeType: "TASK", properties: {} },
      {
        nodeId: fieldNodeId,
        nodeType: "PHYSICAL_FIELD",
        properties: {
          qualifiedName: "warehouse.example_table",
          column: "amount",
        },
      },
      {
        nodeId: targetWriteNodeId,
        nodeType: "TARGET_WRITE",
        properties: { writeObservationId: input.writeObservationId },
      },
    ],
    edges: [{
      edgeId: "edge:field-direct:1",
      edgeType: "FIELD_DIRECT",
      fromNodeId: fieldNodeId,
      toNodeId: targetWriteNodeId,
      properties: {
        outputColumn: input.outputColumn,
        expressionId: "expr:1",
        sourceReadOccurrenceId: input.readOccurrenceId,
        sourceReadOccurrenceStatus: "RESOLVED",
        sourceRelationId: "relation:read:1",
        subtype: "IDENTITY",
      },
    }],
    localClosure: {
      finalWrites: [{
        writeObservationId: input.writeObservationId,
        targetWriteNodeId,
        datasetNodeId: "dataset:target",
        qualifiedName: "warehouse.target_table",
      }],
      externalReads: [],
      localFieldPaths: [],
    },
    gaps: [],
  };
}

describe("resolveReadField", () => {
  const consumerTaskId = "consumer-x";
  const readOccurrenceId = "task:consumer-x:statement:0:relation:root.read.example";
  const column = "amount";

  it("returns CONFIRMED for a unique continuationEligible candidate with producer binding", () => {
    const writeObservationId = "write-observation:producer-a:0";
    const source = createUnionContinuationCandidateSource(index([
      entry(consumerTaskId, readOccurrenceId, [candidate({ writeObservationId })]),
    ]));
    const producerProjection = projectionWithBinding({
      taskId: "producer-a",
      writeObservationId,
      outputColumn: column,
      readOccurrenceId,
    });
    const resolved = resolveReadField({
      consumerTaskId,
      readOccurrenceId,
      column,
      index: source,
      producerIndexForTask: (taskId) =>
        taskId === "producer-a" ? buildFieldEdgeIndex({ projection: producerProjection }) : null,
      continuationPorts: continuationPorts(null),
    });
    expect(resolved.kind).toBe("CONFIRMED");
    if (resolved.kind === "CONFIRMED") {
      expect(resolved.producerEdges).toHaveLength(1);
    }
  });

  it("returns FRONTIER for multiple candidates", () => {
    const source = createUnionContinuationCandidateSource(index([
      entry(consumerTaskId, readOccurrenceId, [
        candidate({ taskId: "producer-a" }),
        candidate({ taskId: "producer-b", writeObservationId: "write-observation:producer-b:0" }),
      ]),
    ]));
    const resolved = resolveReadField({
      consumerTaskId,
      readOccurrenceId,
      column,
      index: source,
      producerIndexForTask: () => null,
      continuationPorts: continuationPorts(null),
    });
    expect(resolved.kind).toBe("FRONTIER");
  });

  it("does not schedule-prune UNKNOWN writers when a unique Horae parent exists", () => {
    const lookup = createHoraeScheduleRelationLookupFromScheduleEdges([
      { consumerTaskId, producerTaskId: "producer-b" },
    ]);
    const source = createUnionContinuationCandidateSource(index([
      entry(consumerTaskId, readOccurrenceId, [
        candidate({ taskId: "producer-a", l1Eligible: false, partitionMatchStatus: "UNKNOWN" }),
        candidate({
          taskId: "producer-b",
          writeObservationId: "write-observation:producer-b:0",
          l1Eligible: false,
          partitionMatchStatus: "UNKNOWN",
        }),
      ]),
    ]));
    const resolved = resolveReadField({
      consumerTaskId,
      readOccurrenceId,
      column,
      index: source,
      producerIndexForTask: () => null,
      continuationPorts: continuationPorts(lookup),
    });
    expect(resolved.kind).toBe("FRONTIER");
    if (resolved.kind === "FRONTIER") {
      expect(resolved.candidates.map((entry) => entry.taskId).sort()).toEqual([
        "producer-a",
        "producer-b",
      ]);
    }
  });

  it("schedule-tiebreaks overlapping writers to the unique Horae parent", () => {
    const lookup = createHoraeScheduleRelationLookupFromScheduleEdges([
      { consumerTaskId, producerTaskId: "producer-b" },
    ]);
    const source = createUnionContinuationCandidateSource(index([
      entry(consumerTaskId, readOccurrenceId, [
        candidate({ taskId: "producer-a", l1Eligible: false, partitionMatchStatus: "ASSUMED" }),
        candidate({
          taskId: "producer-b",
          writeObservationId: "write-observation:producer-b:0",
          l1Eligible: false,
          partitionMatchStatus: "ASSUMED",
        }),
      ]),
    ]));
    const resolved = resolveReadField({
      consumerTaskId,
      readOccurrenceId,
      column,
      index: source,
      producerIndexForTask: () => null,
      continuationPorts: continuationPorts(lookup),
    });
    expect(resolved.kind).toBe("FRONTIER");
    if (resolved.kind === "FRONTIER") {
      expect(resolved.candidates.map((entry) => entry.taskId)).toEqual(["producer-b"]);
    }
  });

  it("does not schedule-prune when Horae lookup is unavailable", () => {
    const source = createUnionContinuationCandidateSource(index([
      entry(consumerTaskId, readOccurrenceId, [
        candidate({ taskId: "producer-a" }),
        candidate({ taskId: "producer-b", writeObservationId: "write-observation:producer-b:0" }),
      ]),
    ]));
    const resolved = resolveReadField({
      consumerTaskId,
      readOccurrenceId,
      column,
      index: source,
      producerIndexForTask: () => null,
      continuationPorts: continuationPorts(null),
    });
    expect(resolved.kind).toBe("FRONTIER");
    if (resolved.kind === "FRONTIER") {
      expect(resolved.candidates).toHaveLength(2);
    }
  });

  it("returns NO_INDEX_ENTRY when the read occurrence is absent", () => {
    const source = createUnionContinuationCandidateSource(index([]));
    const resolved = resolveReadField({
      consumerTaskId,
      readOccurrenceId,
      column,
      index: source,
      producerIndexForTask: () => null,
      continuationPorts: continuationPorts(null),
    });
    expect(resolved.kind).toBe("NO_INDEX_ENTRY");
  });

  it("returns NO_BINDING when producer has no matching field edge", () => {
    const writeObservationId = "write-observation:producer-a:0";
    const source = createUnionContinuationCandidateSource(index([
      entry(consumerTaskId, readOccurrenceId, [candidate({ writeObservationId })]),
    ]));
    const emptyProducer = projectionWithBinding({
      taskId: "producer-a",
      writeObservationId,
      outputColumn: "other-column",
      readOccurrenceId,
    });
    const resolved = resolveReadField({
      consumerTaskId,
      readOccurrenceId,
      column,
      index: source,
      producerIndexForTask: () => buildFieldEdgeIndex({ projection: emptyProducer }),
      continuationPorts: continuationPorts(null),
    });
    expect(resolved.kind).toBe("NO_BINDING");
  });
});
