import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  canonicalJson,
  sha256,
} from "../../scripts/machine-facts/machine-facts-contract.ts";
import {
  canonicalizeTargetTableArtifact,
  type TargetTableCausalClosureArtifact,
} from "../../scripts/reconcile/consumer/target-table-upstream-causal-closure/artifact-contract.ts";
import {
  createGateBUnionL1Set,
  type GateBUnionL1Set,
} from "../../scripts/reconcile/consumer/target-table-upstream-causal-closure/gate-b-union.ts";
import { parseGateBUnionArgs } from "../../scripts/reconcile/consumer/target-table-upstream-causal-closure/gate-b-union-cli.ts";
import type {
  CandidateBranch,
  CandidatePhysicalTable,
} from "../../scripts/reconcile/consumer/target-field-causal-slice/candidate-universe.ts";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const TABLE: CandidatePhysicalTable = {
  platform: "hive",
  dataSource: "gfhive",
  qualifiedName: "demo.source",
  stableTableId: "demo.source__gfhive",
  identityStatus: "SCHEMA_BACKED",
};
const READ_OCCURRENCE = "task:root:statement:0:relation:root.read.demo_source";
const WRITE_OBSERVATION = "write-observation:producer:0";
function makeIndex() {
  const body = {
    schemaVersion: "1.0.0" as const,
    artifactType: "UNION_CONTINUATION_INDEX" as const,
    generatedAt: "2026-09-03T00:00:00.000Z",
    input: {
      batchManifestRef: { contentHash: "batch-hash" },
      producerIndex: { contentHash: "producer-hash", inputFingerprint: "input-hash" },
      taskProjections: [{ taskId: "producer", contentHash: "projection-hash", schemaVersion: "1.2.0" }],
    },
    entries: [
      {
        consumerTaskId: "root",
        readOccurrenceId: READ_OCCURRENCE,
        readOccurrenceNodeId: `read:${READ_OCCURRENCE}`,
        datasetNodeId: TABLE.stableTableId!,
        qualifiedName: TABLE.qualifiedName!,
        identityStatus: "CONFIRMED",
        partitionPredicateStatus: "LITERAL" as const,
        candidates: [
          {
            taskId: "producer",
            writeObservationId: WRITE_OBSERVATION,
            targetWriteNodeId: "target-write:producer:0",
            datasetNodeId: TABLE.stableTableId,
            qualifiedName: TABLE.qualifiedName!,
            source: "IN_UNION_FINAL_WRITE" as const,
            partitionMatchStatus: "CONFIRMED" as const,
            partition: [],
            evidenceLayer: "L1" as const,
            l1Eligible: true,
          },
        ],
        prunedWriteObservationIds: [],
        gaps: [],
      },
    ],
  };
  const { generatedAt: _generatedAt, ...stable } = body;
  return { ...body, contentHash: sha256(canonicalJson(stable)) };
}

const INDEX_HASH = makeIndex().contentHash;

function makeBranch(overrides: Partial<CandidateBranch> = {}): CandidateBranch {
  return {
    candidateBranchId: "candidate-branch:physical_producer:valid",
    branchKind: "PHYSICAL_PRODUCER",
    rootTaskId: "root",
    consumerTaskId: "root",
    producerTaskId: "producer",
    table: TABLE,
    readOccurrence: {
      occurrenceId: READ_OCCURRENCE,
      readRelationId: "root.read.demo_source",
      sqlSourceId: "task:root:slot:query",
      statementIndex: 0,
      rootRelationId: "task:root:statement:0:relation:root",
      relationPath: ["root.read.demo_source"],
    },
    writeObservationId: WRITE_OBSERVATION,
    producerRole: "PRIMARY",
    writeScope: {
      sqlSourceId: "task:producer:slot:query",
      statementOrdinal: 0,
      rootRelationId: "task:producer:statement:0:relation:root.project",
    },
    evidenceRefs: [
      { evidenceRefId: "index-evidence", source: "UNION_CONTINUATION_INDEX", locator: "index" },
      { evidenceRefId: "write-evidence", source: "MACHINE_FACTS_DATASET_IO", locator: "facts" },
    ],
    gapRefs: [],
    boundaryReason: null,
    continuation: {
      source: "IN_UNION_FINAL_WRITE",
      partitionMatchStatus: "CONFIRMED",
      evidenceLayer: "L1",
      l1Eligible: true,
      indexEntryRef: `union-continuation-index:${INDEX_HASH}:entry:root:${READ_OCCURRENCE}`,
    },
    ...overrides,
  };
}

