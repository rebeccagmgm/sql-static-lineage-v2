import { describe, expect, it } from "vitest";

import type {
  PlanFacts,
  PlanRelation,
} from "../../scripts/plans/plan-contract.ts";
import {
  globalExpressionId,
  globalRelationId,
} from "../../scripts/machine-facts/plan-occurrence-id.ts";
import {
  makeSemanticOccurrenceScope,
  type SemanticOccurrenceScope,
} from "../../scripts/reconcile/consumer/target-field-causal-slice/semantic-dependency-contract.ts";
import { normalizeSemanticDependencies } from "../../scripts/reconcile/consumer/target-field-causal-slice/semantic-dependency-normalizer.ts";
import type { RootCriterion } from "../../scripts/reconcile/consumer/target-field-causal-slice/write-scoped-plan-inputs.ts";

const TASK_ID = "task-semantic-scope";
const ROOT_TARGET_FIELD_ID = "hive|warehouse|stable-target|mart.target|amount";
const TARGET_FIELD_BINDING_ID = "field:machine-source:mart.target.amount";
const LOCAL_ROOT_RELATION_ID = "root.project";
const LOCAL_OUTPUT_EXPRESSION_ID = `${LOCAL_ROOT_RELATION_ID}:expression:project_expression:0`;
const span = { start: 0, end: 40 };

function read(): PlanRelation {
  return {
    id: "root.read.source",
    type: "read",
    span,
    provenance: "extracted",
    output_columns: ["amount"],
    read_occurrence_id: "root.read.source:occurrence",
    read_occurrence: {
      occurrence_id: "root.read.source:occurrence",
      relation_id: "root.read.source",
      scope_id: "root",
      source_span: span,
    },
    table: "mart.source",
    binding: "source",
    columns: ["amount"],
  };
}

function plan(statementIndex: number): PlanFacts {
  return {
    meta: {
      contract_version: "1.4.0",
      adapter_version: "test",
      parser: { engine: "test", version: "1" },
      dialect: "databricks",
      statement_index: statementIndex,
      generated_at: "1970-01-01T00:00:00.000Z",
    },
    roots: [LOCAL_ROOT_RELATION_ID],
    relations: [
      read(),
      {
        id: "root.filter",
        type: "filter",
        clause: "where",
        source: "root.read.source",
        span,
        provenance: "extracted",
        output_columns: ["amount"],
        predicate_expr: "amount > 0",
        predicate_display: "amount > 0",
        predicate_columns: [
          {
            name: "amount",
            clause: "where",
            physical: [
              { table: "mart.source", column: "amount" },
              { table: "mart.missing", column: "amount" },
            ],
          },
        ],
        predicate_tree: {
          kind: "ATOM",
          operator: "GT",
          operands: [],
          span,
        },
      },
      {
        id: LOCAL_ROOT_RELATION_ID,
        type: "project",
        source: "root.filter",
        span,
        provenance: "extracted",
        output_columns: ["amount"],
        expressions: [
          {
            output: "amount",
            output_name_status: "EXPLICIT",
            expr_kind: "column",
            expr_text: "amount",
            display_text: "amount",
            span,
            input_columns: [
              {
                name: "amount",
                clause: "projection",
                physical: [{ table: "mart.source", column: "amount" }],
              },
            ],
          },
        ],
      },
    ],
    physical_inputs: ["mart.source"],
    unknowns: [],
    lineage_hops: { roots: [], nodes: [], edges: [] },
  };
}

