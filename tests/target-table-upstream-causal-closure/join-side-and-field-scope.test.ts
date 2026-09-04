import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { buildCausalClosure } from "../../scripts/reconcile/consumer/target-table-upstream-causal-closure/causal-closure.ts";
import { assessBranch, buildShrinkReport, classifyPrunedReason } from "../../scripts/reconcile/consumer/target-table-upstream-causal-closure/static-assessment.ts";
import { relationSummaryKey, summarizeTaskRelations, type TaskRelationSummary } from "../../scripts/reconcile/consumer/target-table-upstream-causal-closure/task-relation-summary.ts";
import type { CandidateBranch } from "../../scripts/reconcile/consumer/target-field-causal-slice/candidate-universe.ts";

const table: NonNullable<CandidateBranch["table"]> = {
  platform: "hive",
  dataSource: "gfhive",
  qualifiedName: "db.source",
  stableTableId: "db.source__gfhive",
  identityStatus: "SCHEMA_BACKED",
};

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
      relationPath: ["root", "read.b"],
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

function summary(
  taskId: string,
  sqlSourceId: string,
  readImpacts: TaskRelationSummary["readImpacts"],
): TaskRelationSummary {
  return {
    taskId,
    sqlSourceId,
    statementIndex: 0,
    rootRelationId: "root-relation",
    digest: `${taskId}:${sqlSourceId}`,
    complete: true,
    readImpacts,
    relationCount: readImpacts.length,
    readCount: readImpacts.length,
    edgeCount: 0,
    gaps: [],
  };
}

function namedTable(qualifiedName: string): NonNullable<CandidateBranch["table"]> {
  return {
    ...table,
    qualifiedName,
    stableTableId: `${qualifiedName}__gfhive`,
  };
}

function noFieldEvidenceProvider() {
  return {
    scanCount: 0,
    edgeCount: 0,
    lookup: (value: CandidateBranch) => ({
      candidateBranchId: value.candidateBranchId,
      status: "NOT_APPLICABLE" as const,
      affectedTargetFields: [],
      outputFieldBindingIds: [],
      evidenceRefs: [],
      gapRefs: [],
    }),
  };
}

function fieldProvider(fieldsByTask: Readonly<Record<string, readonly string[]>>) {
  return {
    scanCount: 1,
    edgeCount: 1,
    lookup: (value: CandidateBranch) => {
      const fields = value.producerTaskId ? fieldsByTask[value.producerTaskId] : undefined;
      return fields
        ? {
            candidateBranchId: value.candidateBranchId,
            status: "CONFIRMED" as const,
            affectedTargetFields: [...fields],
            outputFieldBindingIds: fields.map((field) => `binding:${field}`),
            evidenceRefs: [`value:${value.producerTaskId}`],
            gapRefs: [],
          }
        : {
            candidateBranchId: value.candidateBranchId,
            status: "NOT_APPLICABLE" as const,
            affectedTargetFields: [],
            outputFieldBindingIds: [],
            evidenceRefs: [],
            gapRefs: [],
          };
    },
  };
}

function loadRelationFixture(name: string): {
  readonly nodes: readonly Record<string, unknown>[];
  readonly edges: readonly { readonly from_relation_id: string; readonly to_relation_id: string }[];
} {
  return JSON.parse(readFileSync(resolve(`tests/fixtures/target-table-upstream-causal-closure/${name}`), "utf8")) as {
    readonly nodes: readonly Record<string, unknown>[];
    readonly edges: readonly { readonly from_relation_id: string; readonly to_relation_id: string }[];
  };
}

function completeUniverse(branches: readonly CandidateBranch[]) {
  return {
    rootTaskId: "root",
    status: "COMPLETE_OBSERVED_EVIDENCE" as const,
    branches,
    boundaryGapRefs: [],
    coverage: {
      sourceArtifactType: "test",
      sourceCoverageStatus: "COMPLETE_OBSERVED_EVIDENCE",
      sourceCoverageSemantics: null,
      sourceLimitsTruncated: false,
    },
  };
}

function col(name: string, tableName: string) {
  return { name, physical: [{ column: name, table: tableName }], resolution: "PHYSICAL" };
}

function readRow(id: string, tableName: string) {
  return {
    task_id: "c",
    relation_id: `task:c:statement:0:relation:${id}`,
    relation_type: "read",
    relation: { id: `task:c:statement:0:relation:${id}`, type: "read", table: tableName },
  };
}

