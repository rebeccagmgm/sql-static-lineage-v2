import {
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { Schema, SqlSession } from "sqllens";
import {
  canonicalJson,
  sha256,
  type GenericAnalysisProfile,
  type GenericTaskProfile,
} from "../../scripts/machine-facts/machine-facts-contract.ts";
import {
  mergeSchemaEvidence,
  rebuildIndex,
  runTask,
} from "../../scripts/machine-facts/machine-facts.ts";
import * as planAdapter from "../../scripts/plans/plan-adapter.ts";
import type { PhysicalFieldIdentity } from "../../scripts/reconcile/consumer/field-lineage/field-lineage-contract.ts";
import { physicalFieldKey } from "../../scripts/reconcile/consumer/field-lineage/field-lineage-contract.ts";
import { loadCurrentTaskBundle } from "../../scripts/query/current-task-bundle.ts";
import {
  makeSemanticOccurrenceScope,
  type ProofRef,
  type SemanticDependencyDefinition,
  type SemanticSubject,
} from "../../scripts/reconcile/consumer/target-field-causal-slice/semantic-dependency-contract.ts";
import {
  normalizeSemanticDependencies,
  type SemanticDependencyNormalization,
} from "../../scripts/reconcile/consumer/target-field-causal-slice/semantic-dependency-normalizer.ts";
import { buildWriteScopedPlans } from "../../scripts/reconcile/consumer/target-field-causal-slice/write-scoped-plan-builder.ts";
import {
  resolveWriteScopedPlanInputs,
  type RootCriterion,
} from "../../scripts/reconcile/consumer/target-field-causal-slice/write-scoped-plan-inputs.ts";
import {
  semanticGoldCases,
  type SemanticGoldCase,
} from "../fixtures/target-field-causal-slice/semantic-gold/cases.ts";

const WORKSPACE = resolve(import.meta.dirname, "../..");
const FIXTURE_SCHEMA_PATH = resolve(
  WORKSPACE,
  "tests/fixtures/target-field-causal-slice/semantic-gold/schema.json",
);
const LOGICAL_SOURCE_ID = "semantic-gold";
const PLATFORM = "hive";
const DATA_SOURCE = "semantic-gold";
const roots: string[] = [];

interface SchemaRecord {
  readonly qualified_name: string;
  readonly status: string;
  readonly guid: string;
  readonly columns: readonly { readonly name: string }[];
}

interface Evaluation {
  readonly projection: unknown;
  readonly projectionBytes: string;
  readonly rootCriteria: readonly RootCriterion[];
  readonly normalizations: readonly SemanticDependencyNormalization[];
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function readSchemaRecords(): readonly SchemaRecord[] {
  const raw = JSON.parse(readFileSync(FIXTURE_SCHEMA_PATH, "utf8")) as {
    readonly records: readonly SchemaRecord[];
  };
  return raw.records;
}

function schemaProvider(records: readonly SchemaRecord[]): Schema {
  return new Schema(
    Object.fromEntries(
      records.map((record) => [
        record.qualified_name,
        Object.fromEntries(record.columns.map((column) => [column.name, "unknown"])),
      ]),
    ),
  );
}

function physicalField(
  records: readonly SchemaRecord[],
  table: string,
  column: string,
): PhysicalFieldIdentity | null {
  const record = records.find(
    (candidate) =>
      candidate.status === "SUCCESS" &&
      candidate.qualified_name.toLowerCase() === table.toLowerCase() &&
      candidate.columns.some(
        (candidateColumn) =>
          candidateColumn.name.toLowerCase() === column.toLowerCase(),
      ),
  );
  return record
    ? {
        platform: PLATFORM,
        dataSource: DATA_SOURCE,
        stableTableId: record.guid,
        qualifiedName: record.qualified_name,
        column,
        identityStatus: "SCHEMA_BACKED",
      }
    : null;
}

function subjectId(subject: SemanticSubject): string {
  return subject.subjectKind === "PHYSICAL_FIELD"
    ? subject.physicalFieldId
    : subject.relationOccurrenceId;
}

function proofProjection(refs: readonly ProofRef[]): readonly object[] {
  return refs
    .filter(
      (ref) =>
        ref.kind !== "CANONICAL_FACT" ||
        ref.refId.startsWith("plan:column:") ||
        ref.refId.startsWith("plan:relation:"),
    )
    .map((ref) => ({
      proofRefId: ref.proofRefId,
      kind: ref.kind,
      refId: ref.refId,
      ...(ref.detail === undefined ? {} : { detail: ref.detail }),
    }));
}

function proofClosureHash(refs: readonly ProofRef[]): string {
  return sha256(canonicalJson(refs));
}

function rootEvidenceProjection(refs: readonly string[]): readonly string[] {
  return refs.filter((ref) =>
    [
      "field:",
      "output-binding:",
      "schema-ref:",
      "sql:",
      "task:",
      "write-observation:",
    ].some((prefix) => ref.startsWith(prefix)),
  );
}

function stableProjection(
  fixture: SemanticGoldCase,
  rootsForCase: readonly RootCriterion[],
  normalizations: readonly SemanticDependencyNormalization[],
): unknown {
  const rootById = new Map(
    rootsForCase.map((root) => [root.rootCriterionId, root]),
  );
  const definitions = new Map<string, SemanticDependencyDefinition>();
  const applications = normalizations.flatMap((result) => result.applications);
  for (const result of normalizations)
    for (const definition of result.definitions)
      definitions.set(definition.dependencyId, definition);

  const dependencies = normalizations
    .flatMap((result) => result.edges)
    .map((edge) => {
      const definition = definitions.get(edge.dependencyId);
      const root = edge.rootCriterionId
        ? rootById.get(edge.rootCriterionId)
        : undefined;
      const application = applications.find(
        (candidate) =>
          candidate.dependencyId === edge.dependencyId &&
          candidate.rootCriterionId === edge.rootCriterionId &&
          candidate.semanticScopeId === edge.semanticScopeId &&
          candidate.scopeRelationId === edge.scopeRelationId,
      );
      if (!definition || !root || !application || !edge.semanticScope)
        throw new Error(`incomplete gold dependency projection for ${edge.edgeId}`);
      return {
        rootCriterionId: root.rootCriterionId,
        rootWriteObservationId: root.rootWriteObservationId,
        rootTargetFieldId: root.rootTargetFieldId,
        dependencyId: edge.dependencyId,
        applicationId: application.applicationId,
        edgeId: edge.edgeId,
        semanticScopeId: edge.semanticScope.semanticScopeId,
        statementId: edge.semanticScope.statementId,
        statementIndex: edge.semanticScope.statementIndex,
        rootRelationId: edge.semanticScope.rootRelationId,
        relationId: edge.semanticScope.relationId,
        outputExpressionId: edge.semanticScope.outputExpressionId,
        outputBindingId: edge.semanticScope.outputBindingId,
        subjectKind: edge.fromSubject.subjectKind,
        subjectId: subjectId(edge.fromSubject),
        targetSubjectKind: edge.toSubject.subjectKind,
        targetSubjectId: subjectId(edge.toSubject),
        operatorKind: definition.operatorKind,
        operatorVariant: definition.operatorVariant,
        operatorRole: definition.operatorRole,
        effectKind: definition.effectKind,
        localEdgeKind: edge.localEdgeKind,
        rootDependenceKind: edge.rootDependenceKind,
        pathCertainty: edge.pathCertainty,
        supportStatus: definition.supportStatus,
        proofRefs: proofProjection(edge.proofRefs),
        proofClosureHash: proofClosureHash(edge.proofRefs),
      };
    })
    .sort((left, right) => left.edgeId.localeCompare(right.edgeId));

  const gaps = normalizations
    .flatMap((result) => result.gaps)
    .map((gap) => {
      const root = gap.rootCriterionId
        ? rootById.get(gap.rootCriterionId)
        : undefined;
      if (!root)
        throw new Error(`incomplete gold gap projection for ${gap.gapId}`);
      return {
        rootCriterionId: root.rootCriterionId,
        rootWriteObservationId: root.rootWriteObservationId,
        rootTargetFieldId: root.rootTargetFieldId,
        gapId: gap.gapId,
        status: gap.status,
        reasonCode: gap.reasonCode,
        operatorKind: gap.operatorKind,
        operatorVariant: gap.operatorVariant,
        operatorRole: gap.operatorRole,
        relationId: gap.relationId,
        semanticScopeId: gap.semanticScopeId,
        statementId: gap.semanticScope?.statementId ?? null,
        statementIndex: gap.semanticScope?.statementIndex ?? null,
        message: gap.message,
        proofRefs: proofProjection(gap.proofRefs),
        proofClosureHash: proofClosureHash(gap.proofRefs),
        blocksConfirmedCausality: gap.blocksConfirmedCausality,
        blocksNegativeProof: gap.blocksNegativeProof,
      };
    })
    .sort((left, right) => left.gapId.localeCompare(right.gapId));

  return {
    fixtureId: fixture.fixtureId,
    partition: fixture.partition,
    roots: rootsForCase
      .map((root) => ({
        rootCriterionId: root.rootCriterionId,
        rootWriteObservationId: root.rootWriteObservationId,
        rootTargetFieldId: root.rootTargetFieldId,
        sqlSourceId: root.sqlSourceId,
        statementId: root.statementId,
        statementIndex: root.statementIndex,
        rootRelationId: root.rootRelationId,
        outputExpressionId: root.outputExpressionId,
        outputBindingId: root.outputBindingId,
        targetFieldBindingId: root.targetFieldBindingId,
        evidenceRefs: rootEvidenceProjection(root.evidenceRefs),
        evidenceClosureHash: sha256(canonicalJson(root.evidenceRefs)),
      }))
      .sort((left, right) =>
        left.rootCriterionId.localeCompare(right.rootCriterionId),
      ),
    dependencies,
    gaps,
  };
}

function evaluate(fixture: SemanticGoldCase): Evaluation {
  const outputRoot = mkdtempSync(join(tmpdir(), "real-sql-semantic-gold-"));
  roots.push(outputRoot);
  const records = readSchemaRecords();
  const schemaBundle = mergeSchemaEvidence(
    [{ records }],
    LOGICAL_SOURCE_ID,
  );
  const schemaBundleHash = sha256(canonicalJson(schemaBundle));
  const task: GenericTaskProfile = {
    task_id: fixture.taskId,
    sql_snapshot: fixture.sqlPath,
    writes: fixture.targetTable,
  };
  const profile: GenericAnalysisProfile = {
    schema_version: "semantic-gold-v1",
    dialect: "databricks",
    logical_source_id: LOGICAL_SOURCE_ID,
    tasks: [task],
  };
  const taskResult = runTask(
    task,
    profile,
    LOGICAL_SOURCE_ID,
    outputRoot,
    schemaBundle,
    schemaBundleHash,
  );
  expect(taskResult).toMatchObject({ state: "SUCCESS", failures: [] });
  expect(rebuildIndex(outputRoot).failures).toEqual([]);

  const load = loadCurrentTaskBundle(outputRoot, fixture.taskId);
  expect(load.issues).toEqual([]);
  const writeObservationIds = (load.records["dataset-io.jsonl"] ?? [])
    .filter(
      (record) =>
        record.direction === "WRITE" &&
        record.physical_dataset === fixture.targetTable &&
        typeof record.write_observation_id === "string",
    )
    .map((record) => String(record.write_observation_id))
    .sort((left, right) => left.localeCompare(right));
  expect(writeObservationIds).toHaveLength(fixture.expectedWriteCount);

  const resolution = resolveWriteScopedPlanInputs({
    taskId: fixture.taskId,
    targetTableKey: `${PLATFORM}|${DATA_SOURCE}|${fixture.targetTable}`,
    writeObservationIds,
    requestedTargetFields: [fixture.targetField],
    load,
    resolveRootTargetFieldId: (targetFieldName, binding) => {
      if (String(binding.target_field).toLowerCase() !== targetFieldName)
        return null;
      const field = physicalField(
        records,
        String(binding.target_dataset),
        targetFieldName,
      );
      return field ? physicalFieldKey(field) : null;
    },
  });
  expect(resolution.gaps).toEqual([]);
  expect(resolution.rootCriteria).toHaveLength(fixture.expectedWriteCount);

  const build = buildWriteScopedPlans({
    rootCriteria: resolution.rootCriteria,
    load,
    schema: schemaProvider(records),
  });
  expect(build.gaps).toEqual([]);
  expect(build.plans).toHaveLength(fixture.expectedWriteCount);

  const normalizations: SemanticDependencyNormalization[] = [];
  for (const built of build.plans)
    for (const root of built.rootCriteria) {
      const semanticScope = makeSemanticOccurrenceScope({
        rootCriterion: root,
        evidenceRefs: root.evidenceRefs,
      });
      normalizations.push(
        normalizeSemanticDependencies({
          plan: built.plan,
          rootCriterion: root,
          localRootCriterion: root,
          semanticScope,
          physicalFieldResolver: ({ table, column }) =>
            physicalField(records, table, column),
        }),
      );
    }

  const projection = stableProjection(
    fixture,
    resolution.rootCriteria,
    normalizations,
  );
  return {
    projection,
    projectionBytes: canonicalJson(projection),
    rootCriteria: resolution.rootCriteria,
    normalizations,
  };
}

describe("real SQL occurrence-scoped semantic gold", () => {
  it.each(semanticGoldCases)(
    "$partition fixture $fixtureId matches its frozen occurrence-scoped gold and replays byte-identically",
    (fixture) => {
      const sqlSession = vi.spyOn(SqlSession, "create");
      const planFacts = vi.spyOn(planAdapter, "buildPlanFacts");
      const actual = evaluate(fixture);
      const replay = evaluate(fixture);
      const expected = readFileSync(
        resolve(WORKSPACE, fixture.expectedGoldPath),
        "utf8",
      ).replaceAll("\r\n", "\n");

      expect(actual.projectionBytes).toBe(expected);
      expect(replay.projectionBytes).toBe(actual.projectionBytes);
      expect(sqlSession).toHaveBeenCalled();
      expect(planFacts).toHaveBeenCalled();

      const dependencies = actual.normalizations.flatMap(
        (result) => result.edges,
      );
      const gaps = actual.normalizations.flatMap((result) => result.gaps);

      for (const expectedWrite of fixture.expectedWrites) {
        const root = actual.rootCriteria.find(
          (candidate) =>
            candidate.rootWriteObservationId ===
            expectedWrite.writeObservationId,
        );
        expect(root).toBeDefined();
        const scopedEdges = dependencies.filter(
          (edge) => edge.rootCriterionId === root?.rootCriterionId,
        );
        if (expectedWrite.requiredValueSubject)
          expect(scopedEdges).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                fromSubject: {
                  subjectKind: "PHYSICAL_FIELD",
                  physicalFieldId: expectedWrite.requiredValueSubject,
                },
                localEdgeKind: "VALUE_FLOW",
                rootDependenceKind: "VALUE_TO_TARGET",
                pathCertainty: "CONFIRMED",
              }),
            ]),
          );
        if (expectedWrite.requiredWhereSubject)
          expect(scopedEdges).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                fromSubject: {
                  subjectKind: "PHYSICAL_FIELD",
                  physicalFieldId: expectedWrite.requiredWhereSubject,
                },
                localEdgeKind: "ROWSET_CONTROL",
                rootDependenceKind: "CONTROL_TO_TARGET",
                pathCertainty: "CONFIRMED",
              }),
            ]),
          );
        const subjects = new Set(scopedEdges.map((edge) => subjectId(edge.fromSubject)));
        for (const forbidden of expectedWrite.forbiddenSubjects)
          expect(subjects).not.toContain(forbidden);
      }

      expect(gaps.map((gap) => gap.reasonCode).sort()).toEqual(
        [...fixture.expectedGapReasons].sort(),
      );
      for (const gap of gaps) {
        expect(gap.blocksConfirmedCausality).toBe(true);
        expect(gap.blocksNegativeProof).toBe(true);
        expect(
          gap.proofRefs.some(
            (proof) =>
              proof.kind === "SOURCE_SPAN" &&
              /:\d+:\d+$/.test(proof.refId),
          ),
        ).toBe(true);
      }
    },
  );
});
