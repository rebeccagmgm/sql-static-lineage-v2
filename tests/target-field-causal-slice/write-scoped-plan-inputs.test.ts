import { describe, expect, it } from "vitest";

import type {
  CurrentBundleLoad,
  JsonRecord,
} from "../../scripts/query/current-task-bundle.ts";
import { MACHINE_FACTS_CONTRACT_VERSION } from "../../scripts/machine-facts/machine-facts-contract.ts";
import { resolveWriteScopedPlanInputs } from "../../scripts/reconcile/consumer/target-field-causal-slice/write-scoped-plan-inputs.ts";

const TASK_ID = "task-multi-write";
const TARGET_TABLE = "mart.target";
const TARGET_TABLE_KEY = `hive|warehouse|${TARGET_TABLE}`;
const TARGET_FIELD = "amount";
const ROOT_TARGET_FIELD_ID = `hive|warehouse|stable-target|${TARGET_TABLE}|${TARGET_FIELD}`;
const TARGET_FIELD_BINDING_ID = `field:machine-source:${TARGET_TABLE}.${TARGET_FIELD}`;
const SQL_SHA256 = "fixture-sql-sha256";
const SQL_SOURCE_ID = `sql:${TASK_ID}:${SQL_SHA256}`;

const WRITE_A = "write-observation:task-multi-write:0";
const WRITE_B = "write-observation:task-multi-write:1";
const WRITE_STATEMENT_A = `task:${TASK_ID}:slot:insert-a:statement:0`;
const WRITE_STATEMENT_B = `task:${TASK_ID}:slot:insert-b:statement:0`;
const QUERY_STATEMENT_A = `task:${TASK_ID}:slot:query-a:statement:0`;
const QUERY_STATEMENT_B = `task:${TASK_ID}:slot:query-b:statement:0`;
const RELATION_A = `task:${TASK_ID}:statement:1:relation:root.project`;
const RELATION_B = `task:${TASK_ID}:statement:3:relation:root.project`;
const EXPRESSION_A = `${RELATION_A}:expression:project_expression:0`;
const EXPRESSION_B = `${RELATION_B}:expression:project_expression:0`;
const BINDING_A = `output-binding:${TASK_ID}:a:0`;
const BINDING_B = `output-binding:${TASK_ID}:b:0`;
const OTHER_EXPRESSION_A = `${RELATION_A}:expression:project_expression:1`;
const OTHER_BINDING_A = `output-binding:${TASK_ID}:a:1`;

type MachineFactRecords = Record<string, JsonRecord[]>;

function statement(
  statementId: string,
  statementIndex: number,
  statementType: string,
): JsonRecord {
  return {
    statement_id: statementId,
    task_id: TASK_ID,
    statement_index: statementIndex,
    statement_type: statementType,
    span: { start: statementIndex * 100, end: statementIndex * 100 + 90 },
    raw_sql: `-- ${statementId}`,
    parse_status: "SUCCESS",
  };
}

function write(
  writeObservationId: string,
  writeStatementId: string,
  queryProducerStatementId: string,
): JsonRecord {
  return {
    task_id: TASK_ID,
    statement_id: writeStatementId,
    direction: "WRITE",
    dataset_id: `dataset:machine-source:${TARGET_TABLE}`,
    physical_dataset: TARGET_TABLE,
    provenance: "SQL_PARSE",
    resolution_status: "RESOLVED",
    write_observation_id: writeObservationId,
    write_kind: "INSERT_OVERWRITE",
    write_statement_id: writeStatementId,
    query_producer_statement_id: queryProducerStatementId,
    producer_ordinals: [0],
    producer_enumeration_status: "COMPLETE",
    field_producing: true,
  };
}

function relation(relationId: string, statementId: string): JsonRecord {
  return {
    relation_id: relationId,
    task_id: TASK_ID,
    statement_id: statementId,
    relation_type: "project",
    source_span: { start: 0, end: 10 },
    provenance: "SQL_PLAN",
    relation: {
      id: relationId,
      type: "project",
      output_columns: [TARGET_FIELD],
    },
  };
}

