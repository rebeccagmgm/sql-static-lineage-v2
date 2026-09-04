import { normalizeName } from "../../machine-facts/machine-facts-contract.ts";
import type { PhysicalFieldIdentity } from "../../reconcile/consumer/field-lineage/field-lineage-contract.ts";
import type {
  TaskLocalDirectSubtype,
  TaskLocalProjectionGap,
  TaskLocalSubtypeReason,
} from "../task-local/contract.ts";
import { stableId } from "../task-local/ids.ts";
import {
  buildRelationTreeIndex,
  type RelationTreeIndex,
  withIncomingRelations,
} from "./relation-tree.ts";
import {
  classifyExpressionSubtype,
  composePathSubtype,
  type ExpressionSubtypeResult,
} from "./subtype-classifier.ts";
import {
  expandSetopBranchExpressions,
  expressionsByRelationAndOrdinal,
  leafRelationIdForExpression,
  resolveSourceReadOccurrence,
  type FieldExpressionContext,
  type SourceReadOccurrenceResolution,
} from "./source-read-occurrence.ts";

type JsonRecord = Readonly<Record<string, unknown>>;

export interface ExpandedMaterializedField {
  readonly field: PhysicalFieldIdentity;
  readonly materializationBridgeIds: readonly string[];
  readonly leafExpressionId: string | null;
  readonly leafRelationId: string | null;
  readonly pathHadAggregation: boolean;
  readonly subtypeHops: readonly ExpressionSubtypeResult[];
}

export interface FieldEvidenceEmissionInput {
  readonly taskId: string;
  readonly expressions: readonly JsonRecord[];
  readonly relationNodes: readonly JsonRecord[];
  readonly relationEdges: readonly JsonRecord[];
  readonly datasetIoReads: readonly JsonRecord[];
}

export interface FieldEvidenceIndexes {
  readonly relationTree: RelationTreeIndex;
  readonly expressionsByRelation: ReadonlyMap<string, ReadonlyMap<number, JsonRecord>>;
  readonly readOccurrenceByRelationId: ReadonlyMap<string, string>;
  readonly bindingByReadRelation: ReadonlyMap<string, string>;
}

