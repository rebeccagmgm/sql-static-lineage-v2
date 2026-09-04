import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { Schema } from "sqllens";
import {
  MACHINE_FACTS_CONTRACT_VERSION,
  sha256,
} from "../../scripts/machine-facts/machine-facts-contract.ts";
import * as planAdapter from "../../scripts/plans/plan-adapter.ts";
import type { CurrentBundleLoad } from "../../scripts/query/current-task-bundle.ts";
import * as semanticNormalizer from "../../scripts/reconcile/consumer/target-field-causal-slice/semantic-dependency-normalizer.ts";
import { buildWriteScopedPlans } from "../../scripts/reconcile/consumer/target-field-causal-slice/write-scoped-plan-builder.ts";
import type { RootCriterion } from "../../scripts/reconcile/consumer/target-field-causal-slice/write-scoped-plan-inputs.ts";

const TASK_ID = "task-plan-builder";
const TARGET_TABLE_KEY = "hive|warehouse|mart.target";
const STATEMENT_ID = `task:${TASK_ID}:statement:1`;
const STATEMENT_INDEX = 1;
const WRITE_OBSERVATION_ID = `write-observation:${TASK_ID}:1`;
const LOCAL_ROOT_RELATION_ID = "root.project";
const ROOT_RELATION_ID = `task:${TASK_ID}:statement:${STATEMENT_INDEX}:relation:${LOCAL_ROOT_RELATION_ID}`;
const AMOUNT_EXPRESSION_ID = `${ROOT_RELATION_ID}:expression:project_expression:0`;
const IGNORED_EXPRESSION_ID = `${ROOT_RELATION_ID}:expression:project_expression:1`;

const SQL = [
  "INSERT OVERWRITE TABLE mart.target",
  "SELECT a AS amount, b AS ignored FROM mart.source_a;",
  "INSERT OVERWRITE TABLE mart.target",
  "SELECT c AS amount, d AS ignored FROM mart.source_b;",
].join("\n");
const SQL_SHA256 = sha256(SQL);
const SQL_SOURCE_ID = `sql:${TASK_ID}:${SQL_SHA256}`;
const SQL_SNAPSHOT = `snapshots/sql/${SQL_SHA256}.sql`;

const schema = new Schema({
  mart: {
    target: { amount: "string", ignored: "string" },
    source_a: { a: "string", b: "string" },
    source_b: { c: "string", d: "string" },
  },
});

const roots: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function fixture(): {
  readonly load: CurrentBundleLoad;
  readonly fixtureRoot: string;
  readonly snapshotPath: string;
} {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "write-scoped-plan-builder-"));
  roots.push(fixtureRoot);
  const factsRoot = join(fixtureRoot, "facts");
  mkdirSync(factsRoot, { recursive: true });
  const snapshotPath = join(factsRoot, ...SQL_SNAPSHOT.split("/"));
  mkdirSync(join(snapshotPath, ".."), { recursive: true });
  writeFileSync(snapshotPath, SQL, "utf8");
  return {
    fixtureRoot,
    snapshotPath,
    load: {
      state: "CURRENT_L1",
      factsRoot,
      taskId: TASK_ID,
      bundleDir: join(factsRoot, "registry", "tasks", TASK_ID, "bundle"),
      indexPath: join(factsRoot, "registry", "current-task-facts.jsonl"),
      statusPath: join(factsRoot, "registry", "tasks", TASK_ID, "status.json"),
      manifest: {
        schema_version: "2.0.0",
        task_id: TASK_ID,
        logical_source_id: "machine-source",
        status: "SUCCESS",
        inputs: {
          sql_sha256: SQL_SHA256,
          sql_snapshot: SQL_SNAPSHOT,
        },
        method: {
          dialect: "databricks",
          parser: { engine: "antlr", version: "fixture" },
          adapter: { name: "machine-facts-writer", version: "fixture" },
          plan_adapter: { name: "plan-adapter", version: "fixture" },
        },
      },
      records: {},
      evidence: {
        "manifest.json": "machine-facts:manifest",
        "source-artifact.json": "machine-facts:source-artifact",
      },
      issues: [],
    },
  };
}

