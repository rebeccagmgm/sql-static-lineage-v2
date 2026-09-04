import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { canonicalMachineFactsJson as canonicalJson } from "../../src/contracts/canonical-json.js";
import {
  taskLocalPhysicalDatasetNodeId as physicalDatasetNodeId,
  taskLocalPhysicalFieldNodeId as fieldEvidencePhysicalFieldNodeId,
  taskLocalReadOccurrenceNodeId as readOccurrenceNodeId,
  taskLocalTargetWriteNodeId as targetWriteNodeId,
  taskNodeId,
} from "../../src/contracts/identity.js";
import { sha256Hex as sha256 } from "../../src/contracts/sha256.js";
import { MACHINE_FACTS_CONTRACT_VERSION } from "../../scripts/machine-facts/machine-facts-contract.ts";
import { runInputPackMachineFacts } from "../../scripts/machine-facts/input-pack-machine-facts.ts";
import type { InputPackMachineFactsRunResult } from "../../scripts/machine-facts/input-pack-machine-facts.ts";
import {
  TASK_LOCAL_PROJECTION_SCHEMA_VERSION,
  taskLocalProjectionContentHash,
  validateTaskLocalProjection,
} from "../../scripts/project-graph/task-local/contract.ts";
import { projectTaskLocal } from "../../scripts/project-graph/task-local/project-task-local.ts";
import { reconcileFieldLineage } from "../../scripts/reconcile/consumer/field-lineage/field-lineage.ts";
import {
  FIELD_LINEAGE_SCHEMA_VERSION,
  validateFieldLineageArtifact,
} from "../../scripts/reconcile/consumer/field-lineage/field-lineage-contract.ts";
import { reconcileMultiHop } from "../../scripts/reconcile/consumer/multi-hop/reconcile-multi-hop.ts";
import { reconcileOneHop } from "../../scripts/reconcile/consumer/one-hop/reconcile-one-hop.ts";
import {
  TARGET_TABLE_CAUSAL_CLOSURE_ARTIFACT_TYPE,
  TARGET_TABLE_CAUSAL_CLOSURE_SCHEMA_VERSION,
  canonicalizeTargetTableArtifact,
} from "../../scripts/reconcile/consumer/target-table-upstream-causal-closure/artifact-contract.ts";
import { buildCausalClosure } from "../../scripts/reconcile/consumer/target-table-upstream-causal-closure/causal-closure.ts";
import { relationSummaryKey } from "../../scripts/reconcile/consumer/target-table-upstream-causal-closure/task-relation-summary.ts";
import type { CandidateBranch } from "../../scripts/reconcile/consumer/target-field-causal-slice/candidate-universe.ts";
import { buildTableProducerIndex } from "../../scripts/reconcile/producer/producer-index.ts";
import { CURRENT_STAGE_EXPECTED } from "../fixtures/current-stage-baseline/expected.ts";
import {
  FIXED_TIME,
  PRODUCER_TABLE,
  PRODUCER_TASK_ID,
  ROOT_TABLE,
  ROOT_TASK_ID,
  SOURCE_TABLE,
  materializeCurrentStageFixture,
  type CurrentStageFixture,
} from "../fixtures/current-stage-baseline/lineage-stage-fixture.ts";

let fixtureRoot = "";
let fixture: CurrentStageFixture;
let machineFactsRun: InputPackMachineFactsRunResult;

beforeAll(() => {
  fixtureRoot = mkdtempSync(join(tmpdir(), "lineage-current-stage-baseline-"));
  fixture = materializeCurrentStageFixture(fixtureRoot);
  machineFactsRun = runInputPackMachineFacts({
    dataRoot: fixture.dataRoot,
    taskIds: [ROOT_TASK_ID, PRODUCER_TASK_ID],
    outputRoot: fixture.factsRoot,
    noWriterCatalog: true,
  });
});

afterAll(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
});

