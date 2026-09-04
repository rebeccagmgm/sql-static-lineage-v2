import { describe, expect, it } from "vitest";

import {
  projectCandidateUniverse,
} from "../../scripts/reconcile/consumer/target-field-causal-slice/candidate-universe.ts";
import type { RootCriterion } from "../../scripts/reconcile/consumer/target-field-causal-slice/write-scoped-plan-inputs.ts";

function criterion(
  targetFieldName: string,
  writeOrdinal: number,
): RootCriterion {
  const writeObservationId = `write:100:${writeOrdinal}`;
  return {
    rootCriterionId: `root-criterion:${writeObservationId}:${targetFieldName}`,
    rootTaskId: "100",
    targetTableKey: "hive|warehouse|demo.target",
    targetFieldName,
    rootTargetFieldId: `hive|warehouse|target-id|demo.target|${targetFieldName}`,
    targetFieldBindingId: `field:target:${targetFieldName}`,
    rootWriteObservationId: writeObservationId,
    writeKind: "INSERT",
    sqlSourceId: "sql:100",
    sqlSnapshot: "task-sql.sql",
    sqlSha256: "sha256",
    writeStatementId: `write-statement:${writeOrdinal}`,
    writeStatementIndex: writeOrdinal,
    statementId: `statement:${writeOrdinal}`,
    statementIndex: writeOrdinal,
    queryProducerStatementId: `query-statement:${writeOrdinal}`,
    rootRelationId: `relation:${writeOrdinal}`,
    outputExpressionId: `expression:${writeOrdinal}:${targetFieldName}`,
    outputBindingId: `binding:${writeOrdinal}:${targetFieldName}`,
    sourceOrdinal: 0,
    targetOrdinal: 0,
    producerOutputName: targetFieldName,
    expressionRole: "PROJECT_EXPRESSION",
    localRootRelationId: "root",
    localOutputExpressionId: "root:expression:project_expression:0",
    evidenceRefs: [writeObservationId],
  };
}

function artifact(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    artifactType: "TABLE_MULTI_HOP_RECONCILIATION",
    rootTaskId: "100",
    coverage: {
      semantics: "OBSERVED_EVIDENCE_ONLY",
      status: "COMPLETE_OBSERVED_EVIDENCE",
    },
    limits: { truncated: false },
    writeEdges: [
      {
        producerTaskId: "100",
        table: {
          platform: "hive",
          dataSource: "warehouse",
          qualifiedName: "demo.target",
          stableTableId: "target-id",
          identityStatus: "RESOLVED",
        },
        writes: [{ evidence: [{ source: "SQL_PARSE", locator: "#char=1-2" }] }],
      },
    ],
    producerBridges: [
      {
        consumerTaskId: "100",
        producerTaskId: "200",
        producerRole: "PRIMARY",
        table: {
          platform: "hive",
          dataSource: "warehouse",
          qualifiedName: "demo.mid",
          stableTableId: "mid-id",
          identityStatus: "RESOLVED",
        },
        readOccurrence: {
          occurrenceId: "read:100:0",
          readRelationId: "relation:100:0",
          statementIndex: 0,
          relationPath: ["relation:100:0"],
        },
      },
    ],
    readEdges: [
      {
        consumerTaskId: "100",
        table: {
          platform: "hive",
          dataSource: "warehouse",
          qualifiedName: "demo.mid",
          stableTableId: "mid-id",
          identityStatus: "RESOLVED",
        },
        recursionStatus: "ELIGIBLE",
        blockedStatementIndexes: [],
        blockReasons: [],
        readOccurrence: {
          occurrenceId: "read:100:0",
          readRelationId: "relation:100:0",
          statementIndex: 0,
          relationPath: ["relation:100:0"],
        },
        evidence: [{ source: "INPUT_PACK_SQL", locator: "read:100:0" }],
      },
    ],
    scheduleEdges: [
      {
        consumerTaskId: "100",
        producerTaskId: "300",
        evidence: [{ source: "HORAE_RELATION", locator: "schedule:100:300" }],
      },
    ],
    terminals: [],
    ...overrides,
  };
}

