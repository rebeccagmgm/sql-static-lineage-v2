import { describe, expect, it } from "vitest";

import type { CandidateBranch } from "../../scripts/reconcile/consumer/target-field-causal-slice/candidate-universe.ts";
import { buildCausalClosure } from "../../scripts/reconcile/consumer/target-table-upstream-causal-closure/causal-closure.ts";
import { inferReadScope, normalizeReadScopes, enrichRelationPathFromFacts } from "../../scripts/reconcile/consumer/target-table-upstream-causal-closure/read-scope.ts";
import { assessBranch, buildShrinkReport } from "../../scripts/reconcile/consumer/target-table-upstream-causal-closure/static-assessment.ts";
import { relationSummaryKey, summarizeTaskRelations } from "../../scripts/reconcile/consumer/target-table-upstream-causal-closure/task-relation-summary.ts";
import type { CurrentBundleLoad, JsonRecord } from "../../scripts/query/current-task-bundle.ts";

const table = {
  platform: "hive",
  dataSource: "gfhive",
  qualifiedName: "pdata_n.t05_otc_comp_dura_chg_evt",
  stableTableId: "pdata_n.t05_otc_comp_dura_chg_evt__gfhive",
  identityStatus: "SCHEMA_BACKED" as const,
};

function readNode(input: {
  readonly taskId: string;
  readonly relationId: string;
  readonly table: string;
  readonly occurrenceId: string;
}): JsonRecord {
  return {
    task_id: input.taskId,
    relation_id: input.relationId,
    statement_id: `task:${input.taskId}:slot:query:statement:0`,
    relation_type: "read",
    relation: {
      type: "read",
      table: input.table,
      id: input.relationId,
      read_occurrence_id: input.occurrenceId,
    },
    read_occurrence_id: input.occurrenceId,
  };
}

function uniqueReadIo(
  taskId: string,
  table: string,
  occurrenceId: string,
  relationId: string,
): JsonRecord {
  return {
    task_id: taskId,
    direction: "READ",
    physical_dataset: table,
    statement_id: `task:${taskId}:slot:query:statement:0`,
    read_occurrences: [{ occurrence_id: occurrenceId, relation_id: relationId }],
  };
}

function physicalTable(qualifiedName: string) {
  return {
    platform: "hive",
    dataSource: "gfhive",
    qualifiedName,
    stableTableId: `${qualifiedName}__gfhive`,
    identityStatus: "SCHEMA_BACKED" as const,
  };
}

function load(taskId: string, records: Record<string, JsonRecord[]>): CurrentBundleLoad {
  return {
    state: "CURRENT_L1",
    factsRoot: "facts",
    taskId,
    bundleDir: "",
    indexPath: "",
    statusPath: "",
    records,
    evidence: {},
    issues: [],
  };
}

function producer(overrides: Partial<CandidateBranch> = {}): CandidateBranch {
  return {
    candidateBranchId: "branch:p",
    branchKind: "PHYSICAL_PRODUCER",
    rootTaskId: "181058",
    consumerTaskId: "181058",
    producerTaskId: "124566",
    table,
    readOccurrence: {
      occurrenceId: "query#0:root.casttable.evt.(child).read.toe",
      readRelationId: "root.casttable.evt.(child).read.toe",
      sqlSourceId: "task:181058:slot:query",
      statementIndex: 0,
      rootRelationId: "task:181058:statement:0:relation:root.casttable.evt.(child).project",
      relationPath: ["root.casttable.evt.(child).read.toe"],
    },
    writeObservationId: "write-observation:124566:0",
    writeScope: {
      sqlSourceId: "task:124566:slot:query",
      statementOrdinal: 0,
      rootRelationId: "task:124566:statement:0:relation:root.project",
    },
    producerRole: "PRIMARY",
    evidenceRefs: [],
    gapRefs: [],
    boundaryReason: null,
    ...overrides,
  };
}