function expression(
  expressionId: string,
  relationId: string,
  statementId: string,
  sourceField: string,
): JsonRecord {
  return {
    expression_id: expressionId,
    task_id: TASK_ID,
    statement_id: statementId,
    relation_id: relationId,
    role: "PROJECT_EXPRESSION",
    ordinal: 0,
    output_name: TARGET_FIELD,
    output_name_status: "EXPLICIT",
    expression_text: sourceField,
    display_text: sourceField,
    source_span: { start: 0, end: sourceField.length },
    input_fields: [
      {
        field_id: `field:machine-source:${sourceField}`,
        table: sourceField.split(".").slice(0, -1).join("."),
        column: sourceField.split(".").at(-1),
      },
    ],
    unresolved_input_columns: [],
    input_dependency_status: "PHYSICAL",
    artifact_id: SQL_SOURCE_ID,
  };
}

function binding(
  bindingId: string,
  writeObservationId: string,
  writeStatementId: string,
  queryProducerStatementId: string,
  expressionId: string,
): JsonRecord {
  return {
    binding_id: bindingId,
    task_id: TASK_ID,
    write_observation_id: writeObservationId,
    write_kind: "INSERT_OVERWRITE",
    write_statement_id: writeStatementId,
    query_producer_statement_id: queryProducerStatementId,
    statement_id: writeStatementId,
    expression_id: expressionId,
    target_dataset_id: `dataset:machine-source:${TARGET_TABLE}`,
    target_field_id: TARGET_FIELD_BINDING_ID,
    target_dataset: TARGET_TABLE,
    target_field: TARGET_FIELD,
    source_ordinal: 0,
    target_ordinal: 0,
    binding_method: "EXPLICIT_TARGET_COLUMN_LIST",
    binding_status: "RESOLVED",
    target_schema_status: "MATCH",
    static_partition_columns: [],
    evidence_refs: [SQL_SOURCE_ID, "schema-ref:target"],
    evidence_kind: "SQL_EXPLICIT_WRITE",
  };
}

function machineFacts(): MachineFactRecords {
  return {
    "statements.jsonl": [
      statement(WRITE_STATEMENT_A, 0, "INSERT_OVERWRITE"),
      statement(QUERY_STATEMENT_A, 1, "SELECT"),
      statement(WRITE_STATEMENT_B, 2, "INSERT_OVERWRITE"),
      statement(QUERY_STATEMENT_B, 3, "SELECT"),
    ],
    "dataset-io.jsonl": [
      write(WRITE_A, WRITE_STATEMENT_A, QUERY_STATEMENT_A),
      write(WRITE_B, WRITE_STATEMENT_B, QUERY_STATEMENT_B),
    ],
    "relation-nodes.jsonl": [
      relation(RELATION_A, QUERY_STATEMENT_A),
      relation(RELATION_B, QUERY_STATEMENT_B),
    ],
    "field-expression-nodes.jsonl": [
      expression(
        EXPRESSION_A,
        RELATION_A,
        QUERY_STATEMENT_A,
        "source_a.amount",
      ),
      expression(
        EXPRESSION_B,
        RELATION_B,
        QUERY_STATEMENT_B,
        "source_b.amount",
      ),
    ],
    "output-field-bindings.jsonl": [
      binding(
        BINDING_A,
        WRITE_A,
        WRITE_STATEMENT_A,
        QUERY_STATEMENT_A,
        EXPRESSION_A,
      ),
      binding(
        BINDING_B,
        WRITE_B,
        WRITE_STATEMENT_B,
        QUERY_STATEMENT_B,
        EXPRESSION_B,
      ),
    ],
  };
}