describe("JOIN/FILTER side and zipper-key rules (P0 5.1)", () => {
  it("assigns LEFT JOIN preserved side to ROW_MEMBERSHIP and nullable side to MULTIPLICITY only", () => {
    const left = readRow("read.a", "db.trade");
    const right = readRow("read.b", "db.ref");
    const join = {
      task_id: "c",
      relation_id: "task:c:statement:0:relation:join",
      relation_type: "join",
      relation: {
        id: "task:c:statement:0:relation:join",
        type: "join",
        join_type: "LEFT",
        left: left.relation_id,
        right: right.relation_id,
        condition_expr: "a.id = b.id",
        condition_columns: [col("id", "db.trade"), col("id", "db.ref")],
        output_columns: [col("amount", "db.trade"), col("ref_name", "db.ref")],
      },
    };
    const summaryResult = summarizeTaskRelations({
      taskId: "c",
      sqlSourceId: "task:c",
      relationRecords: [left, right, join],
      relationEdgeRecords: [
        { from_relation_id: left.relation_id, to_relation_id: join.relation_id },
        { from_relation_id: right.relation_id, to_relation_id: join.relation_id },
      ],
    });
    const byId = Object.fromEntries(
      summaryResult.readImpacts.map((impact) => [impact.readOccurrenceId, impact]),
    );
    expect(byId[left.relation_id]?.impactChannels).toEqual(
      expect.arrayContaining(["ROW_MEMBERSHIP", "RELATION_EXISTENCE"]),
    );
    expect(byId[left.relation_id]?.impactChannels).not.toContain("MULTIPLICITY");
    expect(byId[right.relation_id]?.impactChannels).toEqual(
      expect.arrayContaining(["MULTIPLICITY", "RELATION_EXISTENCE"]),
    );
    expect(byId[right.relation_id]?.impactChannels).not.toContain("ROW_MEMBERSHIP");
    expect(byId[right.relation_id]?.impactChannels).not.toContain("FIELD_VALUE");
    expect(byId[left.relation_id]?.demandedFieldNames).toEqual(["id"]);
    expect(byId[right.relation_id]?.demandedFieldNames).toEqual(["id"]);
    expect(byId[right.relation_id]?.demandedFieldNames).not.toContain("ref_name");
    expect(byId[left.relation_id]?.evidenceRefs).toContain("machine-facts:c:relation:task:c:statement:0:relation:join");
    expect(byId[right.relation_id]?.evidenceRefs).toContain("machine-facts:c:relation:task:c:statement:0:relation:join");
  });

  it("assigns INNER JOIN both sides to ROW_MEMBERSHIP and MULTIPLICITY", () => {
    const left = readRow("read.a", "db.trade");
    const right = readRow("read.b", "db.ref");
    const join = {
      task_id: "c",
      relation_id: "task:c:statement:0:relation:join",
      relation_type: "join",
      relation: {
        id: "task:c:statement:0:relation:join",
        type: "join",
        join_type: "INNER",
        left: left.relation_id,
        right: right.relation_id,
        condition_columns: [col("id", "db.trade"), col("id", "db.ref")],
      },
    };
    const summaryResult = summarizeTaskRelations({
      taskId: "c",
      sqlSourceId: "task:c",
      relationRecords: [left, right, join],
      relationEdgeRecords: [
        { from_relation_id: left.relation_id, to_relation_id: join.relation_id },
        { from_relation_id: right.relation_id, to_relation_id: join.relation_id },
      ],
    });
    for (const impact of summaryResult.readImpacts) {
      expect(impact.impactChannels).toEqual(
        expect.arrayContaining(["ROW_MEMBERSHIP", "MULTIPLICITY"]),
      );
    }
  });

  it("limits FILTER demanded fields to predicate columns, not projection columns", () => {
    const read = readRow("read.a", "db.hist");
    const filter = {
      task_id: "c",
      relation_id: "task:c:statement:0:relation:filter",
      relation_type: "filter",
      relation: {
        id: "task:c:statement:0:relation:filter",
        type: "filter",
        predicate_expr: "STRT_DATE <= '2026-06-11' AND END_DATE > '2026-06-11'",
        predicate_columns: [col("STRT_DATE", "db.hist"), col("END_DATE", "db.hist")],
        output_columns: [col("Stati_Cont_Desc", "db.hist"), col("Agt_Modifr", "db.hist")],
      },
    };
    const summaryResult = summarizeTaskRelations({
      taskId: "c",
      sqlSourceId: "task:c",
      relationRecords: [read, filter],
      relationEdgeRecords: [
        { from_relation_id: read.relation_id, to_relation_id: filter.relation_id },
      ],
    });
    expect(summaryResult.readImpacts[0]?.impactChannels).toContain("ROW_MEMBERSHIP");
    expect(summaryResult.readImpacts[0]?.demandedFieldNames).toEqual(["END_DATE", "STRT_DATE"]);
    expect(summaryResult.readImpacts[0]?.demandedFieldNames).not.toContain("Stati_Cont_Desc");
  });

  it("does not stamp generic CASE EXPRESSION_CONTROL onto LEFT-join subquery reads", () => {
    const driver = readRow("read.driver", "odata_n_tit.d_ref_otc_option_deal");
    const dim = readRow("read.deal_pr", "odata_n_tit.d_ref_option_deal_pr");
    const filter = {
      task_id: "c",
      relation_id: "task:c:statement:0:relation:filter.deal_pr",
      relation_type: "filter",
      relation: {
        id: "task:c:statement:0:relation:filter.deal_pr",
        type: "filter",
        predicate_expr: "BUSI_DATE='2026-06-11' AND SEQ='0'",
        predicate_columns: [col("BUSI_DATE", "odata_n_tit.d_ref_option_deal_pr"), col("SEQ", "odata_n_tit.d_ref_option_deal_pr")],
      },
    };
    const join = {
      task_id: "c",
      relation_id: "task:c:statement:0:relation:join.left",
      relation_type: "join",
      relation: {
        id: "task:c:statement:0:relation:join.left",
        type: "join",
        join_type: "LEFT",
        left: driver.relation_id,
        right: filter.relation_id,
        condition_expr: "driver.KEY_OTC_TRADE_ID = deal_pr.KEY_OTC_TRADE_ID",
        condition_columns: [
          col("KEY_OTC_TRADE_ID", "odata_n_tit.d_ref_otc_option_deal"),
          col("KEY_OTC_TRADE_ID", "odata_n_tit.d_ref_option_deal_pr"),
        ],
      },
    };
    const project = {
      task_id: "c",
      relation_id: "task:c:statement:0:relation:root.project",
      relation_type: "project",
      relation: {
        id: "task:c:statement:0:relation:root.project",
        type: "project",
        source: join.relation_id,
        expression: "CASE WHEN IS_ANNUALIZED = 'Y' THEN '1' ELSE '0' END",
      },
      source_text: "CASE WHEN IS_ANNUALIZED = 'Y' THEN '1' ELSE '0' END",
    };
    const summaryResult = summarizeTaskRelations({
      taskId: "c",
      sqlSourceId: "task:c",
      relationRecords: [driver, dim, filter, join, project],
      relationEdgeRecords: [
        { from_relation_id: dim.relation_id, to_relation_id: filter.relation_id },
        { from_relation_id: driver.relation_id, to_relation_id: join.relation_id },
        { from_relation_id: filter.relation_id, to_relation_id: join.relation_id },
        { from_relation_id: join.relation_id, to_relation_id: project.relation_id },
      ],
    });
    const dimImpact = summaryResult.readImpacts.find((item) => item.readOccurrenceId.includes("read.deal_pr"));
    expect(dimImpact?.impactChannels).toContain("MULTIPLICITY");
    expect(dimImpact?.impactChannels).toContain("ROW_MEMBERSHIP");
    expect(dimImpact?.impactChannels).not.toContain("EXPRESSION_CONTROL");
  });
});

describe("partial output fields must not spread (P0 3.4)", () => {
  it("does not continue ROW_MEMBERSHIP through a value port that supplies a different output field", () => {
    const root = branch({
      branchKind: "ROOT_WRITE",
      candidateBranchId: "branch:root",
      consumerTaskId: null,
      producerTaskId: "root",
      table: null,
      readOccurrence: null,
      writeObservationId: "write:root:0",
    });
    const producer = branch({
      candidateBranchId: "branch:ref",
      consumerTaskId: "root",
      producerTaskId: "ref",
      readOccurrence: {
        occurrenceId: "root-read-ref",
        readRelationId: "root-read-ref",
        sqlSourceId: "root-source",
        statementIndex: 0,
        relationPath: ["root-relation", "root-read-ref"],
        rootRelationId: "root-relation",
      },
      writeObservationId: "write:ref",
      writeScope: { sqlSourceId: "ref-source", statementOrdinal: 0, rootRelationId: "ref-root" },
    });
    const provider = {
      scanCount: 1,
      edgeCount: 1,
      lookup: (value: CandidateBranch) =>
        value.candidateBranchId === "branch:ref"
          ? {
              candidateBranchId: value.candidateBranchId,
              status: "CONFIRMED" as const,
              affectedTargetFields: ["Stati_Cont_Desc"],
              outputFieldBindingIds: ["binding:desc"],
              evidenceRefs: ["value-desc"],
              gapRefs: [],
            }
          : {
              candidateBranchId: value.candidateBranchId,
              status: "NOT_APPLICABLE" as const,
              affectedTargetFields: [],
              outputFieldBindingIds: [],
              evidenceRefs: [],
              gapRefs: [],
            },
    };
    const result = buildCausalClosure({
      targetWriteId: "write:target",
      rootTaskId: "root",
      universe: completeUniverse([root, producer]),
      summaries: new Map([
        [
          relationSummaryKey("root", "root-source", 0, "root-relation"),
          {
            ...summary("root", "root-source", [
              {
                readOccurrenceId: "root-read-ref",
                impactChannels: [],
                demandedFieldNames: ["Agt_Modifr"],
                evidenceRefs: ["zipper-modifr"],
                gaps: [],
              },
            ]),
            rootRelationId: "root-relation",
          },
        ],
      ]),
      fieldValueProvider: provider,
      rootWriteScope: {
        taskId: "root",
        writeObservationId: "write:root:0",
        sqlSourceId: "root-source",
        statementOrdinal: 0,
        rootRelationId: "root-relation",
      },
    });
    const assessment = result.assessments.find((item) => item.candidateBranchId === "branch:ref");
    expect(assessment?.channelAssessments.find((item) => item.channel === "ROW_MEMBERSHIP")?.status).not.toBe(
      "CONFIRMED",
    );
    expect(assessment?.channelAssessments.find((item) => item.channel === "FIELD_VALUE")?.affectedTargetFields).toEqual(
      ["Stati_Cont_Desc"],
    );
  });
});