function rootCriterion(writeOrdinal: number): RootCriterion {
  const statementIndex = writeOrdinal;
  const statementId = `task:${TASK_ID}:statement:${statementIndex}`;
  const rootRelationId = globalRelationId(
    TASK_ID,
    statementIndex,
    LOCAL_ROOT_RELATION_ID,
  );
  const outputExpressionId = globalExpressionId(
    TASK_ID,
    statementIndex,
    LOCAL_OUTPUT_EXPRESSION_ID,
  );
  const writeObservationId = `write-observation:${TASK_ID}:${writeOrdinal}`;
  return {
    rootCriterionId: `root-criterion:${writeObservationId}:amount`,
    rootTaskId: TASK_ID,
    targetTableKey: "hive|warehouse|mart.target",
    targetFieldName: "amount",
    rootTargetFieldId: ROOT_TARGET_FIELD_ID,
    targetFieldBindingId: TARGET_FIELD_BINDING_ID,
    rootWriteObservationId: writeObservationId,
    writeKind: "INSERT_OVERWRITE",
    sqlSourceId: "sql:task-semantic-scope:fixture",
    sqlSnapshot: "snapshots/sql/fixture.sql",
    sqlSha256: "fixture",
    writeStatementId: statementId,
    writeStatementIndex: statementIndex,
    statementId,
    statementIndex,
    queryProducerStatementId: statementId,
    rootRelationId,
    outputExpressionId,
    outputBindingId: `output-binding:${TASK_ID}:${writeOrdinal}:0`,
    sourceOrdinal: 0,
    targetOrdinal: 0,
    producerOutputName: "amount",
    expressionRole: "PROJECT_EXPRESSION",
    localRootRelationId: LOCAL_ROOT_RELATION_ID,
    localOutputExpressionId: LOCAL_OUTPUT_EXPRESSION_ID,
    evidenceRefs: [
      writeObservationId,
      statementId,
      rootRelationId,
      outputExpressionId,
    ],
  };
}

function normalize(root: RootCriterion, scope: SemanticOccurrenceScope) {
  return normalizeSemanticDependencies({
    plan: plan(root.statementIndex),
    rootCriterion: root,
    semanticScope: scope,
    physicalFieldResolver: ({ table, column }) =>
      table === "mart.source"
        ? {
            platform: "hive",
            dataSource: "warehouse",
            stableTableId: "stable-source",
            qualifiedName: table,
            column,
            identityStatus: "SCHEMA_BACKED",
          }
        : null,
  });
}

function ids<T, K extends keyof T>(values: readonly T[], key: K): string[] {
  return values.map((value) => String(value[key])).sort();
}

function expectDisjoint(left: readonly string[], right: readonly string[]) {
  expect(left.filter((value) => new Set(right).has(value))).toEqual([]);
}

