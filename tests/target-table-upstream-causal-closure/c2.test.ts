import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  canonicalJson,
  sha256,
} from "../../scripts/machine-facts/machine-facts-contract.ts";
import type {
  CandidateBranch,
  CandidateUniverse,
} from "../../scripts/reconcile/consumer/target-field-causal-slice/candidate-universe.ts";
import {
  buildTargetTableCausalClosureDiffV0,
  validateTargetTableCausalClosureDiffV0,
} from "../../scripts/reconcile/consumer/target-table-upstream-causal-closure/closure-diff.ts";
import { main as writeDiff } from "../../scripts/reconcile/consumer/target-table-upstream-causal-closure/reconcile-target-table-causal-closure-diff.ts";
import { buildShrinkReport } from "../../scripts/reconcile/consumer/target-table-upstream-causal-closure/static-assessment.ts";
import { normalizeReadScopes } from "../../scripts/reconcile/consumer/target-table-upstream-causal-closure/read-scope.ts";
import { createUnionV2FieldValueEvidenceProvider } from "../../scripts/reconcile/consumer/target-table-upstream-causal-closure/union-v2-field-value-provider.ts";
import {
  createUnionContinuationCandidateSource,
  type UnionContinuationIndex,
  type UnionContinuationIndexCandidate,
  type UnionContinuationIndexEntry,
} from "../../scripts/reconcile/consumer/target-table-upstream-causal-closure/union-continuation-candidate-source.ts";
import {
  createUnionV2ScheduleRelationLookup,
  projectUnionV2CandidateUniverse,
} from "../../scripts/reconcile/consumer/target-table-upstream-causal-closure/union-v2-candidate-universe.ts";
import type { TargetTableCausalClosureArtifact } from "../../scripts/reconcile/consumer/target-table-upstream-causal-closure/artifact-contract.ts";
import type { CurrentBundleLoad } from "../../scripts/query/current-task-bundle.ts";

const TABLE = {
  platform: "hive",
  dataSource: "gfhive",
  qualifiedName: "pdata_n.c2_source",
  stableTableId: "dataset:c2-source",
  identityStatus: "CONFIRMED",
} as const;

function occurrence(id: string) {
  return {
    occurrenceId: id,
    readRelationId: id,
    sqlSourceId: "task:root:slot:query",
    statementIndex: 0,
    rootRelationId: "task:root:statement:0:relation:root",
    relationPath: [id],
  };
}

function physicalBranch(
  id: string,
  producerTaskId = "producer",
): CandidateBranch {
  return {
    candidateBranchId: `legacy:${id}`,
    branchKind: "PHYSICAL_PRODUCER",
    rootTaskId: "root",
    consumerTaskId: "root",
    producerTaskId,
    table: TABLE,
    readOccurrence: occurrence(id),
    writeObservationId: "write-observation:producer:3",
    producerRole: "PRIMARY",
    writeScope: {
      sqlSourceId: "producer",
      statementOrdinal: 0,
      rootRelationId: "producer-root",
    },
    evidenceRefs: [],
    gapRefs: [],
    boundaryReason: null,
  };
}

function entry(
  readOccurrenceId: string,
  candidates: readonly UnionContinuationIndexCandidate[],
): UnionContinuationIndexEntry {
  return {
    consumerTaskId: "root",
    readOccurrenceId,
    readOccurrenceNodeId: `read:${readOccurrenceId}`,
    datasetNodeId: TABLE.stableTableId,
    qualifiedName: TABLE.qualifiedName,
    identityStatus: "CONFIRMED",
    partitionPredicateStatus: "NONE",
    candidates,
    prunedWriteObservationIds: candidates
      .filter((value) => value.partitionMatchStatus === "DISJOINT")
      .map((value) => value.writeObservationId),
    gaps: [],
  };
}