describe("105387 zipper gold (P0)", () => {
  const fixture = JSON.parse(
    readFileSync(
      resolve("tests/fixtures/target-table-upstream-causal-closure/105387-zipper-relations.json"),
      "utf8",
    ),
  ) as {
    readonly nodes: readonly Record<string, unknown>[];
    readonly edges: readonly { readonly from_relation_id: string; readonly to_relation_id: string }[];
  };

  it("assigns LEFT JOIN nullable reference tables to MULTIPLICITY and FILTER channels, not project CASE", () => {
    const summaryResult = summarizeTaskRelations({
      taskId: "105387",
      sqlSourceId: "task:105387",
      statementIndex: 1,
      relationRecords: fixture.nodes,
      relationEdgeRecords: fixture.edges,
    });
    const refs = [
      "d_ref_trs",
      "d_ref_otc_option_deal",
      "d_ref_fx_forward",
      "d_ref_fast_trs",
    ];
    for (const name of refs) {
      const impact = summaryResult.readImpacts.find((item) =>
        item.readOccurrenceId.toLowerCase().includes(name),
      );
      expect(impact, name).toBeDefined();
      expect(impact?.impactChannels, name).toEqual(
        expect.arrayContaining(["MULTIPLICITY", "RELATION_EXISTENCE"]),
      );
      expect(impact?.impactChannels, name).not.toContain("EXPRESSION_CONTROL");
      const demanded = impact?.demandedFieldNames?.map((field) => field.toLowerCase()) ?? [];
      expect(demanded, name).toContain("key_otc_trade_id");
      expect(demanded, name).not.toContain("agt_modifr1");
      expect(
        impact?.evidenceRefs.some((ref) => ref.includes("statement:1:relation:root.project")),
        name,
      ).toBe(false);
    }
    const trade = summaryResult.readImpacts.find((item) =>
      item.readOccurrenceId.toLowerCase().includes("d_trd_otc_trade"),
    );
    expect(trade?.impactChannels).toContain("ROW_MEMBERSHIP");
    expect(trade?.impactChannels).not.toContain("EXPRESSION_CONTROL");
  });

  it("demands Agt_Modifr as the zipper match key and STRT_DATE/END_DATE as the version filter", () => {
    const summaryResult = summarizeTaskRelations({
      taskId: "105387",
      sqlSourceId: "task:105387",
      statementIndex: 2,
      relationRecords: fixture.nodes,
      relationEdgeRecords: fixture.edges,
    });
    const hist = summaryResult.readImpacts.find((item) =>
      item.readOccurrenceId.toLowerCase().includes("t03_agt_stati_info_h") &&
      !item.readOccurrenceId.toLowerCase().includes("temp"),
    );
    expect(hist?.impactChannels).toContain("ROW_MEMBERSHIP");
    expect(hist?.demandedFieldNames?.map((name) => name.toLowerCase())).toEqual(
      expect.arrayContaining(["agt_modifr", "strt_date", "end_date"]),
    );
  });
});