describe("candidate universe projection", () => {
  it("projects every table-artifact branch kind without rerunning producer selection", () => {
    const result = projectCandidateUniverse({
      rootTargetFields: ["target.amount"],
      tableArtifact: artifact({
        producerBridges: [],
        readEdges: [
          {
            consumerTaskId: "100",
            table: { qualifiedName: "demo.unbound", identityStatus: "RESOLVED" },
            recursionStatus: "ELIGIBLE",
            blockedStatementIndexes: [],
            blockReasons: [],
            evidence: [{ source: "INPUT_PACK_SQL", locator: "read:unbound" }],
          },
          {
            consumerTaskId: "100",
            table: { qualifiedName: "demo.blocked", identityStatus: "UNRESOLVED" },
            recursionStatus: "BLOCKED",
            blockedStatementIndexes: [0],
            blockReasons: ["TABLE_IDENTITY_UNRESOLVED"],
            evidence: [{ source: "SQL_PARSE", locator: "read:blocked" }],
          },
        ],
        terminals: [{ taskId: "100", depth: 1, reason: "MAX_DEPTH_REACHED" }],
        coverage: {
          semantics: "OBSERVED_EVIDENCE_ONLY",
          status: "PARTIAL_EVIDENCE",
        },
        limits: { truncated: true, truncationReason: "MAX_DEPTH_REACHED" },
      }),
    });

    expect(new Set(result.branches.map((branch) => branch.branchKind))).toEqual(
      new Set([
        "ROOT_WRITE",
        "SCHEDULE_ONLY",
        "UNBOUND_READ",
        "BLOCKED_READ",
        "COVERAGE_BOUNDARY",
      ]),
    );
    expect(result.status).toBe("INCOMPLETE");
    expect(result.boundaryGapRefs.length).toBeGreaterThan(0);
  });

  it("keeps occurrence branches stable when producerRole and evidence change", () => {
    const first = projectCandidateUniverse({
      rootTargetFields: ["target.amount"],
      tableArtifact: artifact(),
    });
    const changed = projectCandidateUniverse({
      rootTargetFields: ["target.amount"],
      tableArtifact: artifact({
        producerBridges: [
          {
            ...((artifact().producerBridges as unknown[])[0] as Record<string, unknown>),
            producerRole: "ADDITIONAL",
            evidence: [{ source: "OTHER", locator: "changed" }],
          },
        ],
      }),
    });
    const firstBranch = first.branches.find((branch) => branch.branchKind === "PHYSICAL_PRODUCER");
    const changedBranch = changed.branches.find((branch) => branch.branchKind === "PHYSICAL_PRODUCER");
    expect(firstBranch?.candidateBranchId).toBe(changedBranch?.candidateBranchId);
  });

  it("does not project UNBOUND_READ for a table-level readEdge that already has a producer bridge", () => {
    const base = artifact();
    const sourceRead = (base.readEdges as Record<string, unknown>[])[0]!;
    const { readOccurrence: _readOccurrence, ...tableLevelRead } = sourceRead;
    const result = projectCandidateUniverse({
      rootTargetFields: ["target.amount"],
      tableArtifact: artifact({ readEdges: [tableLevelRead] }),
    });

    expect(result.branches.some((branch) => branch.branchKind === "PHYSICAL_PRODUCER")).toBe(true);
    expect(result.branches.some((branch) => branch.branchKind === "UNBOUND_READ")).toBe(false);
    expect(result.status).toBe("COMPLETE_OBSERVED_EVIDENCE");
  });

  it("projects UNBOUND_READ only when no producer bridge exists for that consumer and table", () => {
    const base = artifact();
    const sourceRead = (base.readEdges as Record<string, unknown>[])[0]!;
    const { readOccurrence: _readOccurrence, ...tableLevelRead } = sourceRead;
    const result = projectCandidateUniverse({
      rootTargetFields: ["target.amount"],
      tableArtifact: artifact({
        producerBridges: [],
        readEdges: [tableLevelRead],
      }),
    });

    const unbound = result.branches.find((branch) => branch.branchKind === "UNBOUND_READ");
    expect(unbound?.readOccurrence).toBeNull();
    expect(unbound?.table?.qualifiedName).toBe("demo.mid");
    expect(unbound?.gapRefs).not.toHaveLength(0);
    expect(result.status).toBe("INCOMPLETE");
  });

  it("treats a readEdge with an unusable occurrence as table-level when a producer bridge exists", () => {
    const base = artifact();
    const sourceRead = (base.readEdges as Record<string, unknown>[])[0]!;
    const result = projectCandidateUniverse({
      rootTargetFields: ["target.amount"],
      tableArtifact: artifact({
        readEdges: [
          {
            ...sourceRead,
            readOccurrence: {
              occurrenceId: "read:100:0",
              readRelationId: "relation:100:0",
              statementIndex: 0,
              relationPath: [],
            },
          },
        ],
      }),
    });

    expect(result.branches.some((branch) => branch.branchKind === "PHYSICAL_PRODUCER")).toBe(true);
    expect(result.branches.some((branch) => branch.branchKind === "UNBOUND_READ")).toBe(false);
    expect(result.status).toBe("COMPLETE_OBSERVED_EVIDENCE");
  });

  it("does not project SCHEDULE_ONLY when a physical producer already covers the same consumer and producer", () => {
    const result = projectCandidateUniverse({
      rootTargetFields: ["target.amount"],
      tableArtifact: artifact({
        scheduleEdges: [
          {
            consumerTaskId: "100",
            producerTaskId: "200",
            evidence: [{ source: "HORAE_RELATION", locator: "schedule:100:200" }],
          },
        ],
      }),
    });

    expect(result.branches.filter((branch) => branch.branchKind === "PHYSICAL_PRODUCER").map((branch) => branch.producerTaskId)).toEqual(["200"]);
    expect(result.branches.some((branch) => branch.branchKind === "SCHEDULE_ONLY")).toBe(false);
  });

  it("does not project SCHEDULE_ONLY for checkdbflag producers", () => {
    const result = projectCandidateUniverse({
      rootTargetFields: ["target.amount"],
      tableArtifact: artifact({
        producerBridges: [],
        scheduleEdges: [
          {
            consumerTaskId: "100",
            producerTaskId: "149695",
            evidence: [{ source: "HORAE_RELATION", locator: "schedule:100:149695" }],
          },
        ],
        taskNodes: [
          {
            taskId: "149695",
            expansionStatus: "TERMINAL",
            evidence: [
              {
                source: "INPUT_PACK_TASK",
                locator: "tasks/checkdbflag/149695/task.json",
              },
            ],
          },
        ],
      }),
    });

    expect(result.branches.some((branch) => branch.producerTaskId === "149695")).toBe(false);
    expect(result.branches.some((branch) => branch.branchKind === "SCHEDULE_ONLY")).toBe(false);
  });

  it("does not project SCHEDULE_ONLY for checkdbflag producers that never got an Input Pack", () => {
    const result = projectCandidateUniverse({
      rootTargetFields: ["target.amount"],
      tableArtifact: artifact({
        producerBridges: [],
        scheduleEdges: [
          {
            consumerTaskId: "100",
            producerTaskId: "169692",
            evidence: [{ source: "HORAE_RELATION", locator: "schedule:100:169692" }],
          },
        ],
        taskNodes: [
          {
            taskId: "169692",
            expansionStatus: "TERMINAL",
            taskName: "checker.POS_OTC_POSITION_DAILY_ETL",
            evidence: [],
          },
        ],
      }),
    });

    expect(result.branches.some((branch) => branch.producerTaskId === "169692")).toBe(false);
    expect(result.branches.some((branch) => branch.branchKind === "SCHEDULE_ONLY")).toBe(false);
  });

  it("does not project COVERAGE_BOUNDARY for non-Hive terminal sources", () => {
    const result = projectCandidateUniverse({
      rootTargetFields: ["target.amount"],
      tableArtifact: artifact({
        producerBridges: [],
        terminals: [
          {
            taskId: "100",
            depth: 2,
            reason: "NO_CONFIRMED_PRODUCER_OBSERVED",
            table: {
              platform: "oracle",
              dataSource: "gforacle_gftzdb#gftzdb",
              qualifiedName: "titans_dm.ref_option_deal_pr",
              stableTableId: "titans-dm-ref",
              identityStatus: "RESOLVED",
            },
          },
        ],
      }),
    });

    expect(
      result.branches.some((branch) => branch.table?.qualifiedName === "titans_dm.ref_option_deal_pr"),
    ).toBe(false);
  });

  it("does not project UNBOUND_READ for non-Hive terminal sources", () => {
    const result = projectCandidateUniverse({
      rootTargetFields: ["target.amount"],
      tableArtifact: artifact({
        producerBridges: [],
        readEdges: [
          {
            consumerTaskId: "100",
            table: {
              platform: "oracle",
              dataSource: "gforacle_gftzdb#gftzdb",
              qualifiedName: "titans_dm.ref_option_deal_pr",
              stableTableId: "titans-dm-ref",
              identityStatus: "RESOLVED",
            },
            recursionStatus: "ELIGIBLE",
            blockedStatementIndexes: [],
            blockReasons: [],
            evidence: [{ source: "INPUT_PACK_SQL", locator: "read:100:oracle" }],
          },
        ],
      }),
    });

    expect(result.branches.some((branch) => branch.branchKind === "UNBOUND_READ")).toBe(false);
    expect(
      result.branches.some((branch) => branch.table?.qualifiedName === "titans_dm.ref_option_deal_pr"),
    ).toBe(false);
  });

  it("binds a read only when both sides have the same complete occurrence identity", () => {
    const result = projectCandidateUniverse({
      rootTargetFields: ["target.amount"],
      tableArtifact: artifact(),
    });

    expect(result.branches.some((branch) => branch.branchKind === "PHYSICAL_PRODUCER")).toBe(true);
    expect(result.branches.some((branch) => branch.branchKind === "UNBOUND_READ")).toBe(false);
    expect(result.status).toBe("COMPLETE_OBSERVED_EVIDENCE");
  });
});

