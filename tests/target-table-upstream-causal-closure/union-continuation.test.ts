import { describe, expect, it } from "vitest";

import { canonicalJson, sha256 } from "../../scripts/machine-facts/machine-facts-contract.ts";
import type { CandidateBranch, CandidateUniverse } from "../../scripts/reconcile/consumer/target-field-causal-slice/candidate-universe.ts";
import { buildCausalClosure } from "../../scripts/reconcile/consumer/target-table-upstream-causal-closure/causal-closure.ts";
import {
  createUnionContinuationCandidateSource,
  type UnionContinuationIndex,
  type UnionContinuationIndexCandidate,
  type UnionContinuationIndexEntry,
} from "../../scripts/reconcile/consumer/target-table-upstream-causal-closure/union-continuation-candidate-source.ts";
import {
  enrichUnionV2ProducerBridges,
  parseArgs,
} from "../../scripts/reconcile/consumer/target-table-upstream-causal-closure/reconcile-target-table-causal-closure.ts";
import { relationSummaryKey, type TaskRelationSummary } from "../../scripts/reconcile/consumer/target-table-upstream-causal-closure/task-relation-summary.ts";
import { createUnionV2ScheduleRelationLookup } from "../../scripts/reconcile/consumer/target-table-upstream-causal-closure/union-v2-candidate-universe.ts";
import type { CurrentBundleLoad } from "../../scripts/query/current-task-bundle.ts";

const TABLE = {
  platform: "hive",
  dataSource: "gfhive",
  qualifiedName: "pdata_n.t03_agt_stati_info_h",
  stableTableId: "dataset:t03-agt-stati-info-h",
  identityStatus: "CONFIRMED",
} as const;

function candidate(overrides: Partial<UnionContinuationIndexCandidate> = {}): UnionContinuationIndexCandidate {
  return {
    taskId: "105387",
    writeObservationId: "write-observation:105387:3",
    targetWriteNodeId: "target-write:105387:3",
    datasetNodeId: TABLE.stableTableId,
    qualifiedName: TABLE.qualifiedName,
    source: "IN_UNION_FINAL_WRITE",
    partitionMatchStatus: "CONFIRMED",
    partition: [],
    evidenceLayer: "L1",
    l1Eligible: true,
    ...overrides,
  };
}

function entry(
  readOccurrenceId: string,
  candidates: readonly UnionContinuationIndexCandidate[],
): UnionContinuationIndexEntry {
  return {
    consumerTaskId: "119044",
    readOccurrenceId,
    readOccurrenceNodeId: `read-node:${readOccurrenceId}`,
    datasetNodeId: TABLE.stableTableId,
    qualifiedName: TABLE.qualifiedName,
    identityStatus: "CONFIRMED",
    partitionPredicateStatus: "NON_LITERAL_PRESENT",
    candidates,
    prunedWriteObservationIds: candidates
      .filter((value) => value.partitionMatchStatus === "DISJOINT")
      .map((value) => value.writeObservationId),
    gaps: [],
  };
}

function index(entries: readonly UnionContinuationIndexEntry[]): UnionContinuationIndex {
  const body = {
    schemaVersion: "1.0.0" as const,
    artifactType: "UNION_CONTINUATION_INDEX" as const,
    generatedAt: "2026-09-03T00:00:00.000Z",
    input: {
      batchManifestRef: { contentHash: "batch-hash" },
      producerIndex: { contentHash: "producer-hash", inputFingerprint: "input-hash" },
      taskProjections: [{ taskId: "119044", contentHash: "projection-hash", schemaVersion: "1.2.0" }],
    },
    entries,
  };
  const { generatedAt: _generatedAt, ...stableBody } = body;
  return { ...body, contentHash: sha256(canonicalJson(stableBody)) };
}