function criterion(
  targetFieldName: "amount" | "ignored",
  overrides: Partial<RootCriterion> = {},
): RootCriterion {
  const ordinal = targetFieldName === "amount" ? 0 : 1;
  const expressionId =
    targetFieldName === "amount" ? AMOUNT_EXPRESSION_ID : IGNORED_EXPRESSION_ID;
  const localExpressionId = `${LOCAL_ROOT_RELATION_ID}:expression:project_expression:${ordinal}`;
  return {
    rootCriterionId: `root-criterion:${targetFieldName}`,
    rootTaskId: TASK_ID,
    targetTableKey: TARGET_TABLE_KEY,
    targetFieldName,
    rootTargetFieldId: `hive|warehouse|stable-target|mart.target|${targetFieldName}`,
    targetFieldBindingId: `field:machine-source:mart.target.${targetFieldName}`,
    rootWriteObservationId: WRITE_OBSERVATION_ID,
    writeKind: "INSERT_OVERWRITE",
    sqlSourceId: SQL_SOURCE_ID,
    sqlSnapshot: SQL_SNAPSHOT,
    sqlSha256: SQL_SHA256,
    writeStatementId: STATEMENT_ID,
    writeStatementIndex: STATEMENT_INDEX,
    statementId: STATEMENT_ID,
    statementIndex: STATEMENT_INDEX,
    queryProducerStatementId: STATEMENT_ID,
    rootRelationId: ROOT_RELATION_ID,
    outputExpressionId: expressionId,
    outputBindingId: `output-binding:${TASK_ID}:1:${ordinal}`,
    sourceOrdinal: ordinal,
    targetOrdinal: ordinal,
    producerOutputName: targetFieldName,
    expressionRole: "PROJECT_EXPRESSION",
    localRootRelationId: LOCAL_ROOT_RELATION_ID,
    localOutputExpressionId: localExpressionId,
    evidenceRefs: [
      SQL_SOURCE_ID,
      WRITE_OBSERVATION_ID,
      STATEMENT_ID,
      ROOT_RELATION_ID,
      expressionId,
    ],
    ...overrides,
  };
}

function expectBlockingGap(
  value: ReturnType<typeof buildWriteScopedPlans>,
  reasonCode: string,
  root: RootCriterion,
): void {
  expect(value.plans).toEqual([]);
  expect(value.gaps).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        reasonCode,
        rootCriterionId: root.rootCriterionId,
        writeObservationId: root.rootWriteObservationId,
        targetFieldName: root.targetFieldName,
        blocksConfirmedCausality: true,
        blocksNegativeProof: true,
        evidenceRefs: expect.arrayContaining([
          root.sqlSourceId,
          "machine-facts:manifest",
        ]),
      }),
    ]),
  );
}