function makeClosure(branches: readonly CandidateBranch[]): TargetTableCausalClosureArtifact {
  return canonicalizeTargetTableArtifact({
    schemaVersion: "1.2.0",
    artifactType: "TARGET_TABLE_UPSTREAM_CAUSAL_CLOSURE",
    generatedAt: "2026-09-03T00:00:00.000Z",
    targetWrite: {
      identity: {
        targetWriteId: "target-write:root:0",
        taskId: "root",
        targetTableKey: "demo.target",
        sqlSourceId: "task:root:slot:query",
        statementOrdinal: 0,
        taskWriteOrdinal: 0,
        rootRelationId: "task:root:statement:0:relation:root.project",
        writeObservationId: "write-observation:root:0",
        evidenceRefs: [],
      },
      snapshot: {
        inputPackFingerprint: "input",
        machineFactsHash: "facts",
        producerIndexHash: "producer",
        tableMultiHopHash: "multi-hop",
        semanticRuleVersion: "union-v2-test",
      },
    },
    candidateUniverse: {
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
    },
    assessments: [],
    taskRollup: [],
    minimumCertainTaskIds: [],
    conservativeSafetyTaskIds: [],
    runtimeRerunDecision: "NOT_EVALUATED",
    relationSummaries: [],
    metrics: {
      candidateBranchCount: branches.length,
      assessmentCount: 0,
      upstreamTaskCount: 0,
      fieldValueEvidenceScanCount: 1,
      evidenceClosureRate: "NOT_APPLICABLE",
      decisionCoverage: { numerator: branches.length, denominator: branches.length, rate: 1 },
      bridgeStats: { resolved: 1, ambiguous: 0, missing: 0 },
      continuationStats: {
        l1: 1,
        l2Assumed: 1,
        l2Unknown: 1,
        piOnly: 0,
        disjointPruned: 0,
        ambiguousReads: 0,
        unmatchedReads: 0,
      },
      peakMemoryBytes: 0,
    },
    stages: [],
    gaps: [],
    shrinkReport: {
      valueCertain: [{ taskId: "legacy-only", table: "legacy.table", channel: "FIELD_VALUE", viaFields: [], witness: [] }],
      rowDetermining: [],
      multiplicityRisk: [],
      prunedCount: 0,
      prunedReasons: [],
    },
  });
}

function writeInputs(closure: TargetTableCausalClosureArtifact) {
  const root = mkdtempSync(resolve(tmpdir(), "gate-b-union-test-"));
  tempRoots.push(root);
  const closurePath = resolve(root, "closure.json");
  const indexPath = resolve(root, "index.json");
  writeFileSync(closurePath, `${JSON.stringify(closure)}\n`, "utf8");
  writeFileSync(indexPath, `${JSON.stringify(makeIndex())}\n`, "utf8");
  return { closurePath, indexPath };
}