describe("semantic occurrence scope", () => {
  it("isolates definition, application, edge, and gap identities across sibling writes", () => {
    const rootA = rootCriterion(0);
    const rootB = rootCriterion(1);
    const scopeA = makeSemanticOccurrenceScope({ rootCriterion: rootA });
    const scopeB = makeSemanticOccurrenceScope({ rootCriterion: rootB });
    const resultA = normalize(rootA, scopeA);
    const resultB = normalize(rootB, scopeB);

    expect(scopeA.semanticScopeId).not.toBe(scopeB.semanticScopeId);
    expect(resultA.definitions.length).toBeGreaterThan(0);
    expect(resultA.applications.length).toBeGreaterThan(0);
    expect(resultA.edges.length).toBeGreaterThan(0);
    expect(resultA.gaps.length).toBeGreaterThan(0);
    expect(resultB.definitions.length).toBe(resultA.definitions.length);
    expect(resultB.applications.length).toBe(resultA.applications.length);
    expect(resultB.edges.length).toBe(resultA.edges.length);
    expect(resultB.gaps.length).toBe(resultA.gaps.length);

    expectDisjoint(
      ids(resultA.definitions, "dependencyId"),
      ids(resultB.definitions, "dependencyId"),
    );
    expectDisjoint(
      ids(resultA.applications, "applicationId"),
      ids(resultB.applications, "applicationId"),
    );
    expectDisjoint(ids(resultA.edges, "edgeId"), ids(resultB.edges, "edgeId"));
    expectDisjoint(ids(resultA.gaps, "gapId"), ids(resultB.gaps, "gapId"));

    for (const { root, scope, result } of [
      { root: rootA, scope: scopeA, result: resultA },
      { root: rootB, scope: scopeB, result: resultB },
    ]) {
      for (const definition of result.definitions) {
        const recordScope = definition.semanticScope;
        expect(recordScope).toBeDefined();
        if (!recordScope)
          throw new Error("definition semantic scope is required");
        expect(definition.semanticScopeId).toBe(recordScope.semanticScopeId);
        expect(recordScope).toMatchObject({
          taskId: scope.taskId,
          writeObservationId: scope.writeObservationId,
          statementId: scope.statementId,
          rootRelationId: scope.rootRelationId,
          outputExpressionId: root.outputExpressionId,
          outputBindingId: root.outputBindingId,
          localRelationId: expect.any(String),
          relationId: expect.any(String),
        });
        expect(recordScope.relationId).toBe(
          globalRelationId(
            root.rootTaskId,
            root.statementIndex,
            recordScope.localRelationId,
          ),
        );
        expect(definition).not.toHaveProperty("rootCriterionId");
      }
      for (const record of [
        ...result.applications,
        ...result.edges,
        ...result.gaps,
      ]) {
        const recordScope = record.semanticScope;
        expect(recordScope).toBeDefined();
        if (!recordScope) throw new Error("semantic record scope is required");
        expect(record).toMatchObject({
          rootCriterionId: root.rootCriterionId,
          semanticScopeId: recordScope.semanticScopeId,
          semanticScope: expect.objectContaining({
            taskId: scope.taskId,
            writeObservationId: scope.writeObservationId,
            statementId: scope.statementId,
            rootRelationId: scope.rootRelationId,
            outputExpressionId: root.outputExpressionId,
            outputBindingId: root.outputBindingId,
            localRelationId: expect.any(String),
            relationId: expect.any(String),
          }),
        });
        const localOwner =
          "scopeRelationId" in record
            ? record.scopeRelationId
            : "relationId" in record
              ? record.relationId
              : undefined;
        expect(localOwner).toEqual(expect.any(String));
        if (typeof localOwner !== "string")
          throw new Error("semantic record owning relation is required");
        expect(recordScope.localRelationId).toBe(localOwner);
        expect(recordScope.relationId).toBe(
          globalRelationId(root.rootTaskId, root.statementIndex, localOwner),
        );
      }

      const filterDefinitions = result.definitions.filter(
        (definition) => definition.operatorKind === "FILTER",
      );
      expect(filterDefinitions.length).toBeGreaterThan(0);
      expect(
        filterDefinitions.every(
          (definition) =>
            definition.semanticScope?.localRelationId === "root.filter",
        ),
      ).toBe(true);
      const filterDependencyIds = new Set(
        filterDefinitions.map((definition) => definition.dependencyId),
      );
      const filterApplications = result.applications.filter((item) =>
        filterDependencyIds.has(item.dependencyId),
      );
      expect(filterApplications.length).toBeGreaterThan(0);
      for (const application of filterApplications)
        expect(application).toMatchObject({
          scopeRelationId: "root.filter",
          semanticScope: expect.objectContaining({
            localRelationId: "root.filter",
            relationId: globalRelationId(
              root.rootTaskId,
              root.statementIndex,
              "root.filter",
            ),
            outputExpressionId: root.outputExpressionId,
            outputBindingId: root.outputBindingId,
          }),
        });
      const filterEdges = result.edges.filter((item) =>
        filterDependencyIds.has(item.dependencyId),
      );
      expect(filterEdges.length).toBeGreaterThan(0);
      for (const edge of filterEdges)
        expect(edge).toMatchObject({
          scopeRelationId: "root.filter",
          semanticScope: expect.objectContaining({
            localRelationId: "root.filter",
            relationId: globalRelationId(
              root.rootTaskId,
              root.statementIndex,
              "root.filter",
            ),
            outputExpressionId: root.outputExpressionId,
            outputBindingId: root.outputBindingId,
          }),
        });
      const filterGaps = result.gaps.filter(
        (gap) => gap.operatorKind === "FILTER",
      );
      expect(filterGaps.length).toBeGreaterThan(0);
      for (const gap of filterGaps)
        expect(gap).toMatchObject({
          relationId: "root.filter",
          semanticScope: expect.objectContaining({
            localRelationId: "root.filter",
            relationId: globalRelationId(
              root.rootTaskId,
              root.statementIndex,
              "root.filter",
            ),
            outputExpressionId: root.outputExpressionId,
            outputBindingId: root.outputBindingId,
          }),
        });
    }
  });

  it("keeps definitions root-neutral but keys applications, edges, and gaps by root criterion", () => {
    const root = rootCriterion(0);
    const aliasRoot = {
      ...root,
      rootCriterionId: `${root.rootCriterionId}:alias`,
    };
    const scope = makeSemanticOccurrenceScope({ rootCriterion: root });
    const original = normalize(root, scope);
    const alias = normalize(aliasRoot, scope);

    expect(ids(alias.definitions, "dependencyId")).toEqual(
      ids(original.definitions, "dependencyId"),
    );
    expectDisjoint(
      ids(original.applications, "applicationId"),
      ids(alias.applications, "applicationId"),
    );
    expectDisjoint(ids(original.edges, "edgeId"), ids(alias.edges, "edgeId"));
    expectDisjoint(ids(original.gaps, "gapId"), ids(alias.gaps, "gapId"));
    expect(
      alias.applications.every(
        (item) => item.rootCriterionId === aliasRoot.rootCriterionId,
      ),
    ).toBe(true);
    expect(
      alias.edges.every(
        (item) => item.rootCriterionId === aliasRoot.rootCriterionId,
      ),
    ).toBe(true);
    expect(
      alias.gaps.every(
        (item) => item.rootCriterionId === aliasRoot.rootCriterionId,
      ),
    ).toBe(true);
  });

  it("changes semantic scope identity when one occurrence identity component changes", () => {
    const root = rootCriterion(0);
    const base = makeSemanticOccurrenceScope({ rootCriterion: root });
    const rootVariants: RootCriterion[] = [
      {
        ...root,
        rootWriteObservationId: `${root.rootWriteObservationId}:other`,
      },
      { ...root, sqlSourceId: `${root.sqlSourceId}:other` },
      { ...root, writeStatementId: `${root.writeStatementId}:other` },
      { ...root, statementId: `${root.statementId}:other` },
      { ...root, outputBindingId: `${root.outputBindingId}:other` },
      { ...root, targetFieldBindingId: `${root.targetFieldBindingId}:other` },
    ];

    for (const variant of rootVariants)
      expect(
        makeSemanticOccurrenceScope({ rootCriterion: variant }).semanticScopeId,
      ).not.toBe(base.semanticScopeId);
    expect(
      makeSemanticOccurrenceScope({
        rootCriterion: root,
        localRelationId: "root.read.source",
      }).semanticScopeId,
    ).not.toBe(base.semanticScopeId);
  });

  it("keeps semantic scope identity independent from evidence ordering and additions", () => {
    const root = rootCriterion(0);
    const first = makeSemanticOccurrenceScope({
      rootCriterion: root,
      evidenceRefs: ["evidence:b", "evidence:a"],
    });
    const replay = makeSemanticOccurrenceScope({
      rootCriterion: root,
      evidenceRefs: ["evidence:c", "evidence:a", "evidence:b"],
    });

    expect(replay.semanticScopeId).toBe(first.semanticScopeId);
    expect(first.evidenceRefs).toEqual(["evidence:a", "evidence:b"]);
    expect(replay.evidenceRefs).toEqual([
      "evidence:a",
      "evidence:b",
      "evidence:c",
    ]);
  });

  it.each([
    "statementId",
    "relationId",
    "localRelationId",
    "outputExpressionId",
    "localOutputExpressionId",
    "outputBindingId",
  ] as const)("fails closed when semantic scope lacks %s", (field) => {
    const root = rootCriterion(0);
    const complete = makeSemanticOccurrenceScope({ rootCriterion: root });
    const incomplete = { ...complete } as Record<string, unknown>;
    delete incomplete[field];

    const result = normalize(
      root,
      incomplete as unknown as SemanticOccurrenceScope,
    );

    expect(result.definitions).toEqual([]);
    expect(result.applications).toEqual([]);
    expect(result.edges).toEqual([]);
    expect(result.semanticEdges).toEqual([]);
    expect(result.gaps).toEqual([
      expect.objectContaining({
        reasonCode: "SEMANTIC_SCOPE_INCOMPLETE",
        rootCriterionId: root.rootCriterionId,
        semanticScopeId: null,
        semanticScope: null,
        blocksConfirmedCausality: true,
        blocksNegativeProof: true,
        evidenceRefs: expect.arrayContaining([
          root.rootWriteObservationId,
          root.statementId,
          root.rootRelationId,
          root.outputExpressionId,
        ]),
      }),
    ]);
  });
});