describe("candidate universe root-write binding", () => {
  it("binds ROOT_WRITE branches to each criterion table instead of cross-producting write ids", () => {
    const rootCriteria = [criterion("amount", 0), criterion("amount", 1)];
    const result = projectCandidateUniverse({
      rootCriteria,
      tableArtifact: artifact({
        writeEdges: [{
          producerTaskId: "100",
          table: {
            platform: "hive",
            dataSource: "warehouse",
            qualifiedName: "demo.other",
            stableTableId: "other-id",
            identityStatus: "RESOLVED",
          },
          writes: [{
            evidence: [{ source: "SQL_PARSE", locator: "wrong-table" }],
          }],
        }],
      }),
    });
    const rootWrites = result.branches.filter(
      (branch) => branch.branchKind === "ROOT_WRITE",
    );

    expect(rootWrites).toHaveLength(2);
    expect(rootWrites.map((branch) => branch.writeObservationId).sort()).toEqual(
      rootCriteria.map((rootCriterion) => rootCriterion.rootWriteObservationId).sort(),
    );
    expect(rootWrites.every((branch) =>
      branch.table?.stableTableId === "target-id" &&
      branch.table.qualifiedName === "demo.target" &&
      branch.evidenceRefs.length === 0
    )).toBe(true);
  });
});