describe("RS-3 closure seeding", () => {
  it("keeps 105387 in 档一 and does not promote LEFT JOIN ref producers to 档二 via project CASE", () => {
    const fixture = loadRelationFixture("105387-zipper-relations.json");
    const zipperRoot = "task:105387:statement:1:relation:root.project";
    const zipper = summarizeTaskRelations({
      taskId: "105387",
      sqlSourceId: "task:105387",
      statementIndex: 1,
      rootRelationId: zipperRoot,
      relationRecords: fixture.nodes,
      relationEdgeRecords: fixture.edges,
    });
    const refs = [
      { name: "d_ref_trs", taskId: "78473", table: "odata_n_tit.d_ref_trs" },
      { name: "d_ref_otc_option_deal", taskId: "78472", table: "odata_n_tit.d_ref_otc_option_deal" },
      { name: "d_ref_fx_forward", taskId: "163064", table: "odata_n_tit.d_ref_fx_forward" },
      { name: "d_ref_fast_trs", taskId: "179886", table: "odata_n_tit.d_ref_fast_trs" },
    ];
    const root = branch({
      branchKind: "ROOT_WRITE",
      candidateBranchId: "branch:root",
      consumerTaskId: null,
      producerTaskId: "root",
      table: null,
      readOccurrence: null,
      writeObservationId: "write:root:0",
    });
    const zipperProducer = branch({
      candidateBranchId: "branch:105387",
      consumerTaskId: "root",
      producerTaskId: "105387",
      table: namedTable("pdata_n.t03_agt_stati_info_h"),
      readOccurrence: {
        occurrenceId: "root-read-zipper",
        readRelationId: "root-read-zipper",
        sqlSourceId: "root-source",
        statementIndex: 0,
        relationPath: ["root-relation", "root-read-zipper"],
        rootRelationId: "root-relation",
      },
      writeObservationId: "write:105387",
      writeScope: { sqlSourceId: "task:105387", statementOrdinal: 1, rootRelationId: zipperRoot },
    });
    const refBranches = refs.map((ref) => {
      const impact = zipper.readImpacts.find((item) => item.readOccurrenceId.toLowerCase().includes(ref.name));
      const occurrenceId = impact?.readOccurrenceId ?? `task:105387:statement:1:relation:root.b.read.${ref.name}`;
      return branch({
        candidateBranchId: `branch:${ref.taskId}`,
        consumerTaskId: "105387",
        producerTaskId: ref.taskId,
        table: namedTable(ref.table),
        readOccurrence: {
          occurrenceId,
          readRelationId: occurrenceId,
          sqlSourceId: "task:105387",
          statementIndex: 1,
          relationPath: [zipperRoot, occurrenceId],
          rootRelationId: zipperRoot,
        },
        writeObservationId: `write:${ref.taskId}`,
        writeScope: { sqlSourceId: `task:${ref.taskId}`, statementOrdinal: 0, rootRelationId: `task:${ref.taskId}:root` },
      });
    });
    const branches = [root, zipperProducer, ...refBranches];
    const result = buildCausalClosure({
      targetWriteId: "write:target",
      rootTaskId: "root",
      universe: completeUniverse(branches),
      summaries: new Map([
        [
          relationSummaryKey("root", "root-source", 0, "root-relation"),
          {
            ...summary("root", "root-source", [
              {
                readOccurrenceId: "root-read-zipper",
                impactChannels: [],
                demandedFieldNames: [],
                evidenceRefs: ["root-read-zipper"],
                gaps: [],
              },
            ]),
            rootRelationId: "root-relation",
          },
        ],
        [relationSummaryKey("105387", "task:105387", 1, zipperRoot), zipper],
      ]),
      fieldValueProvider: fieldProvider({ "105387": ["Stati_Cont_Desc"] }),
      rootWriteScope: {
        taskId: "root",
        writeObservationId: "write:root:0",
        sqlSourceId: "root-source",
        statementOrdinal: 0,
        rootRelationId: "root-relation",
      },
    });
    const report = buildShrinkReport({ branches, assessments: result.assessments });
    expect(report.valueCertain.map((entry) => entry.taskId)).toEqual(["105387", "root"]);
    expect(report.rowDetermining.map((entry) => entry.taskId)).toEqual([]);
    expect(report.multiplicityRisk.map((entry) => entry.taskId).sort()).toEqual(
      ["163064", "179886", "78472", "78473"].sort(),
    );
  });

  it("does not promote LEFT JOIN ref producers to 档二 through an intermediate FIELD_VALUE hop", () => {
    const fixture = loadRelationFixture("105387-zipper-relations.json");
    const zipperRoot = "task:105387:statement:1:relation:root.project";
    const zipper = summarizeTaskRelations({
      taskId: "105387",
      sqlSourceId: "task:105387",
      statementIndex: 1,
      rootRelationId: zipperRoot,
      relationRecords: fixture.nodes,
      relationEdgeRecords: fixture.edges,
    });
    const refs = [
      { name: "d_ref_trs", taskId: "78473", table: "odata_n_tit.d_ref_trs" },
      { name: "d_ref_otc_option_deal", taskId: "78472", table: "odata_n_tit.d_ref_otc_option_deal" },
      { name: "d_ref_fx_forward", taskId: "163064", table: "odata_n_tit.d_ref_fx_forward" },
      { name: "d_ref_fast_trs", taskId: "179886", table: "odata_n_tit.d_ref_fast_trs" },
    ];
    const root = branch({
      branchKind: "ROOT_WRITE",
      candidateBranchId: "branch:root",
      consumerTaskId: null,
      producerTaskId: "176827",
      table: null,
      readOccurrence: null,
      writeObservationId: "write:root:0",
    });
    const mid = branch({
      candidateBranchId: "branch:119044",
      consumerTaskId: "176827",
      producerTaskId: "119044",
      table: namedTable("pdata_n.t98_sb_otc_opt_comp_info"),
      readOccurrence: {
        occurrenceId: "root-read-119044",
        readRelationId: "root-read-119044",
        sqlSourceId: "root-source",
        statementIndex: 0,
        relationPath: ["root-relation", "root-read-119044"],
        rootRelationId: "root-relation",
      },
      writeObservationId: "write:119044",
      writeScope: { sqlSourceId: "mid-source", statementOrdinal: 0, rootRelationId: "mid-root" },
    });
    const zipperProducer = branch({
      candidateBranchId: "branch:105387",
      consumerTaskId: "119044",
      producerTaskId: "105387",
      table: namedTable("pdata_n.t03_agt_stati_info_h"),
      readOccurrence: {
        occurrenceId: "mid-read-zipper",
        readRelationId: "mid-read-zipper",
        sqlSourceId: "mid-source",
        statementIndex: 0,
        relationPath: ["mid-root", "mid-read-zipper"],
        rootRelationId: "mid-root",
      },
      writeObservationId: "write:105387",
      writeScope: { sqlSourceId: "task:105387", statementOrdinal: 1, rootRelationId: zipperRoot },
    });
    const refBranches = refs.map((ref) => {
      const impact = zipper.readImpacts.find((item) => item.readOccurrenceId.toLowerCase().includes(ref.name));
      const occurrenceId = impact?.readOccurrenceId ?? `task:105387:statement:1:relation:root.b.read.${ref.name}`;
      return branch({
        candidateBranchId: `branch:${ref.taskId}`,
        consumerTaskId: "105387",
        producerTaskId: ref.taskId,
        table: namedTable(ref.table),
        readOccurrence: {
          occurrenceId,
          readRelationId: occurrenceId,
          sqlSourceId: "task:105387",
          statementIndex: 1,
          relationPath: [zipperRoot, occurrenceId],
          rootRelationId: zipperRoot,
        },
        writeObservationId: `write:${ref.taskId}`,
        writeScope: { sqlSourceId: `task:${ref.taskId}`, statementOrdinal: 0, rootRelationId: `task:${ref.taskId}:root` },
      });
    });
    const branches = [root, mid, zipperProducer, ...refBranches];
    const result = buildCausalClosure({
      targetWriteId: "write:target",
      rootTaskId: "176827",
      universe: completeUniverse(branches),
      summaries: new Map([
        [
          relationSummaryKey("176827", "root-source", 0, "root-relation"),
          {
            ...summary("176827", "root-source", [
              {
                readOccurrenceId: "root-read-119044",
                impactChannels: [],
                demandedFieldNames: [],
                evidenceRefs: ["root-read-119044"],
                gaps: [],
              },
            ]),
            rootRelationId: "root-relation",
          },
        ],
        [
          relationSummaryKey("119044", "mid-source", 0, "mid-root"),
          {
            ...summary("119044", "mid-source", [
              {
                readOccurrenceId: "mid-read-zipper",
                impactChannels: [],
                demandedFieldNames: [],
                evidenceRefs: ["mid-read-zipper"],
                gaps: [],
              },
            ]),
            sqlSourceId: "mid-source",
            rootRelationId: "mid-root",
          },
        ],
        [relationSummaryKey("105387", "task:105387", 1, zipperRoot), zipper],
      ]),
      fieldValueProvider: fieldProvider({
        "119044": ["inr_ord_id"],
        "105387": ["Stati_Cont_Desc"],
      }),
      rootWriteScope: {
        taskId: "176827",
        writeObservationId: "write:root:0",
        sqlSourceId: "root-source",
        statementOrdinal: 0,
        rootRelationId: "root-relation",
      },
    });
    const report = buildShrinkReport({ branches, assessments: result.assessments });
    expect(report.valueCertain.map((entry) => entry.taskId).sort()).toEqual(["105387", "119044", "176827"]);
    expect(report.rowDetermining.map((entry) => entry.taskId)).toEqual([]);
    expect(report.multiplicityRisk.map((entry) => entry.taskId).sort()).toEqual(
      ["163064", "179886", "78472", "78473"].sort(),
    );
  });

  it("keeps generic-CASE LEFT dims out of 档二 after a FIELD_VALUE hop", () => {
    const driver = readRow("read.driver", "odata_n_tit.d_ref_otc_option_deal");
    const dim = readRow("read.deal_pr", "odata_n_tit.d_ref_option_deal_pr");
    const filter = {
      task_id: "c",
      relation_id: "task:c:statement:0:relation:filter.deal_pr",
      relation_type: "filter",
      relation: {
        id: "task:c:statement:0:relation:filter.deal_pr",
        type: "filter",
        predicate_expr: "BUSI_DATE='2026-06-11' AND SEQ='0'",
        predicate_columns: [col("BUSI_DATE", "odata_n_tit.d_ref_option_deal_pr"), col("SEQ", "odata_n_tit.d_ref_option_deal_pr")],
      },
    };
    const join = {
      task_id: "c",
      relation_id: "task:c:statement:0:relation:join.left",
      relation_type: "join",
      relation: {
        id: "task:c:statement:0:relation:join.left",
        type: "join",
        join_type: "LEFT",
        left: driver.relation_id,
        right: filter.relation_id,
        condition_expr: "driver.KEY_OTC_TRADE_ID = deal_pr.KEY_OTC_TRADE_ID",
        condition_columns: [
          col("KEY_OTC_TRADE_ID", "odata_n_tit.d_ref_otc_option_deal"),
          col("KEY_OTC_TRADE_ID", "odata_n_tit.d_ref_option_deal_pr"),
        ],
      },
    };
    const project = {
      task_id: "c",
      relation_id: "task:c:statement:0:relation:root.project",
      relation_type: "project",
      relation: {
        id: "task:c:statement:0:relation:root.project",
        type: "project",
        source: join.relation_id,
        expression: "CASE WHEN IS_ANNUALIZED = 'Y' THEN '1' ELSE '0' END",
      },
      source_text: "CASE WHEN IS_ANNUALIZED = 'Y' THEN '1' ELSE '0' END",
    };
    const midSummary = summarizeTaskRelations({
      taskId: "103943",
      sqlSourceId: "task:c",
      statementIndex: 0,
      rootRelationId: project.relation_id,
      relationRecords: [driver, dim, filter, join, project].map((row) => ({ ...row, task_id: "103943" })),
      relationEdgeRecords: [
        { from_relation_id: dim.relation_id, to_relation_id: filter.relation_id },
        { from_relation_id: driver.relation_id, to_relation_id: join.relation_id },
        { from_relation_id: filter.relation_id, to_relation_id: join.relation_id },
        { from_relation_id: join.relation_id, to_relation_id: project.relation_id },
      ],
    });
    const dimImpact = midSummary.readImpacts.find((item) => item.readOccurrenceId.includes("read.deal_pr"));
    const occurrenceId = dimImpact?.readOccurrenceId ?? dim.relation_id;
    const root = branch({
      branchKind: "ROOT_WRITE",
      candidateBranchId: "branch:root",
      consumerTaskId: null,
      producerTaskId: "176827",
      table: null,
      readOccurrence: null,
      writeObservationId: "write:root:0",
    });
    const mid = branch({
      candidateBranchId: "branch:103943",
      consumerTaskId: "176827",
      producerTaskId: "103943",
      table: namedTable("pdata_n.t03_otc_opt_comp_info"),
      readOccurrence: {
        occurrenceId: "root-read-103943",
        readRelationId: "root-read-103943",
        sqlSourceId: "root-source",
        statementIndex: 0,
        relationPath: ["root-relation", "root-read-103943"],
        rootRelationId: "root-relation",
      },
      writeObservationId: "write:103943",
      writeScope: { sqlSourceId: "task:c", statementOrdinal: 0, rootRelationId: project.relation_id },
    });
    const dimProducer = branch({
      candidateBranchId: "branch:102845",
      consumerTaskId: "103943",
      producerTaskId: "102845",
      table: namedTable("odata_n_tit.d_ref_option_deal_pr"),
      readOccurrence: {
        occurrenceId,
        readRelationId: occurrenceId,
        sqlSourceId: "task:c",
        statementIndex: 0,
        relationPath: [project.relation_id, occurrenceId],
        rootRelationId: project.relation_id,
      },
      writeObservationId: "write:102845",
      writeScope: { sqlSourceId: "task:102845", statementOrdinal: 0, rootRelationId: "task:102845:root" },
    });
    const branches = [root, mid, dimProducer];
    const result = buildCausalClosure({
      targetWriteId: "write:target",
      rootTaskId: "176827",
      universe: completeUniverse(branches),
      summaries: new Map([
        [
          relationSummaryKey("176827", "root-source", 0, "root-relation"),
          {
            ...summary("176827", "root-source", [
              {
                readOccurrenceId: "root-read-103943",
                impactChannels: [],
                demandedFieldNames: [],
                evidenceRefs: ["root-read-103943"],
                gaps: [],
              },
            ]),
            rootRelationId: "root-relation",
          },
        ],
        [relationSummaryKey("103943", "task:c", 0, project.relation_id), midSummary],
      ]),
      fieldValueProvider: fieldProvider({ "103943": ["erly_trmt_date"] }),
      rootWriteScope: {
        taskId: "176827",
        writeObservationId: "write:root:0",
        sqlSourceId: "root-source",
        statementOrdinal: 0,
        rootRelationId: "root-relation",
      },
    });
    const report = buildShrinkReport({ branches, assessments: result.assessments });
    expect(report.valueCertain.map((entry) => entry.taskId)).toEqual(["103943", "176827"]);
    expect(report.rowDetermining.map((entry) => entry.taskId)).not.toContain("102845");
  });

  it("does not broadcast RM from a value-recalled hop onto LEFT dims that only have a version-window filter", () => {
    const fixture = loadRelationFixture("105387-zipper-relations.json");
    const zipperRoot = "task:105387:statement:1:relation:root.project";
    const zipper = summarizeTaskRelations({
      taskId: "105387",
      sqlSourceId: "task:105387",
      statementIndex: 1,
      rootRelationId: zipperRoot,
      relationRecords: fixture.nodes,
      relationEdgeRecords: fixture.edges,
    });
    const refs = [
      { name: "d_ref_trs", taskId: "78473", table: "odata_n_tit.d_ref_trs" },
      { name: "d_ref_otc_option_deal", taskId: "78472", table: "odata_n_tit.d_ref_otc_option_deal" },
      { name: "d_ref_fx_forward", taskId: "163064", table: "odata_n_tit.d_ref_fx_forward" },
      { name: "d_ref_fast_trs", taskId: "179886", table: "odata_n_tit.d_ref_fast_trs" },
    ];
    const root = branch({
      branchKind: "ROOT_WRITE",
      candidateBranchId: "branch:root",
      consumerTaskId: null,
      producerTaskId: "176827",
      table: null,
      readOccurrence: null,
      writeObservationId: "write:root:0",
    });
    const mid = branch({
      candidateBranchId: "branch:119044",
      consumerTaskId: "176827",
      producerTaskId: "119044",
      table: namedTable("pdata_n.t98_sb_otc_opt_comp_info"),
      readOccurrence: {
        occurrenceId: "root-read-119044",
        readRelationId: "root-read-119044",
        sqlSourceId: "root-source",
        statementIndex: 0,
        relationPath: ["root-relation", "root-read-119044"],
        rootRelationId: "root-relation",
      },
      writeObservationId: "write:119044",
      writeScope: { sqlSourceId: "mid-source", statementOrdinal: 0, rootRelationId: "mid-root" },
    });
    const zipperProducer = branch({
      candidateBranchId: "branch:105387",
      consumerTaskId: "119044",
      producerTaskId: "105387",
      table: namedTable("pdata_n.t03_agt_stati_info_h"),
      readOccurrence: {
        occurrenceId: "mid-read-zipper",
        readRelationId: "mid-read-zipper",
        sqlSourceId: "mid-source",
        statementIndex: 0,
        relationPath: ["mid-root", "mid-read-zipper"],
        rootRelationId: "mid-root",
      },
      writeObservationId: "write:105387",
      writeScope: { sqlSourceId: "task:105387", statementOrdinal: 1, rootRelationId: zipperRoot },
    });
    const rela = branch({
      candidateBranchId: "branch:105388",
      consumerTaskId: "119044",
      producerTaskId: "105388",
      table: namedTable("pdata_n.t03_agt_rela_h"),
      readOccurrence: {
        occurrenceId: "mid-read-rela",
        readRelationId: "mid-read-rela",
        sqlSourceId: "mid-source",
        statementIndex: 0,
        relationPath: ["mid-root", "mid-read-rela"],
        rootRelationId: "mid-root",
      },
      writeObservationId: "write:105388",
      writeScope: { sqlSourceId: "task:105388", statementOrdinal: 0, rootRelationId: "task:105388:root" },
    });
    const refBranches = refs.map((ref) => {
      const impact = zipper.readImpacts.find((item) => item.readOccurrenceId.toLowerCase().includes(ref.name));
      const occurrenceId = impact?.readOccurrenceId ?? `task:105387:statement:1:relation:root.b.read.${ref.name}`;
      return branch({
        candidateBranchId: `branch:${ref.taskId}`,
        consumerTaskId: "105387",
        producerTaskId: ref.taskId,
        table: namedTable(ref.table),
        readOccurrence: {
          occurrenceId,
          readRelationId: occurrenceId,
          sqlSourceId: "task:105387",
          statementIndex: 1,
          relationPath: [zipperRoot, occurrenceId],
          rootRelationId: zipperRoot,
        },
        writeObservationId: `write:${ref.taskId}`,
        writeScope: { sqlSourceId: `task:${ref.taskId}`, statementOrdinal: 0, rootRelationId: `task:${ref.taskId}:root` },
      });
    });
    const branches = [root, mid, zipperProducer, rela, ...refBranches];
    const result = buildCausalClosure({
      targetWriteId: "write:target",
      rootTaskId: "176827",
      universe: completeUniverse(branches),
      summaries: new Map([
        [
          relationSummaryKey("176827", "root-source", 0, "root-relation"),
          {
            ...summary("176827", "root-source", [
              {
                readOccurrenceId: "root-read-119044",
                impactChannels: ["ROW_MEMBERSHIP", "RELATION_EXISTENCE"],
                demandedFieldNames: ["inr_ord_id"],
                localTransferKinds: ["RELATION_OPERATOR"],
                evidenceRefs: ["root-inner-119044"],
                gaps: [],
              },
            ]),
            rootRelationId: "root-relation",
          },
        ],
        [
          relationSummaryKey("119044", "mid-source", 0, "mid-root"),
          {
            ...summary("119044", "mid-source", [
              {
                readOccurrenceId: "mid-read-zipper",
                impactChannels: ["ROW_MEMBERSHIP", "RELATION_EXISTENCE"],
                demandedFieldNames: ["STRT_DATE", "END_DATE"],
                localTransferKinds: ["RELATION_OPERATOR"],
                evidenceRefs: ["mid-read-zipper"],
                gaps: ["relation-summary-gap:119044:PARSE_PARTIAL"],
              },
              {
                readOccurrenceId: "mid-read-rela",
                impactChannels: ["ROW_MEMBERSHIP", "MULTIPLICITY", "RELATION_EXISTENCE"],
                demandedFieldNames: ["Book_Agt_Id", "STRT_DATE", "END_DATE"],
                localTransferKinds: ["CONTROL_FIELD_DEMAND", "MULTIPLICITY_FIELD_DEMAND", "RELATION_OPERATOR"],
                evidenceRefs: ["mid-read-rela"],
                gaps: [],
              },
            ]),
            sqlSourceId: "mid-source",
            rootRelationId: "mid-root",
          },
        ],
        [relationSummaryKey("105387", "task:105387", 1, zipperRoot), zipper],
      ]),
      fieldValueProvider: fieldProvider({
        "119044": ["inr_ord_id"],
        "105387": ["Stati_Cont_Desc"],
      }),
      rootWriteScope: {
        taskId: "176827",
        writeObservationId: "write:root:0",
        sqlSourceId: "root-source",
        statementOrdinal: 0,
        rootRelationId: "root-relation",
      },
    });
    const report = buildShrinkReport({ branches, assessments: result.assessments });
    expect(report.valueCertain.map((entry) => entry.taskId).sort()).toEqual(["105387", "119044", "176827"]);
    expect(report.rowDetermining.map((entry) => entry.taskId)).toEqual([]);
    expect(report.multiplicityRisk.map((entry) => entry.taskId).sort()).toEqual(
      ["105388", "163064", "179886", "78472", "78473"].sort(),
    );
    expect(report.rowDetermining.map((entry) => entry.taskId)).not.toContain("105388");
    expect(report.valueCertain.map((entry) => entry.taskId)).not.toContain("105388");
  });

  it("keeps the 176827 LEFT constant dimension out of 档一/档二 and keeps the driving table", () => {
    const fixture = loadRelationFixture("176827-root-join.json");
    const summarized = summarizeTaskRelations({
      taskId: "176827",
      sqlSourceId: "task:176827",
      statementIndex: 0,
      relationRecords: fixture.nodes,
      relationEdgeRecords: fixture.edges,
    });
    const driverImpact = summarized.readImpacts.find((item) => item.readOccurrenceId.includes("read.driver"));
    const constImpact = summarized.readImpacts.find((item) => item.readOccurrenceId.includes("read.const"));
    expect(driverImpact?.impactChannels).toContain("ROW_MEMBERSHIP");
    expect(constImpact?.impactChannels).not.toContain("ROW_MEMBERSHIP");
    expect(constImpact?.impactChannels).toContain("MULTIPLICITY");
    const root = branch({
      branchKind: "ROOT_WRITE",
      candidateBranchId: "branch:root",
      consumerTaskId: null,
      producerTaskId: "176827",
      table: null,
      readOccurrence: null,
      writeObservationId: "write:root:0",
    });
    const driver = branch({
      candidateBranchId: "branch:119044",
      consumerTaskId: "176827",
      producerTaskId: "119044",
      table: namedTable("pdata_n.t98_sb_otc_opt_comp_info"),
      readOccurrence: {
        occurrenceId: driverImpact!.readOccurrenceId,
        readRelationId: driverImpact!.readOccurrenceId,
        sqlSourceId: "task:176827",
        statementIndex: 0,
        relationPath: ["task:176827:statement:0:relation:join.left", driverImpact!.readOccurrenceId],
        rootRelationId: summarized.rootRelationId ?? "task:176827:statement:0:relation:join.left",
      },
      writeObservationId: "write:119044",
      writeScope: { sqlSourceId: "task:119044", statementOrdinal: 0, rootRelationId: "task:119044:root" },
    });
    const constant = branch({
      candidateBranchId: "branch:74850",
      consumerTaskId: "176827",
      producerTaskId: "74850",
      table: namedTable("pdata_n.t02_pub_covt_const"),
      readOccurrence: {
        occurrenceId: constImpact!.readOccurrenceId,
        readRelationId: constImpact!.readOccurrenceId,
        sqlSourceId: "task:176827",
        statementIndex: 0,
        relationPath: ["task:176827:statement:0:relation:join.left", constImpact!.readOccurrenceId],
        rootRelationId: summarized.rootRelationId ?? "task:176827:statement:0:relation:join.left",
      },
      writeObservationId: "write:74850",
      writeScope: { sqlSourceId: "task:74850", statementOrdinal: 0, rootRelationId: "task:74850:root" },
    });
    const branches = [root, driver, constant];
    const result = buildCausalClosure({
      targetWriteId: "write:target",
      rootTaskId: "176827",
      universe: completeUniverse(branches),
      summaries: new Map([
        [relationSummaryKey("176827", summarized.sqlSourceId, summarized.statementIndex, summarized.rootRelationId), summarized],
      ]),
      fieldValueProvider: fieldProvider({ "119044": ["inr_ord_id"] }),
      rootWriteScope: {
        taskId: "176827",
        writeObservationId: "write:root:0",
        sqlSourceId: summarized.sqlSourceId,
        statementOrdinal: summarized.statementIndex,
        rootRelationId: summarized.rootRelationId ?? "task:176827:statement:0:relation:join.left",
      },
    });
    const report = buildShrinkReport({ branches, assessments: result.assessments });
    expect(report.valueCertain.map((entry) => entry.taskId)).toEqual(["119044", "176827"]);
    expect(report.rowDetermining.map((entry) => entry.taskId)).not.toContain("74850");
    expect(report.valueCertain.map((entry) => entry.taskId)).not.toContain("74850");
  });

  it("keeps LEFT-join t03_agt_rela_h out of 档一/档二 even when Book_Agt_Id is demanded", () => {
    const fixture = loadRelationFixture("119044-left-dim.json");
    const inner = summarizeTaskRelations({
      taskId: "119044",
      sqlSourceId: "task:119044",
      statementIndex: 0,
      relationRecords: fixture.nodes,
      relationEdgeRecords: fixture.edges,
    });
    const unusedImpact = inner.readImpacts.find((item) => item.readOccurrenceId.includes("read.unused"));
    const relaImpact = inner.readImpacts.find((item) => item.readOccurrenceId.includes("read.rela"));
    expect(unusedImpact?.impactChannels).not.toContain("ROW_MEMBERSHIP");
    expect(relaImpact?.impactChannels).not.toContain("ROW_MEMBERSHIP");
    expect(relaImpact?.demandedFieldNames).toEqual(expect.arrayContaining(["Book_Agt_Id"]));
    const root = branch({
      branchKind: "ROOT_WRITE",
      candidateBranchId: "branch:root",
      consumerTaskId: null,
      producerTaskId: "176827",
      table: null,
      readOccurrence: null,
      writeObservationId: "write:root:0",
    });
    const wide = branch({
      candidateBranchId: "branch:119044",
      consumerTaskId: "176827",
      producerTaskId: "119044",
      table: namedTable("pdata_n.t98_sb_otc_opt_comp_info"),
      readOccurrence: {
        occurrenceId: "root-read-119044",
        readRelationId: "root-read-119044",
        sqlSourceId: "root-source",
        statementIndex: 0,
        relationPath: ["root-relation", "root-read-119044"],
        rootRelationId: "root-relation",
      },
      writeObservationId: "write:119044",
      writeScope: {
        sqlSourceId: inner.sqlSourceId,
        statementOrdinal: inner.statementIndex,
        rootRelationId: inner.rootRelationId ?? "task:119044:statement:0:relation:join.rela",
      },
    });
    const unused = branch({
      candidateBranchId: "branch:106661",
      consumerTaskId: "119044",
      producerTaskId: "106661",
      table: namedTable("pdata_n.t03_agt_clas_h"),
      readOccurrence: {
        occurrenceId: unusedImpact!.readOccurrenceId,
        readRelationId: unusedImpact!.readOccurrenceId,
        sqlSourceId: "task:119044",
        statementIndex: 0,
        relationPath: [inner.rootRelationId ?? unusedImpact!.readOccurrenceId, unusedImpact!.readOccurrenceId],
        rootRelationId: inner.rootRelationId ?? undefined,
      },
      writeObservationId: "write:106661",
      writeScope: { sqlSourceId: "task:106661", statementOrdinal: 0, rootRelationId: "task:106661:root" },
    });
    const rela = branch({
      candidateBranchId: "branch:105388",
      consumerTaskId: "119044",
      producerTaskId: "105388",
      table: namedTable("pdata_n.t03_agt_rela_h"),
      readOccurrence: {
        occurrenceId: relaImpact!.readOccurrenceId,
        readRelationId: relaImpact!.readOccurrenceId,
        sqlSourceId: "task:119044",
        statementIndex: 0,
        relationPath: [inner.rootRelationId ?? relaImpact!.readOccurrenceId, relaImpact!.readOccurrenceId],
        rootRelationId: inner.rootRelationId ?? undefined,
      },
      writeObservationId: "write:105388",
      writeScope: { sqlSourceId: "task:105388", statementOrdinal: 0, rootRelationId: "task:105388:root" },
    });
    const branches = [root, unused, rela, wide];
    const result = buildCausalClosure({
      targetWriteId: "write:target",
      rootTaskId: "176827",
      universe: completeUniverse(branches),
      summaries: new Map([
        [
          relationSummaryKey("176827", "root-source", 0, "root-relation"),
          {
            ...summary("176827", "root-source", [
              {
                readOccurrenceId: "root-read-119044",
                impactChannels: ["ROW_MEMBERSHIP", "RELATION_EXISTENCE"],
                demandedFieldNames: ["Book_Agt_Id"],
                localTransferKinds: ["CONTROL_FIELD_DEMAND", "RELATION_OPERATOR"],
                evidenceRefs: ["root-join-pepv"],
                gaps: [],
              },
            ]),
            rootRelationId: "root-relation",
          },
        ],
        [relationSummaryKey("119044", inner.sqlSourceId, inner.statementIndex, inner.rootRelationId), inner],
      ]),
      fieldValueProvider: fieldProvider({ "119044": ["inr_ord_id"] }),
      rootWriteScope: {
        taskId: "176827",
        writeObservationId: "write:root:0",
        sqlSourceId: "root-source",
        statementOrdinal: 0,
        rootRelationId: "root-relation",
      },
    });
    const report = buildShrinkReport({ branches, assessments: result.assessments });
    expect(report.valueCertain.map((entry) => entry.taskId)).toEqual(["119044", "176827"]);
    expect(report.rowDetermining.map((entry) => entry.taskId)).not.toContain("105388");
    expect(report.valueCertain.map((entry) => entry.taskId)).not.toContain("105388");
    expect(report.valueCertain.map((entry) => entry.taskId)).not.toContain("106661");
    expect(report.rowDetermining.map((entry) => entry.taskId)).not.toContain("106661");
  });

  it("does not stamp schema-backed LEFT dims as UNSUPPORTED_OPERATOR just because the statement has LATERAL VIEW", () => {
    const evt = "task:181058:statement:0:relation:root.read.evt";
    const expand = "task:181058:statement:0:relation:root.expand.t";
    const rela = "task:181058:statement:0:relation:root.read.rela";
    const join = "task:181058:statement:0:relation:root.join.rela";
    const project = "task:181058:statement:0:relation:root.project";
    const summarized = summarizeTaskRelations({
      taskId: "181058",
      sqlSourceId: "task:181058",
      statementIndex: 0,
      relationRecords: [
        {
          task_id: "181058",
          relation_id: evt,
          relation_type: "read",
          relation: { id: evt, type: "read", table: "pdata_n.t05_otc_comp_dura_chg_evt" },
        },
        {
          task_id: "181058",
          relation_id: expand,
          relation_type: "expand",
          relation: { id: expand, type: "expand", expand_kind: "lateral", produced_columns: ["pos", "val"] },
        },
        {
          task_id: "181058",
          relation_id: rela,
          relation_type: "read",
          relation: { id: rela, type: "read", table: "pdata_n.t03_agt_rela_h" },
        },
        {
          task_id: "181058",
          relation_id: join,
          relation_type: "join",
          relation: {
            id: join,
            type: "join",
            join_type: "LEFT",
            left: expand,
            right: rela,
            condition_expr: "evt.agt_id = rela.agt_id",
            condition_columns: [
              { name: "agt_id", physical: [{ column: "agt_id", table: "pdata_n.t05_otc_comp_dura_chg_evt" }] },
              { name: "agt_id", physical: [{ column: "agt_id", table: "pdata_n.t03_agt_rela_h" }] },
            ],
          },
        },
        {
          task_id: "181058",
          relation_id: project,
          relation_type: "project",
          relation: { id: project, type: "project" },
        },
      ],
      relationEdgeRecords: [
        { from_relation_id: evt, to_relation_id: expand },
        { from_relation_id: expand, to_relation_id: join },
        { from_relation_id: rela, to_relation_id: join },
        { from_relation_id: join, to_relation_id: project },
      ],
    });
    const dimImpact = summarized.readImpacts.find((item) => item.readOccurrenceId === rela);
    expect(summarized.complete).toBe(true);
    expect(summarized.gaps.some((gap) => /UNSUPPORTED_OPERATOR/i.test(gap))).toBe(false);
    expect(dimImpact?.gaps.some((gap) => /UNSUPPORTED_OPERATOR/i.test(gap))).toBe(false);
    expect(dimImpact?.impactChannels).not.toContain("ROW_MEMBERSHIP");
    expect(dimImpact?.impactChannels).toContain("MULTIPLICITY");

    const dim = branch({
      candidateBranchId: "branch:105388",
      consumerTaskId: "181058",
      producerTaskId: "105388",
      table: namedTable("pdata_n.t03_agt_rela_h"),
      readOccurrence: {
        occurrenceId: rela,
        readRelationId: rela,
        sqlSourceId: "task:181058",
        statementIndex: 0,
        relationPath: [join, rela],
        rootRelationId: project,
      },
      writeObservationId: "write:105388",
      writeScope: { sqlSourceId: "task:105388", statementOrdinal: 0, rootRelationId: "task:105388:root" },
    });
    const assessment = assessBranch({
      targetWriteId: "write:181058",
      branch: dim,
      universeComplete: true,
      summary: summarized,
      fieldValueProvider: noFieldEvidenceProvider(),
    });
    expect(assessment.channelAssessments.find((channel) => channel.channel === "FIELD_VALUE")?.status).toBe("NOT_APPLICABLE");
    expect(assessment.channelAssessments.find((channel) => channel.channel === "MULTIPLICITY")?.status).toBe("CONFIRMED");
    expect(assessment.gapRefs.some((gap) => /UNSUPPORTED_OPERATOR/i.test(gap))).toBe(false);
    expect(classifyPrunedReason(dim, assessment)).not.toBe("UNSUPPORTED_OPERATOR");

    const root = branch({
      branchKind: "ROOT_WRITE",
      candidateBranchId: "branch:root",
      consumerTaskId: null,
      producerTaskId: "181058",
      table: null,
      readOccurrence: null,
      writeObservationId: "write:181058",
    });
    const evtProducer = branch({
      candidateBranchId: "branch:124566",
      consumerTaskId: "181058",
      producerTaskId: "124566",
      table: namedTable("pdata_n.t05_otc_comp_dura_chg_evt"),
      readOccurrence: {
        occurrenceId: evt,
        readRelationId: evt,
        sqlSourceId: "task:181058",
        statementIndex: 0,
        relationPath: [project, join, expand, evt],
        rootRelationId: project,
      },
      writeObservationId: "write:124566",
      writeScope: { sqlSourceId: "task:124566", statementOrdinal: 0, rootRelationId: "task:124566:root" },
    });
    const result = buildCausalClosure({
      targetWriteId: "write:181058",
      rootTaskId: "181058",
      universe: completeUniverse([root, evtProducer, dim]),
      summaries: new Map([
        [relationSummaryKey("181058", summarized.sqlSourceId, summarized.statementIndex, summarized.rootRelationId), summarized],
      ]),
      fieldValueProvider: fieldProvider({ "124566": ["evt_id"] }),
      rootWriteScope: {
        taskId: "181058",
        writeObservationId: "write:181058",
        sqlSourceId: summarized.sqlSourceId,
        statementOrdinal: summarized.statementIndex,
        rootRelationId: summarized.rootRelationId ?? project,
      },
    });
    const report = buildShrinkReport({ branches: [root, evtProducer, dim], assessments: result.assessments });
    expect(report.valueCertain.map((entry) => entry.taskId)).toEqual(["124566", "181058"]);
    expect(report.rowDetermining.map((entry) => entry.taskId)).not.toContain("105388");
    expect(report.multiplicityRisk.map((entry) => entry.taskId)).toContain("105388");
    expect(report.prunedReasons.find((reason) => reason.reasonCode === "UNSUPPORTED_OPERATOR")).toBeUndefined();
  });

  it("does not let an unrelated other-body fail-close a schema-backed LEFT dim in the same statement", () => {
    const driver = "task:c:statement:0:relation:read.driver";
    const dim = "task:c:statement:0:relation:read.dim";
    const join = "task:c:statement:0:relation:join.dim";
    const other = "task:c:statement:0:relation:other";
    const summarized = summarizeTaskRelations({
      taskId: "c",
      sqlSourceId: "task:c",
      relationRecords: [
        { task_id: "c", relation_id: driver, relation_type: "read", relation: { id: driver, type: "read", table: "db.fact" } },
        { task_id: "c", relation_id: dim, relation_type: "read", relation: { id: dim, type: "read", table: "pdata_n.t01_pty_clas_h" } },
        {
          task_id: "c",
          relation_id: join,
          relation_type: "join",
          relation: { id: join, type: "join", join_type: "LEFT", left: driver, right: dim },
        },
        {
          task_id: "c",
          relation_id: other,
          relation_type: "other",
          relation: { id: other, type: "other", body_kind: "pipe", note: "unmodeled" },
        },
      ],
      relationEdgeRecords: [
        { from_relation_id: driver, to_relation_id: join },
        { from_relation_id: dim, to_relation_id: join },
      ],
    });
    expect(summarized.complete).toBe(false);
    const dimImpact = summarized.readImpacts.find((item) => item.readOccurrenceId === dim);
    expect(dimImpact?.gaps.some((gap) => /UNSUPPORTED_OPERATOR/i.test(gap))).toBe(false);
    const dimBranch = branch({
      candidateBranchId: "branch:dim",
      producerTaskId: "74850",
      table: namedTable("pdata_n.t01_pty_clas_h"),
      readOccurrence: {
        occurrenceId: dim,
        readRelationId: dim,
        sqlSourceId: "task:c",
        statementIndex: 0,
        relationPath: [join, dim],
      },
      writeObservationId: "write:74850",
      writeScope: { sqlSourceId: "task:74850", statementOrdinal: 0, rootRelationId: "task:74850:root" },
    });
    const assessment = assessBranch({
      targetWriteId: "write:c",
      branch: dimBranch,
      universeComplete: true,
      summary: summarized,
      fieldValueProvider: noFieldEvidenceProvider(),
    });
    expect(assessment.channelAssessments.find((channel) => channel.channel === "FIELD_VALUE")?.status).toBe("NOT_APPLICABLE");
    expect(assessment.channelAssessments.find((channel) => channel.channel === "MULTIPLICITY")?.status).toBe("CONFIRMED");
    expect(assessment.gapRefs.some((gap) => /UNSUPPORTED_OPERATOR/i.test(gap))).toBe(false);
    expect(classifyPrunedReason(dimBranch, assessment)).not.toBe("UNSUPPORTED_OPERATOR");
  });
});
