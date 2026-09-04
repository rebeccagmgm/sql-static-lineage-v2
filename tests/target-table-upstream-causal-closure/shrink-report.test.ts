import { describe, expect, it } from "vitest";

import {
  TARGET_TABLE_CAUSAL_CLOSURE_ARTIFACT_TYPE,
  TARGET_TABLE_CAUSAL_CLOSURE_SCHEMA_VERSION,
  canonicalAssessment,
  type ChannelAssessment,
  type ShrinkReport,
  type TargetTableAssessment,
  type TargetTableCausalClosureArtifact,
} from "../../scripts/reconcile/consumer/target-table-upstream-causal-closure/artifact-contract.ts";
import { formatTargetTableCausalSummary, renderTargetTableCausalHtml } from "../../scripts/reconcile/consumer/target-table-upstream-causal-closure/format-target-table-causal-closure.ts";
import { buildShrinkReport, classifyPrunedReason, unknownReasonCodesForAssessment } from "../../scripts/reconcile/consumer/target-table-upstream-causal-closure/static-assessment.ts";
import type { CandidateBranch } from "../../scripts/reconcile/consumer/target-field-causal-slice/candidate-universe.ts";
import type { ImpactChannel } from "../../scripts/reconcile/consumer/target-table-upstream-causal-closure/task-relation-summary.ts";

const table: NonNullable<CandidateBranch["table"]> = {
  platform: "hive",
  dataSource: "gfhive",
  qualifiedName: "db.source",
  stableTableId: "db.source__gfhive",
  identityStatus: "SCHEMA_BACKED",
};

const STABLE_PRUNED_REASONS = [
  "NO_PRODUCER_BRIDGE",
  "COVERAGE_BOUNDARY",
  "SCHEDULE_ONLY",
  "UNBOUND_READ",
  "BLOCKED_READ",
  "UNSUPPORTED_OPERATOR",
  "NO_CLOSED_PATH",
  "LEFT_DIM",
  "UNCLASSIFIED",
] as const;

function branch(overrides: Partial<CandidateBranch> = {}): CandidateBranch {
  return {
    candidateBranchId: "branch:p",
    branchKind: "PHYSICAL_PRODUCER",
    rootTaskId: "root",
    consumerTaskId: "c",
    producerTaskId: "p",
    table,
    readOccurrence: {
      occurrenceId: "task:c:statement:0:relation:read.b",
      readRelationId: "task:c:statement:0:relation:read.b",
      sqlSourceId: "task:c",
      statementIndex: 0,
      relationPath: ["task:c:statement:0:relation:join.left", "task:c:statement:0:relation:read.b"],
    },
    writeObservationId: "write:p",
    writeScope: { sqlSourceId: "p-source", statementOrdinal: 0, rootRelationId: "p-root" },
    producerRole: "PRIMARY",
    evidenceRefs: [],
    gapRefs: [],
    boundaryReason: null,
    ...overrides,
  };
}

function assessment(
  branchId: string,
  input: {
    readonly relationStatus?: TargetTableAssessment["relationStatus"];
    readonly channels?: readonly Partial<ChannelAssessment>[];
    readonly gapRefs?: readonly string[];
  } = {},
): TargetTableAssessment {
  const channels = (input.channels ?? []).map((channel) => ({
    channel: (channel.channel ?? "FIELD_VALUE") as ImpactChannel,
    status: channel.status ?? "UNKNOWN",
    proofRefs: channel.proofRefs ?? [],
    witnessRefs: channel.witnessRefs ?? [],
    gapRefs: channel.gapRefs ?? [],
    demandedFieldNames: channel.demandedFieldNames,
    affectedTargetFields: channel.affectedTargetFields,
  }));
  return canonicalAssessment({
    targetWriteId: "write",
    candidateBranchId: branchId,
    relationStatus: input.relationStatus ?? "UNKNOWN",
    channelAssessments: channels,
    evidenceRefs: [],
    gapRefs: input.gapRefs ?? [],
    negativeProofs: [],
  });
}