describe("current lineage stage baseline", () => {
  it("freezes canonical JSON, hash, and identity vectors", () => {
    const value = {
      tags: ["b", "a"],
      nested: { z: true, a: null },
      a: 1,
    };
    const datasetNodeId = physicalDatasetNodeId({
      platform: "hive",
      dataSource: "gfhive",
      qualifiedName: ROOT_TABLE,
    });

    expect(canonicalJson(value)).toBe(CURRENT_STAGE_EXPECTED.canonicalJson);
    expect(sha256(canonicalJson(value))).toBe(
      CURRENT_STAGE_EXPECTED.canonicalHash,
    );
    expect(taskNodeId(ROOT_TASK_ID)).toBe(CURRENT_STAGE_EXPECTED.ids.task);
    expect(datasetNodeId).toBe(CURRENT_STAGE_EXPECTED.ids.dataset);
    expect(
      fieldEvidencePhysicalFieldNodeId({
        platform: "hive",
        dataSource: "gfhive",
        stableTableId: `${ROOT_TABLE}__gfhive`,
        qualifiedName: ROOT_TABLE,
        column: "id",
      }),
    ).toBe(CURRENT_STAGE_EXPECTED.ids.field);
    expect(
      targetWriteNodeId({
        taskId: ROOT_TASK_ID,
        datasetNodeId,
        writeObservationId: "write-observation:100:0",
      }),
    ).toBe(CURRENT_STAGE_EXPECTED.ids.targetWrite);
    expect(
      readOccurrenceNodeId({
        consumerTaskId: ROOT_TASK_ID,
        occurrenceId: "task:100:statement:0:relation:read",
        readRelationId: "task:100:statement:0:relation:read",
      }),
    ).toBe(CURRENT_STAGE_EXPECTED.ids.readOccurrence);
  });

  it("builds current Machine Facts from the checked-in input fixture", () => {
    expect(
      machineFactsRun.tasks.map((task) => [task.task_id, task.status]),
    ).toEqual([
      [ROOT_TASK_ID, "CREATED"],
      [PRODUCER_TASK_ID, "CREATED"],
    ]);
    const manifest = JSON.parse(
      readFileSync(
        join(
          fixture.factsRoot,
          "registry",
          "tasks",
          ROOT_TASK_ID,
          "bundle",
          "manifest.json",
        ),
        "utf8",
      ),
    ) as {
      readonly schema_version: string;
      readonly counts: Readonly<Record<string, number>>;
    };
    expect(manifest.schema_version).toBe(MACHINE_FACTS_CONTRACT_VERSION);
    expect(manifest.counts).toMatchObject({
      statements: 1,
      dataset_io: 3,
      output_field_bindings: 2,
    });
  });

  it("freezes one-hop 1.1.0 and multi-hop 1.1.0 traversal", () => {
    const producerIndex = buildTableProducerIndex(fixture.dataRoot, {
      now: () => FIXED_TIME,
    });
    const oneHop = reconcileOneHop(ROOT_TASK_ID, {
      dataRoot: fixture.dataRoot,
      producerIndex,
      scheduleRows: [],
      scheduleEvidenceCacheRoot: null,
      now: () => FIXED_TIME,
    });
    expect(oneHop.schemaVersion).toBe("1.1.0");
    expect(
      oneHop.currentTask.directReads.map((read) => read.table.qualifiedName),
    ).toEqual([PRODUCER_TABLE]);
    expect(oneHop.nextDataTaskIds).toEqual([PRODUCER_TASK_ID]);
    expect(oneHop.coverage.semantics).toBe("OBSERVED_EVIDENCE_ONLY");
    expect(oneHop.coverage.directReadTables).toMatchObject({
      total: 1,
      identityResolved: 1,
      withConfirmedProducer: 1,
    });

    const multiHop = reconcileMultiHop(ROOT_TASK_ID, {
      dataRoot: fixture.dataRoot,
      producerIndex,
      rootOneHop: oneHop,
      scheduleEvidenceCacheRoot: null,
      maxDepth: 4,
      maxTasks: 10,
      maxEdges: 20,
      now: () => FIXED_TIME,
    });
    expect(multiHop.schemaVersion).toBe("1.1.0");
    expect(multiHop.artifactType).toBe("TABLE_MULTI_HOP_RECONCILIATION");
    expect(
      multiHop.producerBridges.map((bridge) => [
        bridge.consumerTaskId,
        bridge.table.qualifiedName,
        bridge.producerTaskId,
      ]),
    ).toEqual([[ROOT_TASK_ID, PRODUCER_TABLE, PRODUCER_TASK_ID]]);
    expect(multiHop.terminals).toEqual([
      expect.objectContaining({
        taskId: PRODUCER_TASK_ID,
        reason: "NO_CONFIRMED_PRODUCER_OBSERVED",
        table: expect.objectContaining({ qualifiedName: SOURCE_TABLE }),
      }),
    ]);
    expect(multiHop.limits.truncated).toBe(false);
  });

  it("freezes field-lineage 1.2.0 value and control evidence", () => {
    const producerIndex = buildTableProducerIndex(fixture.dataRoot, {
      now: () => FIXED_TIME,
    });
    const oneHop = reconcileOneHop(ROOT_TASK_ID, {
      dataRoot: fixture.dataRoot,
      producerIndex,
      scheduleRows: [],
      scheduleEvidenceCacheRoot: null,
      now: () => FIXED_TIME,
    });
    const multiHop = reconcileMultiHop(ROOT_TASK_ID, {
      dataRoot: fixture.dataRoot,
      producerIndex,
      rootOneHop: oneHop,
      scheduleEvidenceCacheRoot: null,
      maxDepth: 4,
      maxTasks: 10,
      maxEdges: 20,
      now: () => FIXED_TIME,
    });
    const fieldLineage = reconcileFieldLineage({
      dataRoot: fixture.dataRoot,
      factsRoot: fixture.factsRoot,
      tableLineage: multiHop,
      rootTaskId: ROOT_TASK_ID,
      rootTable: ROOT_TABLE,
      rootFields: ["id"],
      factsPolicy: "current-only",
      maxDepth: 4,
      maxStates: 20,
      maxPaths: 20,
      now: () => FIXED_TIME,
    });
    expect(fieldLineage.schemaVersion).toBe(FIELD_LINEAGE_SCHEMA_VERSION);
    expect(validateFieldLineageArtifact(fieldLineage)).toEqual([]);
    expect(fieldLineage.overallStatus).toBe("PARTIAL");
    expect(
      fieldLineage.edges.map((edge) => [
        edge.consumerTaskId,
        edge.producerTaskId,
        edge.kind,
      ]),
    ).toEqual([[ROOT_TASK_ID, null, "VALUE_FLOW"]]);
    expect(fieldLineage.candidates).toEqual([]);
    expect(fieldLineage.gaps.map((gap) => gap.reasonCode)).toEqual([
      "CROSS_TASK_BRIDGE_EVIDENCE_INCOMPLETE",
    ]);
    expect(
      fieldLineage.datasetControls.some(
        (control) => control.subtype === "FILTER",
      ),
    ).toBe(true);
  });

  it("freezes the current task-local 1.3.0 projection", () => {
    const taskLocal = projectTaskLocal({
      dataRoot: fixture.dataRoot,
      factsRoot: fixture.factsRoot,
      taskId: ROOT_TASK_ID,
      generatedAt: FIXED_TIME,
    });
    expect(taskLocal.schemaVersion).toBe(TASK_LOCAL_PROJECTION_SCHEMA_VERSION);
    expect(taskLocal.coverageStatus).toBe("PROJECTED");
    expect(taskLocal.nodes.map((node) => node.nodeType)).toEqual([
      "PHYSICAL_DATASET",
      "PHYSICAL_DATASET",
      "PHYSICAL_FIELD",
      "PHYSICAL_FIELD",
      "READ_OCCURRENCE",
      "TARGET_WRITE",
      "TASK",
    ]);
    expect(taskLocal.contentHash).toBe(
      taskLocalProjectionContentHash(taskLocal),
    );
    expect(() => validateTaskLocalProjection(taskLocal)).not.toThrow();
  });

  it("freezes target-causal 1.2.0 certainty and canonical publication", () => {
    const table = {
      platform: "hive",
      dataSource: "gfhive",
      qualifiedName: PRODUCER_TABLE,
      stableTableId: `${PRODUCER_TABLE}__gfhive`,
      identityStatus: "SCHEMA_BACKED",
    } as const;
    const readOccurrence = {
      occurrenceId: "task:100:statement:0:relation:read",
      readRelationId: "task:100:statement:0:relation:read",
      sqlSourceId: "task:100",
      statementIndex: 0,
      rootRelationId: "task:100:statement:0:relation:root",
      relationPath: [
        "task:100:statement:0:relation:root",
        "task:100:statement:0:relation:read",
      ],
    } as const;
    const rootBranch: CandidateBranch = {
      candidateBranchId: "branch:root",
      branchKind: "ROOT_WRITE",
      rootTaskId: ROOT_TASK_ID,
      consumerTaskId: null,
      producerTaskId: ROOT_TASK_ID,
      table: null,
      readOccurrence: null,
      writeObservationId: "write-observation:100:0",
      producerRole: "ROOT",
      writeScope: {
        sqlSourceId: "task:100",
        statementOrdinal: 0,
        rootRelationId: "task:100:statement:0:relation:root",
      },
      evidenceRefs: [],
      gapRefs: [],
      boundaryReason: null,
    };
    const producerBranch: CandidateBranch = {
      candidateBranchId: "branch:producer",
      branchKind: "PHYSICAL_PRODUCER",
      rootTaskId: ROOT_TASK_ID,
      consumerTaskId: ROOT_TASK_ID,
      producerTaskId: PRODUCER_TASK_ID,
      table,
      readOccurrence,
      writeObservationId: "write-observation:200:0",
      producerRole: "PRIMARY",
      writeScope: {
        sqlSourceId: "task:200",
        statementOrdinal: 0,
        rootRelationId: "task:200:statement:0:relation:root",
      },
      evidenceRefs: [],
      gapRefs: [],
      boundaryReason: null,
    };
    const universe = {
      rootTaskId: ROOT_TASK_ID,
      status: "COMPLETE_OBSERVED_EVIDENCE" as const,
      branches: [rootBranch, producerBranch],
      boundaryGapRefs: [],
      coverage: {
        sourceArtifactType: "TABLE_MULTI_HOP_RECONCILIATION",
        sourceCoverageStatus: "COMPLETE_OBSERVED_EVIDENCE",
        sourceCoverageSemantics: "OBSERVED_EVIDENCE_ONLY",
        sourceLimitsTruncated: false,
      },
    };
    const summary = {
      taskId: ROOT_TASK_ID,
      sqlSourceId: "task:100",
      statementIndex: 0,
      rootRelationId: "task:100:statement:0:relation:root",
      digest: "fixture:task-100",
      complete: true,
      readImpacts: [
        {
          readOccurrenceId: readOccurrence.occurrenceId,
          impactChannels: ["ROW_MEMBERSHIP" as const],
          evidenceRefs: ["fixture:root-filter"],
          gaps: [],
        },
      ],
      relationCount: 2,
      readCount: 1,
      edgeCount: 1,
      gaps: [],
    };
    const closure = buildCausalClosure({
      targetWriteId: "target-write:100:0",
      rootTaskId: ROOT_TASK_ID,
      universe,
      summaries: new Map([
        [
          relationSummaryKey(
            ROOT_TASK_ID,
            summary.sqlSourceId,
            summary.statementIndex,
            summary.rootRelationId,
          ),
          summary,
        ],
      ]),
      fieldValueProvider: {
        scanCount: 0,
        edgeCount: 0,
        lookup: (branch) => ({
          candidateBranchId: branch.candidateBranchId,
          status: "NOT_APPLICABLE" as const,
          affectedTargetFields: [],
          outputFieldBindingIds: [],
          evidenceRefs: [],
          gapRefs: [],
        }),
      },
      rootWriteScope: {
        taskId: ROOT_TASK_ID,
        writeObservationId: rootBranch.writeObservationId!,
        ...rootBranch.writeScope!,
      },
    });
    expect(
      closure.assessments.map((assessment) => [
        assessment.candidateBranchId,
        assessment.relationStatus,
      ]),
    ).toEqual([
      ["branch:root", "CONFIRMED_RELATED"],
      ["branch:producer", "CONFIRMED_RELATED"],
    ]);

    const artifact = canonicalizeTargetTableArtifact({
      schemaVersion: TARGET_TABLE_CAUSAL_CLOSURE_SCHEMA_VERSION,
      artifactType: TARGET_TABLE_CAUSAL_CLOSURE_ARTIFACT_TYPE,
      generatedAt: FIXED_TIME,
      targetWrite: {
        identity: {
          targetWriteId: "target-write:100:0",
          taskId: ROOT_TASK_ID,
          targetTableKey: ROOT_TABLE,
          sqlSourceId: "task:100",
          statementOrdinal: 0,
          taskWriteOrdinal: 0,
          rootRelationId: rootBranch.writeScope!.rootRelationId,
          writeObservationId: rootBranch.writeObservationId!,
          evidenceRefs: [],
        },
        snapshot: {
          inputPackFingerprint: "fixture:input-pack",
          machineFactsHash: "fixture:machine-facts",
          producerIndexHash: "fixture:producer-index",
          tableMultiHopHash: "fixture:multi-hop",
          semanticRuleVersion: "fixture:semantic-rules",
        },
      },
      candidateUniverse: universe,
      assessments: closure.assessments,
      taskRollup: closure.taskRollup,
      minimumCertainTaskIds: closure.minimumCertainTaskIds,
      conservativeSafetyTaskIds: closure.conservativeSafetyTaskIds,
      runtimeRerunDecision: "NOT_EVALUATED",
      relationSummaries: [
        {
          taskId: summary.taskId,
          sqlSourceId: summary.sqlSourceId,
          statementIndex: summary.statementIndex,
          rootRelationId: summary.rootRelationId,
          digest: summary.digest,
          complete: summary.complete,
          gapCount: summary.gaps.length,
        },
      ],
      metrics: {
        candidateBranchCount: universe.branches.length,
        assessmentCount: closure.assessments.length,
        upstreamTaskCount: 1,
        fieldValueEvidenceScanCount: 0,
        evidenceClosureRate: 1,
        decisionCoverage: { numerator: 2, denominator: 2, rate: 1 },
        bridgeStats: { resolved: 1, ambiguous: 0, missing: 0 },
        peakMemoryBytes: 0,
        continuationStats: {
          l1: 1,
          l2Assumed: 0,
          l2Unknown: 0,
          piOnly: 0,
          disjointPruned: 0,
          ambiguousReads: 0,
          unmatchedReads: 0,
        },
      },
      stages: [],
      gaps: closure.gaps,
    });
    expect(artifact.schemaVersion).toBe("1.2.0");
    expect(artifact.artifactType).toBe("TARGET_TABLE_UPSTREAM_CAUSAL_CLOSURE");
    expect(artifact.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });
});