describe("write-scoped Plan builder", () => {
  it("builds the exact immutable statement and preserves global/local occurrence roundtrips", () => {
    const { load } = fixture();
    const root = criterion("amount");

    const result = buildWriteScopedPlans({
      rootCriteria: [root],
      load,
      schema,
    });

    expect(result.gaps).toEqual([]);
    expect(result.plans).toHaveLength(1);
    const built = result.plans[0]!;
    expect(built).toMatchObject({
      sqlSourceId: SQL_SOURCE_ID,
      statementId: STATEMENT_ID,
      statementIndex: STATEMENT_INDEX,
      rootCriteria: [
        expect.objectContaining({
          localRootRelationId: LOCAL_ROOT_RELATION_ID,
          localOutputExpressionId: `${LOCAL_ROOT_RELATION_ID}:expression:project_expression:0`,
        }),
      ],
    });
    expect(built.plan.meta.statement_index).toBe(STATEMENT_INDEX);
    expect(built.plan.roots).toEqual([LOCAL_ROOT_RELATION_ID]);
    expect(built.plan.physical_inputs).toContain("mart.source_b");
    expect(built.plan.physical_inputs).not.toContain("mart.source_a");
    const localRoot = built.plan.relations.find(
      (relation) => relation.id === built.plan.roots[0],
    );
    expect(localRoot).toMatchObject({
      id: LOCAL_ROOT_RELATION_ID,
      type: "project",
      output_columns: ["amount", "ignored"],
    });
    if (!localRoot || localRoot.type !== "project")
      throw new Error("fixture root must be a project relation");
    const localExpression = localRoot.expressions[root.sourceOrdinal];
    expect(localExpression).toMatchObject({
      output: root.producerOutputName,
      expr_text: "c AS amount",
      input_columns: [
        expect.objectContaining({
          physical: [
            expect.objectContaining({
              table: "mart.source_b",
              column: "c",
            }),
          ],
        }),
      ],
    });
    expect(localExpression?.span.start).toBeGreaterThan(
      SQL.indexOf("mart.source_a"),
    );
    expect(
      `task:${TASK_ID}:statement:${built.statementIndex}:relation:${localRoot.id}`,
    ).toBe(root.rootRelationId);
    expect(localRoot.id).toBe(root.localRootRelationId);
    expect(
      `${root.rootRelationId}:expression:project_expression:${root.sourceOrdinal}`,
    ).toBe(root.outputExpressionId);
    expect(
      `${localRoot.id}:expression:${root.expressionRole.toLowerCase()}:${root.sourceOrdinal}`,
    ).toBe(root.localOutputExpressionId);
  });

  it("builds from the active publisher contract when the reader labels it legacy", () => {
    const { load } = fixture();
    const root = criterion("amount");
    const activeLegacy: CurrentBundleLoad = {
      ...load,
      state: "LEGACY_NOT_L1",
      manifest: {
        ...load.manifest,
        schema_version: MACHINE_FACTS_CONTRACT_VERSION,
      },
    };

    const result = buildWriteScopedPlans({
      rootCriteria: [root],
      load: activeLegacy,
      schema,
    });

    expect(result.gaps).toEqual([]);
    expect(result.plans).toEqual([
      expect.objectContaining({
        sqlSourceId: SQL_SOURCE_ID,
        statementId: STATEMENT_ID,
        rootCriteria: [root],
      }),
    ]);
  });

  it("reuses one Plan build for multiple target fields in the same statement scope", () => {
    const { load } = fixture();
    const buildPlan = vi.spyOn(planAdapter, "buildPlanFacts");
    const amount = criterion("amount");
    const ignored = criterion("ignored");

    const result = buildWriteScopedPlans({
      rootCriteria: [ignored, amount],
      load,
      schema,
    });

    expect(result.gaps).toEqual([]);
    expect(result.plans).toHaveLength(1);
    expect(result.plans[0]?.rootCriteria).toEqual(
      expect.arrayContaining([amount, ignored]),
    );
    expect(buildPlan).toHaveBeenCalledTimes(1);
  });

  it("keeps a valid field but blocks a mismatched sibling criterion in the shared Plan", () => {
    const { load } = fixture();
    const buildPlan = vi.spyOn(planAdapter, "buildPlanFacts");
    const normalize = vi.spyOn(
      semanticNormalizer,
      "normalizeSemanticDependencies",
    );
    const amount = criterion("amount");
    const ignored = criterion("ignored", {
      localOutputExpressionId: `${LOCAL_ROOT_RELATION_ID}:expression:project_expression:9`,
      outputExpressionId: `${ROOT_RELATION_ID}:expression:project_expression:9`,
    });

    const result = buildWriteScopedPlans({
      rootCriteria: [ignored, amount],
      load,
      schema,
    });

    expect(result.plans).toHaveLength(1);
    expect(result.plans[0]?.rootCriteria).toEqual([amount]);
    expect(result.plans[0]?.rootCriteria).not.toContain(ignored);
    expect(result.gaps).toEqual([
      expect.objectContaining({
        reasonCode: "PLAN_SCOPE_MISMATCH",
        rootCriterionId: ignored.rootCriterionId,
        writeObservationId: ignored.rootWriteObservationId,
        targetFieldName: ignored.targetFieldName,
        blocksConfirmedCausality: true,
        blocksNegativeProof: true,
        evidenceRefs: expect.arrayContaining([
          ignored.sqlSourceId,
          "machine-facts:manifest",
        ]),
      }),
    ]);
    expect(buildPlan).toHaveBeenCalledTimes(1);
    expect(normalize).not.toHaveBeenCalled();
  });

  it.each([
    [
      "an out-of-range statement index",
      "PLAN_STATEMENT_MISSING",
      { statementIndex: 99 },
    ],
    [
      "an existing but wrong statement index",
      "PLAN_SCOPE_MISMATCH",
      { statementIndex: 0 },
    ],
    [
      "a mismatched root relation",
      "PLAN_SCOPE_MISMATCH",
      { rootRelationId: `${ROOT_RELATION_ID}:wrong` },
    ],
    [
      "a mismatched output expression",
      "PLAN_SCOPE_MISMATCH",
      {
        outputExpressionId: `${ROOT_RELATION_ID}:expression:project_expression:9`,
      },
    ],
  ])("blocks %s without normalization", (_label, reasonCode, overrides) => {
    const { load } = fixture();
    const normalize = vi.spyOn(
      semanticNormalizer,
      "normalizeSemanticDependencies",
    );
    const root = criterion("amount", overrides);

    const result = buildWriteScopedPlans({
      rootCriteria: [root],
      load,
      schema,
    });

    expectBlockingGap(result, reasonCode, root);
    expect(normalize).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "a missing current snapshot",
      reasonCode: "SQL_SNAPSHOT_MISSING_OR_UNSAFE",
      prepare: ({ load }: ReturnType<typeof fixture>) => {
        const missing = "snapshots/sql/missing.sql";
        (load.manifest!.inputs as Record<string, unknown>).sql_snapshot =
          missing;
        return criterion("amount", { sqlSnapshot: missing });
      },
    },
    {
      label: "a real snapshot outside factsRoot",
      reasonCode: "SQL_SNAPSHOT_MISSING_OR_UNSAFE",
      prepare: ({ load, fixtureRoot }: ReturnType<typeof fixture>) => {
        writeFileSync(join(fixtureRoot, "outside.sql"), SQL, "utf8");
        const unsafe = "../outside.sql";
        (load.manifest!.inputs as Record<string, unknown>).sql_snapshot =
          unsafe;
        return criterion("amount", { sqlSnapshot: unsafe });
      },
    },
    {
      label: "tampered snapshot bytes with unchanged canonical metadata",
      reasonCode: "SQL_SNAPSHOT_HASH_MISMATCH",
      prepare: ({ snapshotPath }: ReturnType<typeof fixture>) => {
        writeFileSync(snapshotPath, `${SQL}\n-- tampered`, "utf8");
        return criterion("amount");
      },
    },
    {
      label: "a self-consistent alternate snapshot not named by the manifest",
      reasonCode: "SQL_SNAPSHOT_MISSING_OR_UNSAFE",
      prepare: ({ load }: ReturnType<typeof fixture>) => {
        const alternateSql = `${SQL}\n-- alternate but not canonical`;
        const alternateHash = sha256(alternateSql);
        const alternateSnapshot = `snapshots/sql/${alternateHash}.sql`;
        const alternatePath = join(
          load.factsRoot,
          ...alternateSnapshot.split("/"),
        );
        mkdirSync(join(alternatePath, ".."), { recursive: true });
        writeFileSync(alternatePath, alternateSql, "utf8");
        return criterion("amount", {
          sqlSnapshot: alternateSnapshot,
          sqlSha256: alternateHash,
          sqlSourceId: `sql:${TASK_ID}:${alternateHash}`,
        });
      },
    },
  ])(
    "blocks $label before Plan build or normalization",
    ({ reasonCode, prepare }) => {
      const context = fixture();
      const buildPlan = vi.spyOn(planAdapter, "buildPlanFacts");
      const normalize = vi.spyOn(
        semanticNormalizer,
        "normalizeSemanticDependencies",
      );
      const root = prepare(context);

      const result = buildWriteScopedPlans({
        rootCriteria: [root],
        load: context.load,
        schema,
      });

      expectBlockingGap(result, reasonCode, root);
      expect(buildPlan).not.toHaveBeenCalled();
      expect(normalize).not.toHaveBeenCalled();
    },
  );
});