function currentLoad(records: MachineFactRecords): CurrentBundleLoad {
  return {
    state: "CURRENT_L1",
    factsRoot: "facts",
    taskId: TASK_ID,
    bundleDir: `facts/registry/tasks/${TASK_ID}/bundle`,
    indexPath: "facts/registry/current-task-facts.jsonl",
    statusPath: `facts/registry/tasks/${TASK_ID}/status.json`,
    manifest: {
      schema_version: "2.0.0",
      task_id: TASK_ID,
      logical_source_id: "machine-source",
      status: "SUCCESS",
      inputs: {
        sql_sha256: SQL_SHA256,
        sql_snapshot: `snapshots/sql/${SQL_SHA256}.sql`,
      },
    },
    records,
    evidence: {
      "statements.jsonl": "machine-facts:statements",
      "dataset-io.jsonl": "machine-facts:dataset-io",
      "relation-nodes.jsonl": "machine-facts:relation-nodes",
      "field-expression-nodes.jsonl": "machine-facts:field-expressions",
      "output-field-bindings.jsonl": "machine-facts:output-bindings",
      "manifest.json": "machine-facts:manifest",
    },
    issues: [],
  };
}

function resolve(
  records: MachineFactRecords,
  options: {
    readonly writeObservationIds?: readonly string[];
    readonly requestedTargetFields?: readonly string[];
    readonly load?: CurrentBundleLoad;
    readonly resolveRootTargetFieldId?: (
      targetFieldName: string,
      bindingRecord: Readonly<JsonRecord>,
    ) => string | null;
  } = {},
) {
  return resolveWriteScopedPlanInputs({
    taskId: TASK_ID,
    targetTableKey: TARGET_TABLE_KEY,
    writeObservationIds: options.writeObservationIds ?? [WRITE_A, WRITE_B],
    requestedTargetFields: options.requestedTargetFields ?? [],
    load: options.load ?? currentLoad(records),
    resolveRootTargetFieldId:
      options.resolveRootTargetFieldId ??
      ((targetFieldName) =>
        targetFieldName === TARGET_FIELD ? ROOT_TARGET_FIELD_ID : null),
  });
}