function confirmedValue(branchId: string, fields: readonly string[]): TargetTableAssessment {
  return assessment(branchId, {
    relationStatus: "CONFIRMED_RELATED",
    channels: [{ channel: "FIELD_VALUE", status: "CONFIRMED", demandedFieldNames: fields, proofRefs: [`value:${branchId}`] }],
  });
}

function confirmedMultiplicity(branchId: string, keys: readonly string[], witness: readonly string[]): TargetTableAssessment {
  return assessment(branchId, {
    relationStatus: "CONFIRMED_RELATED",
    channels: [{ channel: "MULTIPLICITY", status: "CONFIRMED", demandedFieldNames: keys, witnessRefs: witness }],
  });
}

function reasonMap(report: ShrinkReport): ReadonlyMap<string, { readonly count: number; readonly samples?: readonly { readonly taskId: string | null; readonly table: string | null }[] }> {
  return new Map(report.prunedReasons.map((item) => [item.reasonCode, item]));
}

describe("RS-4 pruned reasons and 档三 join-node grain", () => {
  it("classifies 档四 onto the stable reason set without leaking parse gaps", () => {
    const listed = branch({ candidateBranchId: "branch:listed", producerTaskId: "listed", table: { ...table, qualifiedName: "db.keep" } });
    const unbound = branch({
      candidateBranchId: "branch:unbound",
      branchKind: "UNBOUND_READ",
      producerTaskId: null,
      writeObservationId: null,
      writeScope: null,
      table: { ...table, qualifiedName: "db.unbound" },
    });
    const blocked = branch({
      candidateBranchId: "branch:blocked",
      branchKind: "BLOCKED_READ",
      producerTaskId: null,
      writeObservationId: null,
      writeScope: null,
      table: { ...table, qualifiedName: "db.blocked" },
    });
    const coverage = branch({
      candidateBranchId: "branch:coverage",
      branchKind: "COVERAGE_BOUNDARY",
      producerTaskId: null,
      writeObservationId: null,
      writeScope: null,
      table: { ...table, qualifiedName: "db.coverage" },
    });
    const schedule = branch({
      candidateBranchId: "branch:schedule",
      branchKind: "SCHEDULE_ONLY",
      producerTaskId: "sched",
      writeObservationId: null,
      writeScope: null,
      table: null,
    });
    const noBridge = branch({
      candidateBranchId: "branch:nobridge",
      producerTaskId: "orphan",
      writeObservationId: null,
      writeScope: null,
      table: { ...table, qualifiedName: "db.orphan" },
    });
    const unsupported = branch({
      candidateBranchId: "branch:unsupported",
      producerTaskId: "ops",
      table: { ...table, qualifiedName: "db.ops" },
    });
    const unclassified = branch({
      candidateBranchId: "branch:unclassified",
      producerTaskId: "144289",
      producerRole: "CANDIDATE",
      table: { ...table, qualifiedName: "dm_rsk_n.d_ref_trs" },
    });
    const report = buildShrinkReport({
      branches: [listed, unbound, blocked, coverage, schedule, noBridge, unsupported, unclassified],
      assessments: [
        confirmedValue("branch:listed", ["col"]),
        assessment("branch:unbound", { gapRefs: ["candidate-gap:UNBOUND_READ"] }),
        assessment("branch:blocked", { gapRefs: ["candidate-gap:BLOCKED_READ"] }),
        assessment("branch:coverage", { gapRefs: ["candidate-gap:COVERAGE_BOUNDARY"] }),
        assessment("branch:schedule", { gapRefs: ["candidate-gap:SCHEDULE_ONLY"] }),
        assessment("branch:nobridge", { gapRefs: ["producer-write-gap:WRITE_OBSERVATION"] }),
        assessment("branch:unsupported", { gapRefs: ["relation-summary-gap:ops:read:UNSUPPORTED_OPERATOR"] }),
        assessment("branch:unclassified", { gapRefs: ["causal-gap:branch:unclassified:NO_CLOSED_PATH", "summary-gap:PARSE_PARTIAL"] }),
      ],
    });
    const reasons = reasonMap(report);
    expect(report.prunedCount).toBe(7);
    expect(report.prunedReasons.map((item) => item.reasonCode).sort()).toEqual([
      "BLOCKED_READ",
      "COVERAGE_BOUNDARY",
      "NO_CLOSED_PATH",
      "NO_PRODUCER_BRIDGE",
      "SCHEDULE_ONLY",
      "UNBOUND_READ",
      "UNSUPPORTED_OPERATOR",
    ]);
    expect([...STABLE_PRUNED_REASONS]).toContain("NO_CLOSED_PATH");
    expect([...STABLE_PRUNED_REASONS]).toContain("LEFT_DIM");
    expect([...STABLE_PRUNED_REASONS]).toContain("UNCLASSIFIED");
    expect(reasons.get("UNBOUND_READ")?.count).toBe(1);
    expect(reasons.get("BLOCKED_READ")?.count).toBe(1);
    expect(reasons.get("COVERAGE_BOUNDARY")?.count).toBe(1);
    expect(reasons.get("SCHEDULE_ONLY")?.count).toBe(1);
    expect(reasons.get("NO_PRODUCER_BRIDGE")?.count).toBe(1);
    expect(reasons.get("UNSUPPORTED_OPERATOR")?.count).toBe(1);
    expect(reasons.get("NO_CLOSED_PATH")?.count).toBe(1);
    expect(reasons.get("NO_CLOSED_PATH")?.samples).toEqual([{ taskId: "144289", table: "dm_rsk_n.d_ref_trs" }]);
    expect(report.prunedReasons.some((item) => item.reasonCode === "PARSE_PARTIAL")).toBe(false);
  });

  it("maps TERMINAL and LEFT-dim gaps onto stable unknownReason codes", () => {
    const terminal = branch({
      candidateBranchId: "branch:terminal",
      branchKind: "COVERAGE_BOUNDARY",
      producerTaskId: null,
      writeObservationId: null,
      writeScope: null,
      table: { ...table, qualifiedName: "pdata_news_n.t02_scr_cd_rplc_info" },
      gapRefs: ["candidate-gap:181058:TERMINAL:abc"],
    });
    const leftDim = branch({
      candidateBranchId: "branch:left",
      producerTaskId: "105380",
      table: { ...table, qualifiedName: "pdata_n.t01_pty_clas_h" },
    });
    const leftAssessment = assessment("branch:left", {
      gapRefs: ["causal-closure-gap:branch:left:NO_CLOSED_PATH"],
      channels: [
        { channel: "FIELD_VALUE", status: "NOT_APPLICABLE" },
        { channel: "MULTIPLICITY", status: "UNKNOWN" },
      ],
    });
    expect(unknownReasonCodesForAssessment(terminal, assessment("branch:terminal"))).toEqual(["COVERAGE_BOUNDARY"]);
    expect(unknownReasonCodesForAssessment(leftDim, leftAssessment)).toEqual(["LEFT_DIM"]);
    expect(classifyPrunedReason(leftDim, leftAssessment)).toBe("LEFT_DIM");
  });

  it("merges 档一 by (task, table) without collapsing assessments", () => {
    const first = branch({ candidateBranchId: "branch:a0", producerTaskId: "119044", table: { ...table, qualifiedName: "pdata_n.t98" } });
    const second = branch({ candidateBranchId: "branch:a1", producerTaskId: "119044", table: { ...table, qualifiedName: "pdata_n.t98" } });
    const assessments = [confirmedValue("branch:a0", ["Book_Agt_Id"]), confirmedValue("branch:a1", ["stati_cont_desc"])];
    const report = buildShrinkReport({ branches: [first, second], assessments });
    expect(assessments).toHaveLength(2);
    expect(report.valueCertain).toEqual([
      expect.objectContaining({
        taskId: "119044",
        table: "pdata_n.t98",
        viaFields: ["Book_Agt_Id", "stati_cont_desc"],
      }),
    ]);
  });

  it("includes the ROOT_WRITE task itself in 档一", () => {
    const root = branch({
      candidateBranchId: "branch:root",
      branchKind: "ROOT_WRITE",
      producerTaskId: "181058",
      consumerTaskId: null,
      table: { ...table, qualifiedName: "dm_rsk_n.otc_opt_inr_comp_pal_sum" },
      readOccurrence: null,
      evidenceRefs: [{
        evidenceRefId: "root-write",
        source: "TARGET_WRITE",
        locator: "target-write:181058",
      }],
    });
    const upstream = branch({
      candidateBranchId: "branch:119044",
      producerTaskId: "119044",
      table: { ...table, qualifiedName: "pdata_n.t98" },
    });
    const report = buildShrinkReport({
      branches: [root, upstream],
      assessments: [confirmedValue("branch:119044", ["stati_cont_desc"])],
    });
    expect(report.valueCertain.map((entry) => entry.taskId)).toEqual(["119044", "181058"]);
    expect(report.valueCertain.find((entry) => entry.taskId === "181058")).toMatchObject({
      table: "dm_rsk_n.otc_opt_inr_comp_pal_sum",
      channel: "FIELD_VALUE",
      viaFields: [],
      witness: ["root-write"],
    });
  });

  it("keeps 档三 at (task, JOIN node) and does not split by column", () => {
    const joinA = "task:c:statement:0:relation:join.left";
    const joinB = "task:c:statement:0:relation:join.right";
    const sameJoinCol1 = branch({
      candidateBranchId: "branch:m1",
      producerTaskId: "105388",
      table: { ...table, qualifiedName: "pdata_n.t03_agt_rela_h" },
      readOccurrence: {
        occurrenceId: "task:c:statement:0:relation:read.rela",
        readRelationId: "task:c:statement:0:relation:read.rela",
        sqlSourceId: "task:c",
        statementIndex: 0,
        relationPath: [joinA, "task:c:statement:0:relation:read.rela"],
      },
    });
    const sameJoinCol2 = branch({
      ...sameJoinCol1,
      candidateBranchId: "branch:m2",
    });
    const otherJoin = branch({
      candidateBranchId: "branch:m3",
      producerTaskId: "105388",
      table: { ...table, qualifiedName: "pdata_n.t03_agt_rela_h" },
      readOccurrence: {
        occurrenceId: "task:c:statement:0:relation:read.rela2",
        readRelationId: "task:c:statement:0:relation:read.rela2",
        sqlSourceId: "task:c",
        statementIndex: 0,
        relationPath: [joinB, "task:c:statement:0:relation:read.rela2"],
      },
    });
    const report = buildShrinkReport({
      branches: [sameJoinCol1, sameJoinCol2, otherJoin],
      assessments: [
        confirmedMultiplicity("branch:m1", ["Book_Agt_Id"], ["join-key:Book_Agt_Id"]),
        confirmedMultiplicity("branch:m2", ["Agt_Id"], ["join-key:Agt_Id"]),
        confirmedMultiplicity("branch:m3", ["Pty_Id"], ["join-key:Pty_Id"]),
      ],
    });
    expect(report.multiplicityRisk.map((entry) => [entry.taskId, entry.joinNode, entry.viaFields])).toEqual([
      ["105388", joinA, ["Agt_Id", "Book_Agt_Id"]],
      ["105388", joinB, ["Pty_Id"]],
    ]);
  });
});