function candidate(
  overrides: Partial<UnionContinuationIndexCandidate> = {},
): UnionContinuationIndexCandidate {
  return {
    taskId: "producer",
    writeObservationId: "write-observation:producer:3",
    targetWriteNodeId: "target-write:producer:3",
    datasetNodeId: TABLE.stableTableId,
    qualifiedName: TABLE.qualifiedName,
    source: "PRODUCER_INDEX_ONLY",
    partitionMatchStatus: "UNKNOWN",
    partition: [],
    evidenceLayer: "L2",
    l1Eligible: false,
    ...overrides,
  };
}

function source(entries: readonly UnionContinuationIndexEntry[]) {
  const body = {
    schemaVersion: "1.0.0" as const,
    artifactType: "UNION_CONTINUATION_INDEX" as const,
    generatedAt: "2026-09-03T00:00:00.000Z",
    input: {
      batchManifestRef: { contentHash: "batch-hash" },
      producerIndex: {
        contentHash: "producer-hash",
        inputFingerprint: "input-hash",
      },
      taskProjections: [
        {
          taskId: "producer",
          contentHash: "projection-hash",
          schemaVersion: "1.2.0",
        },
      ],
    },
    entries,
  };
  const { generatedAt: _generatedAt, ...stableBody } = body;
  return createUnionContinuationCandidateSource({
    ...body,
    contentHash: sha256(canonicalJson(stableBody)),
  } as UnionContinuationIndex);
}

function scheduleRelation(
  producerTaskIds: readonly string[],
  consumerTaskId = "root",
) {
  return createUnionV2ScheduleRelationLookup({
    scheduleEdges: producerTaskIds.map((producerTaskId) => ({
      consumerTaskId,
      producerTaskId,
    })),
  });
}