describe("inferReadScope", () => {
  it("walks CAST child reads to the statement write root even when sqlSourceId is already a slot", () => {
    const read = "task:181058:statement:0:relation:root.casttable.evt.(child).read.toe";
    const child = "task:181058:statement:0:relation:root.casttable.evt.(child).project";
    const root = "task:181058:statement:0:relation:root.project";
    const table = "pdata_n.t05_otc_comp_dura_chg_evt";
    const occurrenceId = `query#0:${read}`;
    const facts = load("181058", {
      "statements.jsonl": [
        { statement_id: "task:181058:slot:query:statement:0", statement_index: 0 },
      ],
      "relation-nodes.jsonl": [
        readNode({ taskId: "181058", relationId: read, table, occurrenceId }),
        { relation_id: child, statement_id: "task:181058:slot:query:statement:0" },
        { relation_id: root, statement_id: "task:181058:slot:query:statement:0" },
      ],
      "relation-edges.jsonl": [
        { from_relation_id: read, to_relation_id: child },
        { from_relation_id: child, to_relation_id: root },
      ],
      "dataset-io.jsonl": [uniqueReadIo("181058", table, occurrenceId, read)],
    });
    expect(inferReadScope(facts, producer())).toEqual({
      sqlSourceId: "task:181058:slot:query",
      rootRelationId: root,
    });
  });

  it("still resolves the slot by relation path when the occurrence cannot be proven", () => {
    const read = "task:105386:statement:1:relation:root.a.read.d_trd_otc_trade";
    const filter = "task:105386:statement:1:relation:root.a.filter";
    const root = "task:105386:statement:1:relation:root.project";
    const facts = load("105386", {
      "statements.jsonl": [
        { statement_id: "task:105386:slot:create:statement:1", statement_index: 1 },
      ],
      "relation-nodes.jsonl": [
        {
          task_id: "105386",
          relation_id: read,
          statement_id: "task:105386:slot:create:statement:1",
          relation_type: "read",
          relation: { type: "read", table: "odata_n_tit.d_trd_otc_trade", id: read },
        },
        { relation_id: filter, statement_id: "task:105386:slot:create:statement:1" },
        { relation_id: root, statement_id: "task:105386:slot:create:statement:1" },
      ],
      "relation-edges.jsonl": [
        { from_relation_id: read, to_relation_id: filter },
        { from_relation_id: filter, to_relation_id: root },
      ],
      "dataset-io.jsonl": [],
    });
    const branch = producer({
      consumerTaskId: "105386",
      producerTaskId: "71698",
      table: physicalTable("odata_n_tit.d_trd_otc_trade"),
      readOccurrence: {
        occurrenceId: "create#1:root.a.read.d_trd_otc_trade",
        readRelationId: "root.a.read.d_trd_otc_trade",
        statementIndex: 1,
        relationPath: ["root.a.read.d_trd_otc_trade"],
      },
    });
    expect(inferReadScope(facts, branch)).toEqual({
      sqlSourceId: "task:105386:slot:create",
      rootRelationId: root,
    });
  });

  it("refreshes a placeholder occurrence from relation-nodes when dataset-io has no nested ids", () => {
    const read = "task:105386:statement:1:relation:root.a.read.d_trd_otc_trade";
    const facts = load("105386", {
      "statements.jsonl": [
        { statement_id: "task:105386:slot:create:statement:1", statement_index: 1 },
      ],
      "relation-nodes.jsonl": [
        {
          task_id: "105386",
          relation_id: read,
          statement_id: "task:105386:slot:create:statement:1",
          relation_type: "read",
          relation: { type: "read", table: "ODATA_N_TIT.D_TRD_OTC_TRADE", id: read },
        },
      ],
      "relation-edges.jsonl": [],
      "dataset-io.jsonl": [
        {
          task_id: "105386",
          direction: "READ",
          physical_dataset: "odata_n_tit.d_trd_otc_trade",
          statement_id: "task:105386:slot:create:statement:1",
        },
      ],
    });
    const branch = producer({
      consumerTaskId: "105386",
      producerTaskId: "71698",
      table: physicalTable("odata_n_tit.d_trd_otc_trade"),
      readOccurrence: {
        occurrenceId: "create#1:root.a.read.d_trd_otc_trade",
        readRelationId: "root.a.read.d_trd_otc_trade",
        statementIndex: 1,
        relationPath: ["root.a.read.d_trd_otc_trade"],
      },
    });
    const normalized = normalizeReadScopes(
      {
        rootTaskId: "181058",
        status: "COMPLETE_OBSERVED_EVIDENCE",
        branches: [branch],
        boundaryGapRefs: [],
        coverage: {
          sourceArtifactType: "test",
          sourceCoverageStatus: "COMPLETE_OBSERVED_EVIDENCE",
          sourceCoverageSemantics: null,
          sourceLimitsTruncated: false,
        },
      },
      () => facts,
      { canonicalizePlaceholderOccurrences: true },
    );
    expect(normalized.branches[0]?.readOccurrence?.occurrenceId).toBe(read);
    expect(normalized.branches[0]?.readOccurrence?.readRelationId).toBe(
      "root.a.read.d_trd_otc_trade",
    );
  });

  it("maps a query-local placeholder to its global Facts statement index", () => {
    const read = "task:103937:statement:3:relation:root.setop.b0.read.t03_agt_stat_h";
    const placeholder = "query#0:root.setop.b0.read.t03_agt_stat_h";
    const facts = load("103937", {
      "statements.jsonl": [
        { statement_id: "task:103937:slot:create:statement:0", statement_index: 0 },
        { statement_id: "task:103937:slot:query:statement:0", statement_index: 3 },
      ],
      "relation-nodes.jsonl": [
        {
          task_id: "103937",
          relation_id: read,
          statement_id: "task:103937:slot:query:statement:0",
          relation_type: "read",
          relation: { type: "read", table: "t03_agt_stat_h", id: read },
        },
      ],
      "relation-edges.jsonl": [],
      "dataset-io.jsonl": [
        {
          task_id: "103937",
          direction: "READ",
          physical_dataset: "t03_agt_stat_h",
          statement_id: "task:103937:slot:query:statement:0",
          read_occurrences: [{ occurrence_id: read, relation_id: read }],
        },
      ],
    });
    const branch = producer({
      consumerTaskId: "103937",
      table: physicalTable("pdata_n.t03_agt_stat_h"),
      readOccurrence: {
        occurrenceId: placeholder,
        readRelationId: "root.setop.b0.read.t03_agt_stat_h",
        statementIndex: 0,
        relationPath: ["root.setop.b0.read.t03_agt_stat_h"],
      },
    });
    const normalized = normalizeReadScopes(
      {
        rootTaskId: "181058",
        status: "COMPLETE_OBSERVED_EVIDENCE",
        branches: [branch],
        boundaryGapRefs: [],
        coverage: {
          sourceArtifactType: "test",
          sourceCoverageStatus: "COMPLETE_OBSERVED_EVIDENCE",
          sourceCoverageSemantics: null,
          sourceLimitsTruncated: false,
        },
      },
      () => facts,
      { canonicalizePlaceholderOccurrences: true },
    );
    expect(normalized.branches[0]?.readOccurrence).toMatchObject({
      occurrenceId: read,
      readRelationId: "root.setop.b0.read.t03_agt_stat_h",
      statementIndex: 3,
      sqlSourceId: "task:103937:slot:query",
    });
  });

  it("fills a missing slot from local UNION-branch relation ids without collapsing b0 and b1", () => {
    const b0Local = "root.t.setop.b0.read.d_pos_position_daily";
    const b1Local = "root.t.setop.b1.a.read.d_pos_position_daily";
    const root = "root.project";
    const table = "odata_n_tit.d_pos_position_daily";
    const facts = load("106590", {
      "statements.jsonl": [
        { statement_id: "task:106590:slot:query:statement:0", statement_index: 0 },
      ],
      "relation-nodes.jsonl": [
        readNode({
          taskId: "106590",
          relationId: b0Local,
          table,
          occurrenceId: `query#0:${b0Local}`,
        }),
        readNode({
          taskId: "106590",
          relationId: b1Local,
          table,
          occurrenceId: `query#0:${b1Local}`,
        }),
        { relation_id: root, statement_id: "task:106590:slot:query:statement:0" },
      ],
      "relation-edges.jsonl": [
        { from_relation_id: b0Local, to_relation_id: root },
        { from_relation_id: b1Local, to_relation_id: root },
      ],
      "dataset-io.jsonl": [
        {
          task_id: "106590",
          direction: "READ",
          physical_dataset: table,
          statement_id: "task:106590:slot:query:statement:0",
          read_occurrences: [
            { occurrence_id: `query#0:${b0Local}`, relation_id: b0Local },
            { occurrence_id: `query#0:${b1Local}`, relation_id: b1Local },
          ],
        },
      ],
    });
    const b0 = producer({
      candidateBranchId: "branch:b0",
      consumerTaskId: "106590",
      producerTaskId: "78585",
      table: physicalTable(table),
      readOccurrence: {
        occurrenceId: `query#0:${b0Local}`,
        readRelationId: b0Local,
        statementIndex: 0,
        relationPath: [b0Local],
      },
    });
    const b1 = producer({
      candidateBranchId: "branch:b1",
      consumerTaskId: "106590",
      producerTaskId: "78585",
      table: physicalTable(table),
      readOccurrence: {
        occurrenceId: `query#0:${b1Local}`,
        readRelationId: b1Local,
        statementIndex: 0,
        relationPath: [b1Local],
      },
    });
    expect(inferReadScope(facts, b0)).toEqual({
      sqlSourceId: "task:106590:slot:query",
      rootRelationId: root,
    });
    expect(inferReadScope(facts, b1)).toEqual({
      sqlSourceId: "task:106590:slot:query",
      rootRelationId: root,
    });
    const universe = normalizeReadScopes(
      {
        rootTaskId: "181058",
        status: "COMPLETE_OBSERVED_EVIDENCE",
        branches: [b0, b1],
        boundaryGapRefs: [],
        coverage: {
          sourceArtifactType: "test",
          sourceCoverageStatus: "COMPLETE_OBSERVED_EVIDENCE",
          sourceCoverageSemantics: null,
          sourceLimitsTruncated: false,
        },
      },
      () => facts,
    );
    expect(universe.branches[0]?.readOccurrence?.occurrenceId).toContain("setop.b0");
    expect(universe.branches[1]?.readOccurrence?.occurrenceId).toContain("setop.b1");
    expect(universe.branches[0]?.readOccurrence?.occurrenceId).not.toBe(
      universe.branches[1]?.readOccurrence?.occurrenceId,
    );
  });

  it("canonicalizes a shorter multi-hop path when Facts has one same-table occurrence", () => {
    const tableName = "odata_n_tit.d_ref_instrument";
    const factsRelation =
      "task:103230:statement:0:relation:root.a.tmp_ref_instrument.a.read.d_ref_instrument";
    const multiHopRelation = "root.a.read.d_ref_instrument";
    const branch = producer({
      consumerTaskId: "103230",
      table: physicalTable(tableName),
      readOccurrence: {
        occurrenceId: `query#0:${multiHopRelation}`,
        readRelationId: multiHopRelation,
        sqlSourceId: "task:103230:slot:query",
        statementIndex: 0,
        relationPath: [multiHopRelation],
      },
    });
    const facts = load("103230", {
      "statements.jsonl": [
        {
          statement_id: "task:103230:slot:query:statement:0",
          statement_index: 0,
        },
      ],
      "relation-nodes.jsonl": [
        readNode({
          taskId: "103230",
          relationId: factsRelation,
          table: tableName,
          occurrenceId: factsRelation,
        }),
      ],
      "dataset-io.jsonl": [
        uniqueReadIo("103230", tableName, factsRelation, factsRelation),
      ],
    });
    const result = normalizeReadScopes(
      {
        rootTaskId: "176827",
        status: "COMPLETE_OBSERVED_EVIDENCE",
        branches: [branch],
        boundaryGapRefs: [],
        coverage: {
          sourceArtifactType: "test",
          sourceCoverageStatus: "COMPLETE_OBSERVED_EVIDENCE",
          sourceCoverageSemantics: null,
          sourceLimitsTruncated: false,
        },
      },
      () => facts,
      { canonicalizePlaceholderOccurrences: true },
    );
    expect(result.branches[0]?.readOccurrence?.occurrenceId).toBe(
      factsRelation,
    );
    expect(result.branches[0]?.readOccurrence?.readRelationId).toBe(
      "root.a.tmp_ref_instrument.a.read.d_ref_instrument",
    );
  });

  it("lets a CAST nested VALUE_FLOW hop become reachable after read-scope normalization", () => {
    const read = "task:181058:statement:0:relation:root.casttable.evt.(child).read.toe";
    const child = "task:181058:statement:0:relation:root.casttable.evt.(child).project";
    const rootRel = "task:181058:statement:0:relation:root.project";
    const table = "pdata_n.t05_otc_comp_dura_chg_evt";
    const occurrenceId = `query#0:${read}`;
    const facts = load("181058", {
      "statements.jsonl": [
        { statement_id: "task:181058:slot:query:statement:0", statement_index: 0 },
      ],
      "relation-nodes.jsonl": [
        readNode({ taskId: "181058", relationId: read, table, occurrenceId }),
        { relation_id: child, statement_id: "task:181058:slot:query:statement:0" },
        { relation_id: rootRel, statement_id: "task:181058:slot:query:statement:0" },
      ],
      "relation-edges.jsonl": [
        { from_relation_id: read, to_relation_id: child },
        { from_relation_id: child, to_relation_id: rootRel },
      ],
      "dataset-io.jsonl": [uniqueReadIo("181058", table, occurrenceId, read)],
    });
    const root = producer({
      candidateBranchId: "branch:root",
      branchKind: "ROOT_WRITE",
      consumerTaskId: null,
      producerTaskId: "181058",
      table: null,
      readOccurrence: null,
      writeObservationId: "write-observation:181058:1",
    });
    const nested = producer({ candidateBranchId: "branch:cast" });
    const universe = normalizeReadScopes(
      {
        rootTaskId: "181058",
        status: "COMPLETE_OBSERVED_EVIDENCE",
        branches: [root, nested],
        boundaryGapRefs: [],
        coverage: {
          sourceArtifactType: "test",
          sourceCoverageStatus: "COMPLETE_OBSERVED_EVIDENCE",
          sourceCoverageSemantics: null,
          sourceLimitsTruncated: false,
        },
      },
      () => facts,
    );
    const result = buildCausalClosure({
      targetWriteId: "write",
      rootTaskId: "181058",
      universe,
      summaries: new Map([
        [
          relationSummaryKey("181058", "task:181058:slot:query", 0, rootRel),
          {
            taskId: "181058",
            sqlSourceId: "task:181058:slot:query",
            statementIndex: 0,
            rootRelationId: rootRel,
            digest: "d",
            complete: true,
            readImpacts: [],
            relationCount: 0,
            readCount: 0,
            edgeCount: 0,
            gaps: [],
          },
        ],
      ]),
      fieldValueProvider: {
        scanCount: 1,
        edgeCount: 1,
        lookup: (value) => ({
          candidateBranchId: value.candidateBranchId,
          status: "CONFIRMED",
          affectedTargetFields: ["busi_date"],
          outputFieldBindingIds: ["b"],
          evidenceRefs: ["field-lineage:e"],
          gapRefs: [],
        }),
      },
      rootWriteScope: {
        taskId: "181058",
        writeObservationId: "write-observation:181058:1",
        sqlSourceId: "task:181058:slot:query",
        statementOrdinal: 0,
        rootRelationId: rootRel,
      },
    });
    const assessment = result.assessments.find((item) => item.candidateBranchId === "branch:cast");
    expect(result.graph.reachableBranchIds).toContain("branch:cast");
    expect(assessment?.channelAssessments.find((item) => item.channel === "FIELD_VALUE")?.status).toBe(
      "CONFIRMED",
    );
  });

  it("extends relationPath through LEFT JOIN ancestors for downstream 档三 assessment", () => {
    const driver = "task:181058:statement:0:relation:root.read.driver";
    const dim = "task:181058:statement:0:relation:root.read.dim";
    const join = "task:181058:statement:0:relation:root.join.dim";
    const project = "task:181058:statement:0:relation:root.project";
    const table = "pdata_n.t03_agt_rela_h";
    const occurrenceId = "query#0:root.read.dim";
    const facts = load("181058", {
      "statements.jsonl": [
        { statement_id: "task:181058:slot:query:statement:0", statement_index: 0 },
      ],
      "relation-nodes.jsonl": [
        readNode({ taskId: "181058", relationId: driver, table: "db.fact", occurrenceId: "query#0:root.read.driver" }),
        readNode({ taskId: "181058", relationId: dim, table, occurrenceId }),
        {
          relation_id: join,
          statement_id: "task:181058:slot:query:statement:0",
          relation_type: "join",
          relation: { id: join, type: "join", join_type: "LEFT", left: driver, right: dim },
        },
        { relation_id: project, statement_id: "task:181058:slot:query:statement:0", relation_type: "project", relation: { id: project, type: "project" } },
      ],
      "relation-edges.jsonl": [
        { from_relation_id: driver, to_relation_id: join },
        { from_relation_id: dim, to_relation_id: join },
        { from_relation_id: join, to_relation_id: project },
      ],
      "dataset-io.jsonl": [uniqueReadIo("181058", table, occurrenceId, dim)],
    });
    const dimBranch = producer({
      candidateBranchId: "branch:dim",
      consumerTaskId: "181058",
      producerTaskId: "105388",
      table: physicalTable(table),
      readOccurrence: {
        occurrenceId,
        readRelationId: "root.read.dim",
        statementIndex: 0,
        relationPath: ["root.read.dim"],
      },
      writeObservationId: "write:105388",
      writeScope: { sqlSourceId: "task:105388", statementOrdinal: 0, rootRelationId: "task:105388:root" },
    });
    const enriched = enrichRelationPathFromFacts(facts, dimBranch, dimBranch.readOccurrence!);
    expect(enriched.length).toBeGreaterThan(1);
    expect(enriched.some((value) => /join/i.test(value))).toBe(true);

    const summarized = summarizeTaskRelations({
      taskId: "181058",
      sqlSourceId: "task:181058:slot:query",
      statementIndex: 0,
      rootRelationId: project,
      relationRecords: facts.records["relation-nodes.jsonl"] ?? [],
      relationEdgeRecords: facts.records["relation-edges.jsonl"] ?? [],
      statementRecords: facts.records["statements.jsonl"] ?? [],
    });
    const universe = normalizeReadScopes(
      {
        rootTaskId: "181058",
        status: "COMPLETE_OBSERVED_EVIDENCE",
        branches: [dimBranch],
        boundaryGapRefs: [],
        coverage: {
          sourceArtifactType: "test",
          sourceCoverageStatus: "COMPLETE_OBSERVED_EVIDENCE",
          sourceCoverageSemantics: null,
          sourceLimitsTruncated: false,
        },
      },
      () => facts,
    );
    const branch = universe.branches[0]!;
    const assessment = assessBranch({
      targetWriteId: "write:181058",
      branch,
      universeComplete: true,
      summary: summarized,
      fieldValueProvider: {
        scanCount: 0,
        edgeCount: 0,
        lookup: (value) => ({
          candidateBranchId: value.candidateBranchId,
          status: "NOT_APPLICABLE",
          affectedTargetFields: [],
          outputFieldBindingIds: [],
          evidenceRefs: [],
          gapRefs: [],
        }),
      },
    });
    expect(assessment.channelAssessments.find((channel) => channel.channel === "MULTIPLICITY")?.status).toBe(
      "CONFIRMED",
    );
    const report = buildShrinkReport({ branches: [branch], assessments: [assessment] });
    expect(report.multiplicityRisk.map((entry) => entry.taskId)).toEqual(["105388"]);
  });
});