describe("write-scoped causal Plan inputs", () => {
  it("creates distinct deterministic root criteria for sibling writes to the same physical field", () => {
    const records = machineFacts();
    const result = resolve(records);
    const byWrite = new Map(
      result.rootCriteria.map((criterion) => [
        criterion.rootWriteObservationId,
        criterion,
      ]),
    );

    expect(result.gaps).toEqual([]);
    expect(result.rootCriteria).toHaveLength(2);
    expect(
      new Set(result.rootCriteria.map((item) => item.rootCriterionId)).size,
    ).toBe(2);
    expect(byWrite.get(WRITE_A)).toMatchObject({
      rootTaskId: TASK_ID,
      targetTableKey: TARGET_TABLE_KEY,
      rootTargetFieldId: ROOT_TARGET_FIELD_ID,
      targetFieldBindingId: TARGET_FIELD_BINDING_ID,
      rootWriteObservationId: WRITE_A,
      sqlSourceId: SQL_SOURCE_ID,
      writeStatementId: WRITE_STATEMENT_A,
      statementId: QUERY_STATEMENT_A,
      statementIndex: 1,
      queryProducerStatementId: QUERY_STATEMENT_A,
      rootRelationId: RELATION_A,
      outputExpressionId: EXPRESSION_A,
      outputBindingId: BINDING_A,
      evidenceRefs: expect.arrayContaining([
        SQL_SOURCE_ID,
        WRITE_A,
        WRITE_STATEMENT_A,
        QUERY_STATEMENT_A,
        RELATION_A,
        EXPRESSION_A,
        BINDING_A,
        TARGET_FIELD_BINDING_ID,
      ]),
    });
    expect(byWrite.get(WRITE_B)).toMatchObject({
      rootTaskId: TASK_ID,
      targetTableKey: TARGET_TABLE_KEY,
      rootTargetFieldId: ROOT_TARGET_FIELD_ID,
      targetFieldBindingId: TARGET_FIELD_BINDING_ID,
      rootWriteObservationId: WRITE_B,
      sqlSourceId: SQL_SOURCE_ID,
      writeStatementId: WRITE_STATEMENT_B,
      statementId: QUERY_STATEMENT_B,
      statementIndex: 3,
      queryProducerStatementId: QUERY_STATEMENT_B,
      rootRelationId: RELATION_B,
      outputExpressionId: EXPRESSION_B,
      outputBindingId: BINDING_B,
      evidenceRefs: expect.arrayContaining([
        SQL_SOURCE_ID,
        WRITE_B,
        WRITE_STATEMENT_B,
        QUERY_STATEMENT_B,
        RELATION_B,
        EXPRESSION_B,
        BINDING_B,
        TARGET_FIELD_BINDING_ID,
      ]),
    });
    for (const siblingRef of [
      WRITE_B,
      WRITE_STATEMENT_B,
      QUERY_STATEMENT_B,
      RELATION_B,
      EXPRESSION_B,
      BINDING_B,
    ])
      expect(byWrite.get(WRITE_A)?.evidenceRefs).not.toContain(siblingRef);
    for (const siblingRef of [
      WRITE_A,
      WRITE_STATEMENT_A,
      QUERY_STATEMENT_A,
      RELATION_A,
      EXPRESSION_A,
      BINDING_A,
    ])
      expect(byWrite.get(WRITE_B)?.evidenceRefs).not.toContain(siblingRef);

    const replay = resolve(records, {
      writeObservationIds: [WRITE_B, WRITE_A],
    });
    const replayByWrite = new Map(
      replay.rootCriteria.map((criterion) => [
        criterion.rootWriteObservationId,
        criterion.rootCriterionId,
      ]),
    );
    expect(replayByWrite.get(WRITE_A)).toBe(
      byWrite.get(WRITE_A)?.rootCriterionId,
    );
    expect(replayByWrite.get(WRITE_B)).toBe(
      byWrite.get(WRITE_B)?.rootCriterionId,
    );
  });

  it("accepts only the active publisher contract when the reader labels a bundle legacy", () => {
    const records = machineFacts();
    const current = currentLoad(records);
    const activeLegacy: CurrentBundleLoad = {
      ...current,
      state: "LEGACY_NOT_L1",
      manifest: {
        ...current.manifest,
        schema_version: MACHINE_FACTS_CONTRACT_VERSION,
      },
    };
    const active = resolve(records, {
      writeObservationIds: [WRITE_A],
      load: activeLegacy,
    });

    expect(active.gaps).toEqual([]);
    expect(active.rootCriteria).toEqual([
      expect.objectContaining({ rootWriteObservationId: WRITE_A }),
    ]);

    const unsupported = resolve(records, {
      writeObservationIds: [WRITE_A],
      load: {
        ...activeLegacy,
        manifest: { ...activeLegacy.manifest, schema_version: "1.2.0" },
      },
    });
    expect(unsupported.rootCriteria).toEqual([]);
    expect(unsupported.gaps).toEqual([
      expect.objectContaining({ reasonCode: "BUNDLE_NOT_CURRENT" }),
    ]);
  });

  it("selects the exact output expression and binding within one write statement", () => {
    const records = machineFacts();
    records["field-expression-nodes.jsonl"]!.push({
      ...expression(
        OTHER_EXPRESSION_A,
        RELATION_A,
        QUERY_STATEMENT_A,
        "source_a.ignored",
      ),
      ordinal: 1,
      output_name: "ignored",
    });
    records["output-field-bindings.jsonl"]!.push({
      ...binding(
        OTHER_BINDING_A,
        WRITE_A,
        WRITE_STATEMENT_A,
        QUERY_STATEMENT_A,
        OTHER_EXPRESSION_A,
      ),
      target_field_id: `field:machine-source:${TARGET_TABLE}.ignored`,
      target_field: "ignored",
      source_ordinal: 1,
      target_ordinal: 1,
    });
    records["relation-nodes.jsonl"] = records["relation-nodes.jsonl"]!.map(
      (item) =>
        item.relation_id === RELATION_A
          ? {
              ...item,
              relation: {
                ...item.relation,
                output_columns: [TARGET_FIELD, "ignored"],
              },
            }
          : item,
    );
    records["dataset-io.jsonl"] = records["dataset-io.jsonl"]!.map((item) =>
      item.write_observation_id === WRITE_A
        ? { ...item, producer_ordinals: [0, 1] }
        : item,
    );

    const result = resolve(records, {
      writeObservationIds: [WRITE_A],
      requestedTargetFields: [TARGET_FIELD],
    });

    expect(result.gaps).toEqual([]);
    expect(result.rootCriteria).toHaveLength(1);
    expect(result.rootCriteria[0]).toMatchObject({
      rootWriteObservationId: WRITE_A,
      targetFieldName: TARGET_FIELD,
      outputExpressionId: EXPRESSION_A,
      outputBindingId: BINDING_A,
    });
    expect(result.rootCriteria[0]?.evidenceRefs).not.toContain(
      OTHER_EXPRESSION_A,
    );
    expect(result.rootCriteria[0]?.evidenceRefs).not.toContain(OTHER_BINDING_A);
  });

  it.each([
    [
      "write observation",
      "WRITE_OBSERVATION_MISSING",
      null,
      "machine-facts:dataset-io",
      (records: MachineFactRecords) => {
        records["dataset-io.jsonl"] = records["dataset-io.jsonl"]!.filter(
          (item) => item.write_observation_id !== WRITE_A,
        );
      },
    ],
    [
      "write statement",
      "WRITE_STATEMENT_MISSING",
      null,
      "machine-facts:statements",
      (records: MachineFactRecords) => {
        records["statements.jsonl"] = records["statements.jsonl"]!.filter(
          (item) => item.statement_id !== WRITE_STATEMENT_A,
        );
      },
    ],
    [
      "query producer statement",
      "QUERY_STATEMENT_MISSING",
      null,
      "machine-facts:statements",
      (records: MachineFactRecords) => {
        records["statements.jsonl"] = records["statements.jsonl"]!.filter(
          (item) => item.statement_id !== QUERY_STATEMENT_A,
        );
      },
    ],
    [
      "owning relation",
      "ROOT_RELATION_MISSING",
      TARGET_FIELD,
      "machine-facts:relation-nodes",
      (records: MachineFactRecords) => {
        records["relation-nodes.jsonl"] = records[
          "relation-nodes.jsonl"
        ]!.filter((item) => item.relation_id !== RELATION_A);
      },
    ],
    [
      "output expression",
      "OUTPUT_EXPRESSION_MISSING",
      TARGET_FIELD,
      "machine-facts:field-expressions",
      (records: MachineFactRecords) => {
        records["field-expression-nodes.jsonl"] = records[
          "field-expression-nodes.jsonl"
        ]!.filter((item) => item.expression_id !== EXPRESSION_A);
      },
    ],
    [
      "output binding",
      "OUTPUT_BINDING_MISSING",
      TARGET_FIELD,
      "machine-facts:output-bindings",
      (records: MachineFactRecords) => {
        records["output-field-bindings.jsonl"] = records[
          "output-field-bindings.jsonl"
        ]!.filter((item) => item.binding_id !== BINDING_A);
      },
    ],
  ])(
    "fails closed when the selected write lacks %s evidence",
    (_label, reasonCode, targetFieldName, expectedEvidenceRef, remove) => {
      const records = machineFacts();
      remove(records);

      const result = resolve(records, {
        writeObservationIds: [WRITE_A],
        requestedTargetFields: [TARGET_FIELD],
      });

      expect(result.rootCriteria).toEqual([]);
      expect(result.gaps).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            reasonCode,
            writeObservationId: WRITE_A,
            targetFieldName,
            blocksConfirmedCausality: true,
            blocksNegativeProof: true,
            evidenceRefs: expect.arrayContaining([expectedEvidenceRef]),
          }),
        ]),
      );
    },
  );

  it.each([
    [
      "the write maps to two producer statements",
      "WRITE_OBSERVATION_CONFLICT",
      null,
      "machine-facts:dataset-io",
      (records: MachineFactRecords) => {
        records["dataset-io.jsonl"]!.push({
          ...write(WRITE_A, WRITE_STATEMENT_A, QUERY_STATEMENT_B),
        });
      },
    ],
    [
      "the write and target field map to two output bindings",
      "OUTPUT_BINDING_CONFLICT",
      TARGET_FIELD,
      "machine-facts:output-bindings",
      (records: MachineFactRecords) => {
        records["output-field-bindings.jsonl"]!.push(
          binding(
            `${BINDING_A}:conflict`,
            WRITE_A,
            WRITE_STATEMENT_A,
            QUERY_STATEMENT_A,
            EXPRESSION_B,
          ),
        );
      },
    ],
    [
      "the output expression belongs to a sibling statement",
      "SCOPE_EVIDENCE_CONTRADICTORY",
      TARGET_FIELD,
      "machine-facts:field-expressions",
      (records: MachineFactRecords) => {
        records["field-expression-nodes.jsonl"] = records[
          "field-expression-nodes.jsonl"
        ]!.map((item) =>
          item.expression_id === EXPRESSION_A
            ? { ...item, statement_id: QUERY_STATEMENT_B }
            : item,
        );
      },
    ],
  ])(
    "fails closed when %s",
    (_label, reasonCode, targetFieldName, expectedEvidenceRef, conflict) => {
      const records = machineFacts();
      conflict(records);

      const result = resolve(records, {
        writeObservationIds: [WRITE_A],
        requestedTargetFields: [TARGET_FIELD],
      });

      expect(result.rootCriteria).toEqual([]);
      expect(result.gaps).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            reasonCode,
            writeObservationId: WRITE_A,
            targetFieldName,
            blocksConfirmedCausality: true,
            blocksNegativeProof: true,
            evidenceRefs: expect.arrayContaining([expectedEvidenceRef]),
          }),
        ]),
      );
    },
  );

  it("keeps a valid sibling write when another requested write fails closed", () => {
    const records = machineFacts();
    records["field-expression-nodes.jsonl"] = records[
      "field-expression-nodes.jsonl"
    ]!.map((item) =>
      item.expression_id === EXPRESSION_A
        ? { ...item, statement_id: QUERY_STATEMENT_B }
        : item,
    );

    const result = resolve(records, {
      requestedTargetFields: [TARGET_FIELD],
    });

    expect(result.rootCriteria).toHaveLength(1);
    expect(result.rootCriteria[0]).toMatchObject({
      rootWriteObservationId: WRITE_B,
      outputExpressionId: EXPRESSION_B,
      outputBindingId: BINDING_B,
    });
    expect(result.gaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reasonCode: "SCOPE_EVIDENCE_CONTRADICTORY",
          writeObservationId: WRITE_A,
          targetFieldName: TARGET_FIELD,
          blocksConfirmedCausality: true,
          blocksNegativeProof: true,
          evidenceRefs: expect.arrayContaining([
            "machine-facts:field-expressions",
          ]),
        }),
      ]),
    );
  });

  it("fails closed when the binding cannot be mapped to one physical root field", () => {
    const result = resolve(machineFacts(), {
      writeObservationIds: [WRITE_A],
      requestedTargetFields: [TARGET_FIELD],
      resolveRootTargetFieldId: () => null,
    });

    expect(result.rootCriteria).toEqual([]);
    expect(result.gaps).toEqual([
      expect.objectContaining({
        reasonCode: "PHYSICAL_ROOT_FIELD_UNRESOLVED",
        writeObservationId: WRITE_A,
        targetFieldName: TARGET_FIELD,
        blocksConfirmedCausality: true,
        blocksNegativeProof: true,
        evidenceRefs: expect.arrayContaining([
          SQL_SOURCE_ID,
          "machine-facts:output-bindings",
        ]),
      }),
    ]);
  });
});