function universe(branches: readonly CandidateBranch[]): CandidateUniverse {
  return {
    rootTaskId: "root",
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

function minimalArtifact(
  branches: readonly CandidateBranch[],
  assessments: TargetTableCausalClosureArtifact["assessments"],
  shrinkReport: TargetTableCausalClosureArtifact["shrinkReport"],
): TargetTableCausalClosureArtifact {
  return {
    schemaVersion: "1.2.0",
    artifactType: "TARGET_TABLE_UPSTREAM_CAUSAL_CLOSURE",
    generatedAt: "2026-09-03T00:00:00.000Z",
    targetWrite: {
      identity: {
        targetWriteId: "target-write:root:0",
        taskId: "root",
        targetTableKey: TABLE.qualifiedName,
        sqlSourceId: "root",
        statementOrdinal: 0,
        taskWriteOrdinal: 0,
        rootRelationId: "root-relation",
        writeObservationId: "write-observation:root:0",
        evidenceRefs: [],
      },
      snapshot: {
        inputPackFingerprint: "input",
        machineFactsHash: "facts",
        producerIndexHash: "producer",
        tableMultiHopHash: "multi-hop",
        semanticRuleVersion: "test",
      },
    },
    candidateUniverse: universe(branches),
    assessments,
    taskRollup: [],
    minimumCertainTaskIds: [],
    conservativeSafetyTaskIds: [],
    runtimeRerunDecision: "NOT_EVALUATED",
    shrinkReport,
    relationSummaries: [],
    metrics: {
      candidateBranchCount: branches.length,
      assessmentCount: assessments.length,
      upstreamTaskCount: 0,
      fieldValueEvidenceScanCount: 1,
      evidenceClosureRate: "NOT_APPLICABLE",
      decisionCoverage: {
        numerator: assessments.length,
        denominator: branches.length,
        rate: 1,
      },
      bridgeStats: { resolved: 0, ambiguous: 0, missing: 0 },
      peakMemoryBytes: 0,
      continuationStats: {
        l1: 0,
        l2Assumed: 0,
        l2Unknown: 0,
        piOnly: 0,
        disjointPruned: 0,
        ambiguousReads: 0,
        unmatchedReads: 1,
      },
    },
    stages: [],
    gaps: [],
    contentHash: "artifact-hash",
  };
}

describe("closure-on-union C2", () => {
  it("canonicalizes a proven multi-hop placeholder only for the union-v2 boundary", () => {
    const localRead = "root.source.read.c2_source";
    const factsOccurrence = `task:root:statement:0:relation:${localRead}`;
    const facts: CurrentBundleLoad = {
      records: {
        "statements.jsonl": [
          {
            statement_id: "task:root:slot:query:statement:0",
            statement_index: 0,
          },
        ],
        "dataset-io.jsonl": [
          {
            task_id: "root",
            direction: "READ",
            physical_dataset: TABLE.qualifiedName,
            statement_id: "task:root:slot:query:statement:0",
            read_occurrences: [
              {
                occurrence_id: factsOccurrence,
                relation_id: factsOccurrence,
              },
            ],
          },
        ],
      },
      state: "CURRENT_L1",
      factsRoot: "facts",
      taskId: "root",
      bundleDir: "",
      indexPath: "",
      statusPath: "",
      evidence: {},
      issues: [],
    };
    const base = universe([physicalBranch(`query#0:${localRead}`)]);
    const legacy = normalizeReadScopes(base, () => facts);
    expect(legacy.branches[0]?.readOccurrence?.occurrenceId).toBe(
      `query#0:${localRead}`,
    );
    const unionV2 = normalizeReadScopes(base, () => facts, {
      canonicalizePlaceholderOccurrences: true,
    });
    expect(unionV2.branches[0]?.readOccurrence?.occurrenceId).toBe(
      factsOccurrence,
    );
  });

  it("takes every physical producer from INDEX, drops schedule/disjoint, and marks an unmatched read boundary", () => {
    const oldRead = "task:root:statement:0:relation:old";
    const indexedRead = "task:root:statement:0:relation:indexed";
    const disjointRead = "task:root:statement:0:relation:disjoint";
    const result = projectUnionV2CandidateUniverse({
      rootTaskId: "root",
      baseUniverse: universe([
        physicalBranch(oldRead),
        physicalBranch(indexedRead),
        physicalBranch(disjointRead),
        {
          ...physicalBranch(indexedRead),
          candidateBranchId: "schedule",
          branchKind: "SCHEDULE_ONLY",
          table: null,
          readOccurrence: null,
          producerTaskId: "producer",
          producerRole: null,
          writeObservationId: null,
          writeScope: undefined,
          boundaryReason: "SCHEDULE_ONLY",
        },
      ]),
      source: source([
        entry(indexedRead, [candidate()]),
        entry("task:root:statement:0:relation:disjoint", [
          candidate({ partitionMatchStatus: "DISJOINT" }),
        ]),
      ]),
      scheduleRelation: scheduleRelation(["producer"]),
    });
    const physical = result.universe.branches.filter(
      (branch) => branch.branchKind === "PHYSICAL_PRODUCER",
    );
    expect(physical).toHaveLength(1);
    expect(physical[0]?.writeObservationId).toBe(
      "write-observation:producer:3",
    );
    expect(physical[0]?.producerRole).toBe("PRODUCER_INDEX_ONLY");
    expect(
      physical[0]?.evidenceRefs.every((ref) =>
        ref.source?.startsWith("UNION_CONTINUATION_INDEX"),
      ),
    ).toBe(true);
    expect(
      result.universe.branches.some(
        (branch) => branch.branchKind === "SCHEDULE_ONLY",
      ),
    ).toBe(false);
    expect(
      result.universe.branches.some((branch) =>
        branch.gapRefs.some((gap) =>
          gap.includes("CONTINUATION_READ_NOT_FOUND"),
        ),
      ),
    ).toBe(true);
    expect(result.disjointPruned).toBe(1);
  });

  it("keeps same-task self-reads as local boundaries instead of unmatched INDEX reads", () => {
    const readId = "task:root:statement:0:relation:self-read";
    const result = projectUnionV2CandidateUniverse({
      rootTaskId: "root",
      baseUniverse: universe([physicalBranch(readId)]),
      source: source([]),
      scheduleRelation: scheduleRelation(["producer"]),
      isSameTaskSelfRead: (consumerTaskId, qualifiedName) =>
        consumerTaskId === "root" && qualifiedName === TABLE.qualifiedName,
    });

    expect(result.unmatchedReads).toBe(0);
    expect(result.selfReadBoundaries).toBe(1);
    const boundary = result.universe.branches.find(
      (branch) => branch.branchKind === "UNBOUND_READ",
    );
    expect(boundary?.boundaryReason).toBe(
      "SELF_READ_NOT_EXTERNAL",
    );
    expect(boundary?.gapRefs).toContain(
      "continuation-gap:legacy:task:root:statement:0:relation:self-read:SELF_READ_NOT_EXTERNAL",
    );
  });

  it("intersects INDEX candidates with the raw schedule relation before projection", () => {
    const readId = "task:root:statement:0:relation:indexed";
    const candidates = ["103234", "103235", "103236", "103237"].map(
      (taskId) =>
        candidate({
          taskId,
          writeObservationId: `write-observation:${taskId}:0`,
        }),
    );
    const result = projectUnionV2CandidateUniverse({
      rootTaskId: "root",
      baseUniverse: universe([physicalBranch(readId)]),
      source: source([entry(readId, candidates)]),
      scheduleRelation: scheduleRelation(["103234", "103237"]),
    });

    expect(
      result.universe.branches
        .filter((branch) => branch.branchKind === "PHYSICAL_PRODUCER")
        .map((branch) => branch.producerTaskId)
        .sort(),
    ).toEqual(["103234", "103237"]);
  });

  it("fails closed as an UNKNOWN boundary when schedule relation is unavailable", () => {
    const readId = "task:root:statement:0:relation:indexed";
    const result = projectUnionV2CandidateUniverse({
      rootTaskId: "root",
      baseUniverse: universe([physicalBranch(readId)]),
      source: source([entry(readId, [candidate()])]),
      scheduleRelation: createUnionV2ScheduleRelationLookup({}),
    });

    expect(
      result.universe.branches.some(
        (branch) =>
          branch.branchKind === "UNBOUND_READ" &&
          branch.boundaryReason === "SCHEDULE_RELATION_UNRESOLVED" &&
          branch.gapRefs.some((gap) =>
            gap.includes("SCHEDULE_RELATION_UNRESOLVED"),
          ),
      ),
    ).toBe(true);
    expect(
      result.universe.branches.some(
        (branch) => branch.branchKind === "PHYSICAL_PRODUCER",
      ),
    ).toBe(false);
  });

  it("caps legacy field-lineage at CONDITIONAL and does not create valueCertain without Facts proof", () => {
    const branch = physicalBranch("read");
    const provider = createUnionV2FieldValueEvidenceProvider({
      legacyProvider: {
        scanCount: 1,
        edgeCount: 1,
        lookup: (value) => ({
          candidateBranchId: value.candidateBranchId,
          status: "CONFIRMED" as const,
          affectedTargetFields: ["id"],
          outputFieldBindingIds: ["binding"],
          evidenceRefs: ["legacy-field-lineage"],
          gapRefs: [],
        }),
      },
      source: source([]),
      branches: [branch],
      loadForTask: () => ({
        records: {},
        state: "CURRENT_L1",
        factsRoot: "facts",
        taskId: "producer",
        bundleDir: "",
        indexPath: "",
        statusPath: "",
        evidence: {},
        issues: [],
      }),
    });
    expect(provider.lookup(branch).status).toBe("CONDITIONAL");
    expect(provider.valueCertainBranchIds.size).toBe(0);
    const assessment = {
      assessmentId: "assessment",
      targetWriteId: "target-write:root:0",
      candidateBranchId: branch.candidateBranchId,
      relationStatus: "CONDITIONAL_RELATED" as const,
      channelAssessments: [
        {
          channel: "FIELD_VALUE" as const,
          status: "CONDITIONAL" as const,
          proofRefs: ["legacy-field-lineage"],
          witnessRefs: ["legacy-field-lineage"],
          gapRefs: [],
          affectedTargetFields: ["id"],
        },
      ],
      evidenceRefs: ["legacy-field-lineage"],
      gapRefs: [],
      negativeProofs: [],
    };
    expect(
      buildShrinkReport({ branches: [branch], assessments: [assessment] })
        .valueCertain,
    ).toEqual([]);
  });

  it("emits a hashed diff v0 with stable shrink reasons", () => {
    const legacyBranch = physicalBranch("read");
    const legacyAssessment = {
      assessmentId: "legacy-assessment",
      targetWriteId: "target-write:root:0",
      candidateBranchId: legacyBranch.candidateBranchId,
      relationStatus: "CONFIRMED_RELATED" as const,
      channelAssessments: [
        {
          channel: "FIELD_VALUE" as const,
          status: "CONFIRMED" as const,
          proofRefs: [],
          witnessRefs: [],
          gapRefs: [],
        },
      ],
      evidenceRefs: [],
      gapRefs: [],
      negativeProofs: [],
    };
    const legacy = minimalArtifact([legacyBranch], [legacyAssessment], {
      valueCertain: [
        {
          taskId: "producer",
          table: TABLE.qualifiedName,
          channel: "FIELD_VALUE",
          viaFields: [],
          witness: [],
        },
      ],
      rowDetermining: [],
      multiplicityRisk: [],
      prunedCount: 0,
      prunedReasons: [],
    });
    const unionBoundary: CandidateBranch = {
      ...legacyBranch,
      candidateBranchId: "union-boundary",
      branchKind: "UNBOUND_READ",
      producerTaskId: null,
      producerRole: null,
      writeObservationId: null,
      writeScope: undefined,
      gapRefs: ["continuation-gap:read:CONTINUATION_READ_NOT_FOUND"],
      boundaryReason: "CONTINUATION_READ_NOT_FOUND",
    };
    const unionAssessment = {
      ...legacyAssessment,
      assessmentId: "union-assessment",
      candidateBranchId: unionBoundary.candidateBranchId,
      relationStatus: "UNKNOWN" as const,
      channelAssessments: [
        {
          channel: "FIELD_VALUE" as const,
          status: "UNKNOWN" as const,
          proofRefs: [],
          witnessRefs: [],
          gapRefs: unionBoundary.gapRefs,
        },
      ],
      gapRefs: unionBoundary.gapRefs,
    };
    const union = minimalArtifact([unionBoundary], [unionAssessment], {
      valueCertain: [],
      rowDetermining: [],
      multiplicityRisk: [],
      prunedCount: 0,
      prunedReasons: [],
    });
    const diff = buildTargetTableCausalClosureDiffV0({
      legacy,
      unionV2: union,
    });
    validateTargetTableCausalClosureDiffV0(diff);
    expect(diff.artifactType).toBe("TARGET_TABLE_CAUSAL_CLOSURE_DIFF_V0");
    expect(diff.baselineAnchor.expectedTierOneTaskCount).toBe(27);
    expect(diff.summary.reasonCounts).toMatchObject({
      CONTINUATION_READ_NOT_FOUND: 1,
      VALUE_CERTAINTY_CAP: 1,
    });
    expect(
      diff.entries.some((entry) =>
        entry.reasons.includes("CONTINUATION_READ_NOT_FOUND"),
      ),
    ).toBe(true);

    const directory = mkdtempSync(join(tmpdir(), "closure-diff-v0-"));
    const legacyPath = join(directory, "legacy.json");
    const unionPath = join(directory, "union.json");
    const outputPath = join(directory, "diff.json");
    writeFileSync(legacyPath, JSON.stringify(legacy), "utf8");
    writeFileSync(unionPath, JSON.stringify(union), "utf8");
    writeDiff([
      "--legacy-artifact",
      legacyPath,
      "--union-artifact",
      unionPath,
      "--output",
      outputPath,
    ]);
    expect(existsSync(outputPath)).toBe(true);
    const written = JSON.parse(readFileSync(outputPath, "utf8")) as typeof diff;
    validateTargetTableCausalClosureDiffV0(written);
    expect(written.summary.reasonCounts).toMatchObject({
      CONTINUATION_READ_NOT_FOUND: 1,
      VALUE_CERTAINTY_CAP: 1,
    });
  });
});