describe("RS-4 summary copy", () => {
  it("groups 档四 by reason with samples and folds 档三", () => {
    const report: ShrinkReport = {
      valueCertain: [{ taskId: "119044", table: "pdata_n.t98", channel: "FIELD_VALUE", viaFields: ["stati_cont_desc"], witness: ["v"] }],
      rowDetermining: [{ taskId: "163064", table: "dm_rsk_n.d_ref_fx_forward", channel: "ROW_MEMBERSHIP", viaFields: ["Agt_Modifr1"], witness: ["rm"] }],
      multiplicityRisk: [{
        taskId: "105388",
        table: "pdata_n.t03_agt_rela_h",
        channel: "MULTIPLICITY",
        viaFields: ["Book_Agt_Id"],
        witness: ["left-join-nullable"],
        joinNode: "task:176827:statement:0:relation:join.left",
      }],
      prunedCount: 3,
      prunedReasons: [
        { reasonCode: "UNBOUND_READ", count: 2, samples: [{ taskId: null, table: "db.unbound" }] },
        { reasonCode: "UNCLASSIFIED", count: 1, samples: [{ taskId: "144289", table: "dm_rsk_n.d_ref_trs" }] },
      ],
    };
    const artifact = stubArtifact(report, ["branch:unbound-a", "branch:unbound-b", "branch:unclassified"]);
    const summary = formatTargetTableCausalSummary(artifact);
    const html = renderTargetTableCausalHtml(artifact);
    expect(summary).toContain("档四 本轮证不出 / 未进入确定集");
    expect(summary).toContain("UNBOUND_READ 2");
    expect(summary).toContain("UNCLASSIFIED 1");
    expect(summary).toContain("144289");
    expect(summary).toContain("档三 倍增风险（默认折叠");
    expect(summary).toMatch(/JOIN .*join\.left/);
    expect(summary).not.toMatch(/无关|无影响|已剪除|只计数/);
    expect(html).toContain("本轮证不出");
    expect(html).toContain("档一 值必达");
    expect(html).toContain("含根");
    expect(html).toContain("根任务 + field-lineage");
    expect(html).toContain("档二 行决定");
    expect(html).toContain("FIELD_VALUE");
    expect(html).toContain("ROW_MEMBERSHIP");
    expect(html).toContain("<details");
    expect(html).toContain("write-observation-id");
    expect(html).not.toMatch(/无关|无影响|已剪除/);
    expect(html).not.toContain("branch:unbound-a");
  });
});