function occurrence(id: string) {
  return {
    occurrenceId: id,
    readRelationId: id,
    sqlSourceId: "task:119044:slot:query",
    statementIndex: 0,
    rootRelationId: "task:119044:statement:0:relation:root",
    relationPath: ["task:119044:statement:0:relation:root", id],
  };
}

function branch(readOccurrenceId: string, producerTaskId = "105387"): CandidateBranch {
  return {
    candidateBranchId: `branch:${readOccurrenceId}`,
    branchKind: "PHYSICAL_PRODUCER",
    rootTaskId: "119044",
    consumerTaskId: "119044",
    producerTaskId,
    table: TABLE,
    readOccurrence: occurrence(readOccurrenceId),
    producerRole: "PRIMARY",
    evidenceRefs: [],
    gapRefs: [],
    boundaryReason: null,
  };
}

function scheduleBranch(): CandidateBranch {
  return {
    candidateBranchId: "schedule:119044:105387",
    branchKind: "SCHEDULE_ONLY",
    rootTaskId: "119044",
    consumerTaskId: "119044",
    producerTaskId: "105387",
    table: null,
    readOccurrence: null,
    producerRole: null,
    evidenceRefs: [],
    gapRefs: [],
    boundaryReason: "SCHEDULE_ONLY",
  };
}

function universe(branches: readonly CandidateBranch[]): CandidateUniverse {
  return {
    rootTaskId: "119044",
    status: "COMPLETE_OBSERVED_EVIDENCE",
    branches,
    boundaryGapRefs: [],
    coverage: {
      sourceArtifactType: "TABLE_MULTI_HOP_RECONCILIATION",
      sourceCoverageStatus: "COMPLETE_OBSERVED_EVIDENCE",
      sourceCoverageSemantics: null,
      sourceLimitsTruncated: false,
    },
  };
}

function load(taskId: string, writeObservationIds: readonly string[]): CurrentBundleLoad {
  return {
    state: "CURRENT_L1",
    factsRoot: "facts",
    taskId,
    bundleDir: "",
    indexPath: "",
    statusPath: "",
    records: {
      "output-field-bindings.jsonl": writeObservationIds.map((writeObservationId) => ({
        task_id: taskId,
        write_observation_id: writeObservationId,
        target_dataset: TABLE.qualifiedName,
        write_statement_id: `task:${taskId}:slot:query:statement:0`,
        expression_id: `task:${taskId}:statement:0:relation:root.write:expression:${writeObservationId}`,
      })),
    },
    evidence: {},
    issues: [],
  };
}

const noopLoad = (taskId: string): CurrentBundleLoad => load(taskId, []);

function scheduleRelation(producerTaskIds: readonly string[], consumerTaskId = "119044") {
  return createUnionV2ScheduleRelationLookup({
    scheduleEdges: producerTaskIds.map((producerTaskId) => ({
      consumerTaskId,
      producerTaskId,
    })),
  });
}