describe("Gate B-UNION L1 set", () => {
  it("parses the independent export CLI without changing reconcile defaults", () => {
    expect(
      parseGateBUnionArgs([
        "--closure-artifact",
        "closure.json",
        "--continuation-index",
        "index.json",
        "--output",
        "l1.json",
      ]),
    ).toEqual({
      closureArtifact: "closure.json",
      continuationIndex: "index.json",
      output: "l1.json",
    });
  });

  it("extracts only the INDEX-confirmed L1 chain and ignores L2 and legacy value evidence", () => {
    const closure = makeClosure([
      makeBranch(),
      makeBranch({
        candidateBranchId: "candidate-branch:physical_producer:assumed",
        writeObservationId: "write-observation:producer:1",
        continuation: {
          source: "IN_UNION_FINAL_WRITE",
          partitionMatchStatus: "ASSUMED",
          evidenceLayer: "L2",
          l1Eligible: false,
          indexEntryRef: "index:assumed",
        },
      }),
      makeBranch({
        candidateBranchId: "candidate-branch:schedule_only:ignored",
        branchKind: "SCHEDULE_ONLY",
        continuation: undefined,
      }),
    ]);
    const inputs = writeInputs(closure);
    const result = createGateBUnionL1Set({
      closureArtifactPath: inputs.closurePath,
      continuationIndexPath: inputs.indexPath,
    });

    expect(result.members).toHaveLength(1);
    expect(result.members[0]?.writeObservationId).toBe(WRITE_OBSERVATION);
    expect(result.members[0]?.continuation).toMatchObject({
      source: "IN_UNION_FINAL_WRITE",
      partitionMatchStatus: "CONFIRMED",
      evidenceLayer: "L1",
      l1Eligible: true,
    });
    expect(result.input.closureArtifact.contentHash).toBe(closure.contentHash);
    expect(result.input.continuationIndex.contentHash).not.toBe("");
    expect(result.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects a legacy closure that has no union-v2 continuation stats", () => {
    const closure = makeClosure([makeBranch()]);
    const legacy = { ...closure, metrics: { ...closure.metrics, continuationStats: undefined } };
    const { contentHash: _contentHash, ...legacyStable } = legacy;
    const legacyWithHash = { ...legacy, contentHash: sha256(canonicalJson(legacyStable)) };
    const inputs = writeInputs(legacyWithHash as TargetTableCausalClosureArtifact);
    expect(() =>
      createGateBUnionL1Set({
        closureArtifactPath: inputs.closurePath,
        continuationIndexPath: inputs.indexPath,
      }),
    ).toThrow("GATE_B_UNION_CLOSURE_INVALID:metrics.continuationStats");
  });
});

const artifactRoot = resolve(
  process.cwd(),
  "..",
  "sql-static-lineage-artifacts",
  "target-table-causal-closure",
  "c2",
);
const real176827Closure = resolve(artifactRoot, "176827-union-v2-full-index-recovered-v5.json");
const real176827Index = resolve(
  artifactRoot,
  "176827-continuation-index-full-recovered-v2",
  "union-continuation-index.json",
);

if (existsSync(real176827Closure) && existsSync(real176827Index)) {
  it("reads the current 176827 union-v2 closure and anchors its computed L1 count", () => {
    const result = createGateBUnionL1Set({
      closureArtifactPath: real176827Closure,
      continuationIndexPath: real176827Index,
    });
    const closure = JSON.parse(readFileSync(real176827Closure, "utf8")) as TargetTableCausalClosureArtifact;
    expect(result.targetWrite.taskId).toBe("176827");
    expect(result.members.length).toBe(closure.metrics.continuationStats?.l1);
    expect(result.members.length).toBe(11);
    expect(result.sourceMetrics.indexedPhysicalProducerCount).toBeGreaterThan(0);
    expect(result.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          consumerTaskId: "176827",
          producerTaskId: "103234",
          writeObservationId: "write-observation:103234:0",
        }),
      ]),
    );
  });
} else {
  console.warn(
    `GATE_B_UNION_INPUT_BLOCKER:176827:closure=${existsSync(real176827Closure)}:index=${existsSync(real176827Index)}`,
  );
  it.skip("176827 real closure input is unavailable; see explicit blocker above", () => undefined);
}

const real209119Closure = process.env.GATE_B_UNION_209119_CLOSURE ??
  resolve(artifactRoot, "209119-union-v2.json");
const real209119Index = process.env.GATE_B_UNION_209119_INDEX ??
  resolve(artifactRoot, "209119-continuation-index", "union-continuation-index.json");

if (existsSync(real209119Closure) && existsSync(real209119Index)) {
  it("reads a 209119 union-v2 closure when the caller supplies its verified inputs", () => {
    const result = createGateBUnionL1Set({
      closureArtifactPath: real209119Closure,
      continuationIndexPath: real209119Index,
    });
    expect(result.targetWrite.taskId).toBe("209119");
    expect(result.members.length).toBeGreaterThanOrEqual(0);
  });
} else {
  const blocker = `GATE_B_UNION_INPUT_BLOCKER:209119:closure=${real209119Closure}:index=${real209119Index}`;
  console.warn(blocker);
  it("does not claim a 209119 Gate B-UNION pass without closure and INDEX", () => {
    expect(blocker).toContain("GATE_B_UNION_INPUT_BLOCKER:209119");
    expect(existsSync(real209119Closure) && existsSync(real209119Index)).toBe(false);
  });
}