function stubArtifact(shrinkReport: ShrinkReport, branchIds: readonly string[]): TargetTableCausalClosureArtifact {
  return {
    schemaVersion: TARGET_TABLE_CAUSAL_CLOSURE_SCHEMA_VERSION,
    artifactType: TARGET_TABLE_CAUSAL_CLOSURE_ARTIFACT_TYPE,
    generatedAt: "2026-09-01T00:00:00.000Z",
    targetWrite: {
      identity: {
        targetWriteId: "write",
        taskId: "176827",
        targetTableKey: "dm_rsk_n.otc_opt_greek_val_det_h",
        sqlSourceId: "task:176827",
        statementOrdinal: 0,
        taskWriteOrdinal: 0,
        rootRelationId: "root",
        writeObservationId: "write:176827",
        evidenceRefs: [],
      },
      snapshot: {
        inputPackFingerprint: "i",
        machineFactsHash: "m",
        producerIndexHash: "p",
        tableMultiHopHash: "t",
        semanticRuleVersion: "v",
      },
    },
    candidateUniverse: {
      rootTaskId: "176827",
      status: "INCOMPLETE",
      branches: [],
      boundaryGapRefs: [],
      coverage: {
        sourceArtifactType: "test",
        sourceCoverageStatus: "INCOMPLETE",
        sourceCoverageSemantics: null,
        sourceLimitsTruncated: false,
      },
    },
    assessments: branchIds.map((candidateBranchId) => assessment(candidateBranchId)),
    shrinkReport,
    taskRollup: [],
    minimumCertainTaskIds: ["119044"],
    conservativeSafetyTaskIds: ["119044"],
    runtimeRerunDecision: "NOT_EVALUATED",
    relationSummaries: [],
    metrics: {
      candidateBranchCount: branchIds.length,
      assessmentCount: branchIds.length,
      upstreamTaskCount: 1,
      fieldValueEvidenceScanCount: 0,
      evidenceClosureRate: "NOT_APPLICABLE",
      decisionCoverage: { numerator: branchIds.length, denominator: branchIds.length, rate: 1 },
      bridgeStats: { resolved: 0, ambiguous: 0, missing: 0 },
      peakMemoryBytes: 0,
    },
    stages: [],
    gaps: [],
    contentHash: "hash",
  };
}