export interface EmittedFieldEvidence {
  readonly expressionContexts: readonly FieldExpressionContext[];
  readonly sourceResolution: SourceReadOccurrenceResolution;
  readonly subtype: TaskLocalDirectSubtype;
  readonly subtypeReason: TaskLocalSubtypeReason | null;
  readonly leafRelationId: string | null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function record(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function relationBody(relation: JsonRecord): JsonRecord {
  return record(relation.relation) ?? relation;
}

export function buildFieldEvidenceIndexes(
  input: FieldEvidenceEmissionInput,
): FieldEvidenceIndexes {
  const relationTree = withIncomingRelations(
    buildRelationTreeIndex(input.relationNodes),
    input.relationEdges,
  );
  const readOccurrenceByRelationId = new Map<string, string>();
  const bindingByReadRelation = new Map<string, string>();
  for (const relation of input.relationNodes) {
    const relationId = text(relation.relation_id);
    if (!relationId) continue;
    if (String(relation.relation_type ?? "").toLowerCase() === "read") {
      const binding = text(relationBody(relation).binding);
      if (binding) bindingByReadRelation.set(relationId, binding);
    }
  }
  for (const read of input.datasetIoReads) {
    if (String(read.direction ?? "").toUpperCase() !== "READ") continue;
    const occurrences = Array.isArray(read.read_occurrences) ? read.read_occurrences : [];
    for (const occurrence of occurrences) {
      const item = record(occurrence);
      const relationId = text(item?.relation_id);
      const occurrenceId = text(item?.occurrence_id) ?? relationId;
      if (relationId && occurrenceId) {
        readOccurrenceByRelationId.set(relationId, occurrenceId);
      }
    }
  }
  return {
    relationTree,
    expressionsByRelation: expressionsByRelationAndOrdinal(input.expressions),
    readOccurrenceByRelationId,
    bindingByReadRelation,
  };
}

export function relationTypeForExpression(
  indexes: FieldEvidenceIndexes,
  relationId: string | null,
): string | null {
  if (!relationId) return null;
  return indexes.relationTree.relations.get(relationId)?.relationType ?? null;
}

/**
 * After setop ordinal sink, only keep sources that the *branch* expression
 * actually lists. Top-level project/setop expressions often union inputs from
 * every branch; pairing those foreign sources with a branch leaf yields false
 * CTE_SCOPE_UNRESOLVED edges.
 */
export function expressionAcceptsSourceField(
  expression: JsonRecord,
  sourceField: PhysicalFieldIdentity,
): boolean {
  const inputFields = Array.isArray(expression.input_fields) ? expression.input_fields : [];
  if (inputFields.length === 0) return false;
  const targetTable = normalizeName(sourceField.qualifiedName);
  const targetColumn = normalizeName(sourceField.column);
  return inputFields.some((raw) => {
    const input = record(raw);
    if (!input) return false;
    const column = normalizeName(String(input.column ?? input.name ?? ""));
    if (column !== targetColumn) return false;
    const table = normalizeName(String(input.table ?? input.physical_dataset ?? ""));
    if (!table) return true;
    return table === targetTable;
  });
}

export function emitFieldEvidenceForInput(input: {
  readonly taskId: string;
  readonly expression: JsonRecord;
  readonly sourceField: PhysicalFieldIdentity;
  readonly inputField: JsonRecord;
  readonly expanded: ExpandedMaterializedField;
  readonly indexes: FieldEvidenceIndexes;
}): readonly EmittedFieldEvidence[] {
  const expressionContexts = expandSetopBranchExpressions({
    expression: input.expression,
    expressionsByRelation: input.indexes.expressionsByRelation,
    index: input.indexes.relationTree,
  });
  const outputs: EmittedFieldEvidence[] = [];
  for (const context of expressionContexts) {
    if (!expressionAcceptsSourceField(context.expression, input.sourceField)) {
      continue;
    }
    const leafRelationId = leafRelationIdForExpression(
      context.expression,
      // Prefer the sunk branch relation; parent materialization leaf may sit
      // above the setop and would re-open sibling-branch reads.
      text(context.expression.relation_id) ?? input.expanded.leafRelationId,
    );
    const branchInputField = inputFieldRecordForSource(
      context.expression,
      input.sourceField,
    );
    const sourceResolution = resolveSourceReadOccurrence({
      taskId: input.taskId,
      expressionId: context.expressionId,
      sourceTable: input.sourceField.qualifiedName,
      sourceColumn: input.sourceField.column,
      inputField: branchInputField,
      expressionText: text(context.expression.expression_text),
      leafRelationId,
      index: input.indexes.relationTree,
      readOccurrenceByRelationId: input.indexes.readOccurrenceByRelationId,
      bindingByReadRelation: input.indexes.bindingByReadRelation,
    });
    const expressionSubtype = classifyExpressionSubtype(
      context.expression,
      relationTypeForExpression(input.indexes, context.relationId),
    );
    const composed = composePathSubtype([
      ...input.expanded.subtypeHops,
      expressionSubtype,
    ]);
    outputs.push({
      expressionContexts: [context],
      sourceResolution,
      subtype: composed.subtype,
      subtypeReason: composed.subtypeReason,
      leafRelationId,
    });
  }
  return outputs;
}

export function materializationBreakGap(input: {
  readonly taskId: string;
  readonly physicalDataset: string;
  readonly columns: readonly string[];
  readonly affectedEdgeCount: number;
  readonly writeObservationIds: readonly string[];
  readonly materializationRecords: number;
}): TaskLocalProjectionGap {
  return {
    gapId: stableId("gap", {
      reasonCode: "TASK_LOCAL_MATERIALIZATION_FIELD_BREAK",
      taskId: input.taskId,
      physicalDataset: input.physicalDataset,
    }),
    reasonCode: "TASK_LOCAL_MATERIALIZATION_FIELD_BREAK",
    details: {
      taskId: input.taskId,
      physicalDataset: input.physicalDataset,
      columns: [...input.columns].sort((left, right) => left.localeCompare(right)),
      affectedEdgeCount: input.affectedEdgeCount,
      writeObservationIds: [...input.writeObservationIds].sort((left, right) =>
        left.localeCompare(right),
      ),
      materializationRecords: input.materializationRecords,
    },
  };
}

export function controlSideGap(input: {
  readonly taskId: string;
  readonly relationId: string;
  readonly controlId: string;
}): TaskLocalProjectionGap {
  return {
    gapId: stableId("gap", {
      reasonCode: "CONTROL_SIDE_UNRESOLVED",
      taskId: input.taskId,
      relationId: input.relationId,
      controlId: input.controlId,
    }),
    reasonCode: "CONTROL_SIDE_UNRESOLVED",
    details: {
      taskId: input.taskId,
      relationId: input.relationId,
      controlId: input.controlId,
    },
  };
}

export function inputFieldRecordForSource(
  expression: JsonRecord,
  sourceField: PhysicalFieldIdentity,
): JsonRecord {
  const targetTable = normalizeName(sourceField.qualifiedName);
  const targetColumn = normalizeName(sourceField.column);
  const inputFields = Array.isArray(expression.input_fields) ? expression.input_fields : [];
  for (const raw of inputFields) {
    const input = record(raw);
    if (!input) continue;
    if (
      normalizeName(String(input.table ?? "")) === targetTable
      && normalizeName(String(input.column ?? "")) === targetColumn
    ) {
      return input;
    }
  }
  return { table: sourceField.qualifiedName, column: sourceField.column };
}

export function isConstantExpression(expression: JsonRecord): boolean {
  const dependencyStatus = text(expression.input_dependency_status);
  if (dependencyStatus === "NO_PHYSICAL_INPUT") return true;
  const inputFields = Array.isArray(expression.input_fields) ? expression.input_fields : [];
  return inputFields.length === 0
    && !/\bselect\b/i.test(text(expression.expression_text) ?? "");
}