describe("closure-on-union C0/C1", () => {
  it("parses the new CLI flags and defaults to legacy", () => {
    const common = [
      "--data-root", "data",
      "--facts-root", "facts",
      "--producer-index", "producer.json",
      "--table-multi-hop", "multi-hop.json",
      "--task-id", "119044",
      "--target-table", TABLE.qualifiedName,
      "--output", "out.json",
    ];
    expect(parseArgs(common).candidateSource).toBe("legacy");
    expect(() => parseArgs([...common, "--candidate-source", "union-v2"])).toThrow("ARGUMENT_MISSING:continuation-index");
    expect(parseArgs([...common, "--candidate-source", "union-v2", "--continuation-index", "index.json"]))
      .toMatchObject({ candidateSource: "union-v2", continuationIndex: "index.json" });
  });

  it("looks up only the exact consumer/read occurrence", () => {
    const value = index([
      entry("read-c", [candidate()]),
    ]);
    const source = createUnionContinuationCandidateSource(value);
    expect(() => createUnionContinuationCandidateSource({ ...value, generatedAt: "2026-09-03T01:00:00.000Z" })).not.toThrow();
    expect(source.candidatesForRead("119044", "read-c")).toHaveLength(1);
    expect(source.candidatesForRead("119044", "read-k")).toEqual([]);
    expect(source.candidatesForRead("other-task", "read-c")).toEqual([]);
  });

  it("attaches exact scopes, prunes DISJOINT, counts one ambiguous read, and removes schedule-only branches", () => {
    const readId = "task:119044:statement:0:relation:root.c.read.t03_agt_stati_info_h";
    const continuation = createUnionContinuationCandidateSource(index([
      entry(readId, [
        candidate(),
        candidate({ writeObservationId: "write-observation:105387:6", targetWriteNodeId: "target-write:105387:6", partitionMatchStatus: "DISJOINT", evidenceLayer: "L2", l1Eligible: false }),
        candidate({ writeObservationId: "write-observation:105387:9", targetWriteNodeId: "target-write:105387:9", partitionMatchStatus: "ASSUMED", evidenceLayer: "L2", l1Eligible: false }),
      ]),
    ]));
    const result = enrichUnionV2ProducerBridges(
      universe([branch(readId), scheduleBranch()]),
      continuation,
      (taskId) => load(taskId, ["write-observation:105387:3", "write-observation:105387:9"]),
      scheduleRelation(["105387"])
    );
    expect(result.universe.branches.some((value) => value.branchKind === "SCHEDULE_ONLY")).toBe(false);
    const physical = result.universe.branches.filter((value) => value.branchKind === "PHYSICAL_PRODUCER");
    expect(physical.map((value) => value.writeObservationId)).toEqual([
      "write-observation:105387:3",
      "write-observation:105387:9",
    ]);
    expect(physical.every((value) => value.writeScope?.rootRelationId === "task:105387:statement:0:relation:root.write")).toBe(true);
    expect(physical.find((value) => value.writeObservationId?.endsWith(":3"))?.continuation?.l1Eligible).toBe(true);
    expect(physical.find((value) => value.writeObservationId?.endsWith(":9"))?.continuation?.partitionMatchStatus).toBe("ASSUMED");
    expect(result.stats).toEqual({ resolved: 1, ambiguous: 1, missing: 0 });
    expect(result.continuationStats).toEqual({ l1: 1, l2Assumed: 1, l2Unknown: 0, piOnly: 0, disjointPruned: 1, ambiguousReads: 1, unmatchedReads: 0 });
  });

  it("counts an L1 candidate but does not resolve it when exact scope binding is missing", () => {
    const readId = "task:119044:statement:0:relation:root.c.read.t03_agt_stati_info_h";
    const result = enrichUnionV2ProducerBridges(
      universe([branch(readId)]),
      createUnionContinuationCandidateSource(index([entry(readId, [candidate()])])),
      noopLoad,
      scheduleRelation(["105387"])
    );
    expect(result.universe.branches[0]?.continuation?.l1Eligible).toBe(true);
    expect(result.universe.branches[0]?.writeScope).toBeUndefined();
    expect(result.universe.branches[0]?.gapRefs.some((gap) => gap.includes("PRODUCER_WRITE_SCOPE_UNRESOLVED"))).toBe(true);
    expect(result.stats.resolved).toBe(0);
    expect(result.continuationStats).toMatchObject({ l1: 1, l2Assumed: 0, l2Unknown: 0, piOnly: 0 });
  });

  it("keeps 119044's two target-table reads out when SRC_TBL is DISJOINT", () => {
    const readC = "task:119044:statement:0:relation:root.c.read.t03_agt_stati_info_h";
    const readK = "task:119044:statement:0:relation:root.k.read.t03_agt_stati_info_h";
    const continuation = createUnionContinuationCandidateSource(index([
      entry(readC, [candidate({ taskId: "SRC_TBL", writeObservationId: "write-observation:SRC_TBL:0", partitionMatchStatus: "DISJOINT", evidenceLayer: "L2", l1Eligible: false })]),
      entry(readK, [candidate({ taskId: "SRC_TBL", writeObservationId: "write-observation:SRC_TBL:1", partitionMatchStatus: "DISJOINT", evidenceLayer: "L2", l1Eligible: false })]),
    ]));
    const result = enrichUnionV2ProducerBridges(
      universe([branch(readC, "SRC_TBL"), branch(readK, "SRC_TBL")]),
      continuation,
      noopLoad,
      scheduleRelation(["SRC_TBL"])
    );
    expect(result.universe.branches).toEqual([]);
    expect(result.continuationStats.disjointPruned).toBe(2);
    expect(result.stats.resolved).toBe(0);
  });

  it("reuses the schedule selector during enrichment and keeps a rejected bridge UNKNOWN", () => {
    const readId = "task:119044:statement:0:relation:root.c.read.t03_agt_stati_info_h";
    const result = enrichUnionV2ProducerBridges(
      universe([branch(readId, "105387")]),
      createUnionContinuationCandidateSource(index([entry(readId, [candidate({ taskId: "105387" })])])),
      noopLoad,
      scheduleRelation(["105388"]),
    );

    expect(result.universe.branches).toHaveLength(1);
    expect(result.universe.branches[0]?.branchKind).toBe("UNBOUND_READ");
    expect(result.universe.branches[0]?.boundaryReason).toBe("SCHEDULE_RELATION_NO_MATCH");
    expect(result.universe.branches.some((value) => value.branchKind === "PHYSICAL_PRODUCER")).toBe(false);
  });

  it("preserves 105387 #3/#6 alignment ambiguity and never shares PI :0", () => {
    const readId = "task:119044:statement:0:relation:root.c.read.t03_agt_stati_info_h";
    const continuation = createUnionContinuationCandidateSource(index([
      entry(readId, [
        candidate({ writeObservationId: "write-observation:105387:3", targetWriteNodeId: "target-write:105387:3", partitionMatchStatus: "UNKNOWN", evidenceLayer: "L2", l1Eligible: false, alignmentGapCode: "WRITE_OBSERVATION_ALIGNMENT_AMBIGUOUS", reasonCode: "WRITE_OBSERVATION_ALIGNMENT_AMBIGUOUS" }),
        candidate({ writeObservationId: "write-observation:105387:6", targetWriteNodeId: "target-write:105387:6", partitionMatchStatus: "UNKNOWN", evidenceLayer: "L2", l1Eligible: false, alignmentGapCode: "WRITE_OBSERVATION_ALIGNMENT_AMBIGUOUS", reasonCode: "WRITE_OBSERVATION_ALIGNMENT_AMBIGUOUS" }),
      ]),
    ]));
    const result = enrichUnionV2ProducerBridges(
      universe([branch(readId)]),
      continuation,
      (taskId) => load(taskId, ["write-observation:105387:3", "write-observation:105387:6"]),
      scheduleRelation(["105387"])
    );
    const physical = result.universe.branches.filter((value) => value.branchKind === "PHYSICAL_PRODUCER");
    expect(physical.map((value) => value.writeObservationId)).toEqual([
      "write-observation:105387:3",
      "write-observation:105387:6",
    ]);
    expect(physical.every((value) => value.continuation?.partitionMatchStatus === "UNKNOWN")).toBe(true);
    expect(physical.every((value) => value.gapRefs.some((gap) => gap.includes("WRITE_OBSERVATION_ALIGNMENT_AMBIGUOUS")))).toBe(true);
    expect(physical.some((value) => value.writeObservationId?.endsWith(":0"))).toBe(false);
    expect(result.stats).toEqual({ resolved: 0, ambiguous: 1, missing: 0 });
    expect(result.continuationStats).toEqual({ l1: 0, l2Assumed: 0, l2Unknown: 2, piOnly: 0, disjointPruned: 0, ambiguousReads: 1, unmatchedReads: 0 });
  });

  it("marks an exact indexed read as unmatched instead of falling back to table writes", () => {
    const preScoped = {
      ...branch("read-not-indexed", "105387"),
      writeObservationId: "write-observation:105387:0",
      writeScope: { sqlSourceId: "producer-source", statementOrdinal: 0, rootRelationId: "producer-root" },
    } satisfies CandidateBranch;
    const result = enrichUnionV2ProducerBridges(
      universe([preScoped]),
      createUnionContinuationCandidateSource(index([])),
      noopLoad,
      scheduleRelation(["105387"])
    );
    expect(result.universe.branches).toHaveLength(1);
    expect(result.universe.branches[0]?.writeObservationId).toBe(preScoped.writeObservationId);
    expect(result.universe.branches[0]?.writeScope).toEqual(preScoped.writeScope);
    expect(result.universe.branches[0]?.gapRefs).toContain("continuation-gap:branch:read-not-indexed:CONTINUATION_READ_NOT_FOUND");
    expect(result.continuationStats.unmatchedReads).toBe(1);
    expect(result.stats.resolved).toBe(0);
  });

  it("caps an ASSUMED continuation at CONDITIONAL during closure propagation", () => {
    const readId = "task:119044:statement:0:relation:root.c.read.t03_agt_stati_info_h";
    const indexed = enrichUnionV2ProducerBridges(
      universe([branch(readId)]),
      createUnionContinuationCandidateSource(index([
        entry(readId, [candidate({ partitionMatchStatus: "ASSUMED", evidenceLayer: "L2", l1Eligible: false })]),
      ])),
      (taskId) => load(taskId, ["write-observation:105387:3"]),
      scheduleRelation(["105387"])
    );
    const root: CandidateBranch = {
      candidateBranchId: "root-write",
      branchKind: "ROOT_WRITE",
      rootTaskId: "119044",
      consumerTaskId: null,
      producerTaskId: "119044",
      table: null,
      readOccurrence: null,
      writeObservationId: "write-observation:119044:0",
      writeScope: { sqlSourceId: "task:119044:slot:query", statementOrdinal: 0, rootRelationId: "task:119044:statement:0:relation:root" },
      producerRole: null,
      evidenceRefs: [],
      gapRefs: [],
      boundaryReason: null,
    };
    const summary: TaskRelationSummary = {
      taskId: "119044",
      sqlSourceId: "task:119044:slot:query",
      statementIndex: 0,
      rootRelationId: "task:119044:statement:0:relation:root",
      digest: "synthetic-summary",
      complete: true,
      readImpacts: [{ readOccurrenceId: readId, impactChannels: ["ROW_MEMBERSHIP"], evidenceRefs: ["synthetic-read"], gaps: [] }],
      relationCount: 1,
      readCount: 1,
      edgeCount: 1,
      gaps: [],
    };
    const closure = buildCausalClosure({
      targetWriteId: "write-observation:119044:0",
      rootTaskId: "119044",
      universe: universe([root, ...indexed.universe.branches]),
      summaries: new Map([[relationSummaryKey("119044", "task:119044:slot:query", 0, "task:119044:statement:0:relation:root"), summary]]),
      fieldValueProvider: { scanCount: 0, edgeCount: 0, lookup: (value: CandidateBranch) => ({ candidateBranchId: value.candidateBranchId, status: "NOT_APPLICABLE" as const, affectedTargetFields: [], outputFieldBindingIds: [], evidenceRefs: [], gapRefs: [] }) },
      rootWriteScope: root.writeScope ? { taskId: "119044", writeObservationId: root.writeObservationId!, ...root.writeScope } : undefined,
    });
    const assessment = closure.assessments.find((value) => value.candidateBranchId !== root.candidateBranchId);
    expect(assessment?.channelAssessments.find((value) => value.channel === "ROW_MEMBERSHIP")?.status).toBe("CONDITIONAL");
  });
});
