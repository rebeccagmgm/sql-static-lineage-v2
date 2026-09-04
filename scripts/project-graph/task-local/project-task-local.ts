import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  indexTaskInputPacks,
  loadPhysicalTableCatalog,
  type PhysicalTableCatalog,
  type PhysicalTableCatalogEntry,
} from "../../machine-facts/input-pack-machine-facts.ts";
import { normalizeName } from "../../machine-facts/machine-facts-contract.ts";
import {
  validateTaskDocument,
  type TaskDocument,
} from "../../input/shared/input-pack.ts";
import {
  loadCurrentTaskBundle,
  type CurrentBundleLoad,
  type JsonRecord,
} from "../../query/current-task-bundle.ts";
import {
  fieldConditionalsForExpression,
  sourceFieldsForExpression,
} from "../../reconcile/consumer/field-lineage/field-lineage.ts";
import {
  datasetControlsForStatement,
} from "../../reconcile/shared/dataset-controls.ts";
import type { PhysicalFieldIdentity } from "../../reconcile/consumer/field-lineage/field-lineage-contract.ts";
import { inferTaskDefaultSchema } from "../../reconcile/shared/task-default-schema.ts";
import {
  buildCollectionFailedProjection,
  buildScheduleOnlyProjection,
  factsEvidenceStatus,
  failureReasonFromLoad,
  taskNodeProperties,
} from "./coverage.ts";
import {
  canonicalizeTaskLocalProjection,
  TASK_LOCAL_PROJECTION_SCHEMA_VERSION,
  type TaskLocalEdge,
  type TaskLocalFailureReasonCode,
  type TaskLocalFieldPathSummary,
  type TaskLocalExternalReadSummary,
  type TaskLocalFinalWriteSummary,
  type TaskLocalNode,
  type TaskLocalProjection,
  type TaskLocalProjectionGap,
} from "./contract.ts";
import {
  buildFieldEvidenceIndexes,
  controlSideGap,
  emitFieldEvidenceForInput,
  inputFieldRecordForSource,
  isConstantExpression,
  materializationBreakGap,
  type ExpandedMaterializedField,
} from "../field-evidence-v1/field-evidence-emission.ts";
import { classifyExpressionSubtype } from "../field-evidence-v1/subtype-classifier.ts";
import {
  fieldConditionalEdgeSemanticKey,
  fieldDirectEdgeSemanticKey,
  fieldEvidencePhysicalFieldNodeId,
  physicalDatasetNodeId,
  readOccurrenceNodeId,
  targetWriteNodeId,
  taskLocalEdgeId,
  taskNodeId,
} from "./ids.ts";
import {
  isTempLikeTableName,
  resolveTaskLocalTableIdentity,
  type TaskLocalTableIdentity,
} from "./identity.ts";
import {
  partitionPredicatesByReadOccurrence,
  readPartitionPredicatesForOccurrence,
} from "./partition-predicates.ts";
import { readTaskScheduleContext, type TaskScheduleContext } from "./schedule-context.ts";

export interface ProjectTaskLocalOptions {
  readonly factsRoot: string;
  readonly dataRoot: string;
  readonly taskId: string;
  readonly scheduleCacheRoot?: string;
  readonly generatedAt?: string;
}

// A CLI process projects many tasks against one immutable Pack/catalog snapshot.
// Cache only directory indexes; file contents and Facts remain per-task reads.
const physicalCatalogCache = new Map<string, PhysicalTableCatalog>();
const taskPackIndexCache = new Map<string, ReadonlyMap<string, readonly string[]>>();

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function records(value: unknown): readonly JsonRecord[] {
  return Array.isArray(value)
    ? value.filter((item): item is JsonRecord => typeof item === "object" && item !== null && !Array.isArray(item))
    : [];
}

function record(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export interface TaskLocalReadOccurrenceIdentity {
  readonly occurrenceId: string;
  readonly relationId: string | null;
}

/**
 * Recover a task-global read occurrence from relation evidence when the
 * dataset-io row predates nested read_occurrences. Only an exact same-task,
 * same-statement, same-physical-table read relation is accepted. When that
 * evidence is unavailable, retain the historical legacy fallback so callers
 * can keep the read unresolved instead of inventing a canonical id.
 */
export function resolveTaskLocalReadOccurrenceIdentities(input: {
  readonly taskId: string;
  readonly read: JsonRecord;
  readonly qualifiedName: string;
  readonly relationRecords: readonly JsonRecord[];
}): readonly TaskLocalReadOccurrenceIdentity[] {
  const statementId = text(input.read.statement_id);
  const rawName = text(input.read.physical_dataset);
  const normalizedQualifiedName = normalizeName(input.qualifiedName);
  const normalizedRawName = rawName ? normalizeName(rawName) : null;
  const relationIds = input.relationRecords
    .filter((row) => {
      if (text(row.task_id) !== input.taskId) return false;
      if (text(row.statement_id) !== statementId || !statementId) return false;
      const relation = record(row.relation);
      const relationType = (
        text(row.relation_type)
        ?? text(relation?.type)
        ?? ""
      ).toLowerCase();
      if (relationType !== "read") return false;
      const relationName =
        text(row.physical_dataset)
        ?? text(relation?.table)
        ?? text(relation?.physical_dataset)
        ?? text(relation?.qualifiedName)
        ?? text(relation?.qualified_name);
      if (relationName === null) return false;
      const normalizedRelationName = normalizeName(relationName);
      return normalizedRelationName === normalizedQualifiedName
        || (normalizedRawName !== null
          && !normalizedRawName.includes(".")
          && normalizedRelationName === normalizedRawName);
    })
    .map((row) => {
      const relation = record(row.relation);
      return text(row.relation_id) ?? text(relation?.id);
    })
    .filter((value): value is string => value !== null);
  const uniqueRelationIds = [...new Set(relationIds)].sort(compareText);
  const relationIdSet = new Set(uniqueRelationIds);
  const occurrences = records(input.read.read_occurrences);
  const fallback = (index: number): TaskLocalReadOccurrenceIdentity => ({
    occurrenceId: `legacy:${input.taskId}:${statementId ?? "statement"}:${input.qualifiedName}:${index}`,
    relationId: null,
  });

  if (occurrences.length > 0) {
    return occurrences.map((occurrence, index) => {
      const occurrenceId = text(occurrence.occurrence_id);
      const relationId = text(occurrence.relation_id) ?? occurrenceId;
      if (occurrenceId) return { occurrenceId, relationId };
      if (relationId && relationIdSet.has(relationId)) {
        return { occurrenceId: relationId, relationId };
      }
      if (!relationId && uniqueRelationIds.length === occurrences.length) {
        const recovered = uniqueRelationIds[index];
        if (recovered) return { occurrenceId: recovered, relationId: recovered };
      }
      if (!relationId && uniqueRelationIds.length === 1) {
        const recovered = uniqueRelationIds[0]!;
        return { occurrenceId: recovered, relationId: recovered };
      }
      return fallback(index);
    });
  }

  if (uniqueRelationIds.length > 0) {
    return uniqueRelationIds.map((relationId) => ({ occurrenceId: relationId, relationId }));
  }
  return [fallback(0)];
}

function loadTaskPack(
  dataRoot: string,
  catalog: PhysicalTableCatalog,
  taskId: string,
): { document: TaskDocument & JsonRecord; target: PhysicalTableCatalogEntry | null } | null {
  const index = taskPackIndexCache.get(dataRoot)
    ?? (() => {
      const next = indexTaskInputPacks(dataRoot);
      taskPackIndexCache.set(dataRoot, next);
      return next;
    })();
  const paths = index.get(taskId) ?? [];
  const path = paths.length === 1 ? paths[0] : null;
  if (!path) return null;
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
  validateTaskDocument(raw);
  const document = raw as TaskDocument & JsonRecord;
  const targetName = text(document.target?.qualifiedName);
  const target = targetName
    ? catalog.byQualifiedName.get(normalizeName(targetName))?.[0] ?? null
    : null;
  return { document, target };
}

function ensureNode(
  nodes: Map<string, TaskLocalNode>,
  node: TaskLocalNode,
): void {
  if (!nodes.has(node.nodeId)) nodes.set(node.nodeId, node);
}

function ensureFieldNode(
  nodes: Map<string, TaskLocalNode>,
  field: PhysicalFieldIdentity,
  catalog: PhysicalTableCatalog,
): string {
  const nodeId = fieldEvidencePhysicalFieldNodeId(field);
  const identity = resolveTaskLocalTableIdentity({
    catalog,
    rawName: field.qualifiedName,
    defaultSchema: null,
    fallback: field,
  });
  ensureNode(nodes, {
    nodeId,
    nodeType: "PHYSICAL_FIELD",
    properties: {
      platform: field.platform,
      dataSource: field.dataSource,
      qualifiedName: field.qualifiedName,
      stableTableId: field.stableTableId,
      column: field.column,
      identityStatus: identity.identityStatus,
      ...(identity.qualificationStatus
        ? { qualificationStatus: identity.qualificationStatus }
        : {}),
      ...(identity.identityReasonCode
        ? { identityReasonCode: identity.identityReasonCode }
        : {}),
    },
  });
  return nodeId;
}

function datasetProperties(identity: TaskLocalTableIdentity): Record<string, unknown> {
  return {
    platform: identity.platform,
    dataSource: identity.dataSource,
    qualifiedName: identity.qualifiedName,
    identityStatus: identity.identityStatus,
    ...(identity.qualificationStatus
      ? { qualificationStatus: identity.qualificationStatus }
      : {}),
    ...(identity.identityReasonCode
      ? { identityReasonCode: identity.identityReasonCode }
      : {}),
  };
}

function ensureDatasetNode(
  nodes: Map<string, TaskLocalNode>,
  identity: TaskLocalTableIdentity,
): string {
  const nodeId = physicalDatasetNodeId(identity);
  ensureNode(nodes, {
    nodeId,
    nodeType: "PHYSICAL_DATASET",
    properties: datasetProperties(identity),
  });
  return nodeId;
}

function materializationKey(dataset: string, column: string): string {
  return `${normalizeName(dataset)}\u0000${normalizeName(column)}`;
}

export interface MaterializationContext {
  readonly statementId: string | null;
  readonly expressionId: string | null;
}

function materializationContextForExpression(expression: JsonRecord): MaterializationContext {
  return {
    statementId: text(expression.statement_id),
    expressionId: text(expression.expression_id),
  };
}

function materializationContextKey(context: MaterializationContext): string {
  return `${context.statementId ?? ""}\u0000${context.expressionId ?? ""}`;
}

function materializationRecordsForDataset(
  materializationRecords: readonly JsonRecord[],
  rawDataset: string,
  qualifiedDataset: string,
): readonly JsonRecord[] {
  const normalizedRaw = normalizeName(rawDataset);
  const normalizedQualified = normalizeName(qualifiedDataset);
  return materializationRecords.filter((materialization) => {
    const materializedDataset = normalizeName(String(materialization.physical_dataset ?? ""));
    return materializedDataset === normalizedRaw || materializedDataset === normalizedQualified;
  });
}

function materializationRecordHasContext(materialization: JsonRecord): boolean {
  return text(materialization.read_statement_id) !== null
    || (Array.isArray(materialization.read_expression_ids)
      && materialization.read_expression_ids.some((value: unknown) => text(value) !== null));
}

export function materializationRecordsForField(
  materializationsByField: ReadonlyMap<string, readonly JsonRecord[]>,
  source: PhysicalFieldIdentity,
  context: MaterializationContext,
): readonly JsonRecord[] {
  const all = materializationsByField.get(materializationKey(source.qualifiedName, source.column)) ?? [];
  if (context.expressionId) {
    const expressionMatches = all.filter((materialization) =>
      Array.isArray(materialization.read_expression_ids)
      && materialization.read_expression_ids.some(
        (value: unknown) => text(value) === context.expressionId,
      ),
    );
    if (expressionMatches.length > 0) return expressionMatches;
  }
  if (context.statementId) {
    const statementMatches = all.filter(
      (materialization) => text(materialization.read_statement_id) === context.statementId,
    );
    if (statementMatches.length > 0) return statementMatches;
  }
  return all.every((materialization) => !materializationRecordHasContext(materialization)) ? all : [];
}

function isFinalWrite(
  physicalDataset: string,
  targetQualifiedName: string | null,
  writeKind: string | null,
): boolean {
  if (writeKind?.toUpperCase() === "CREATE_TABLE") return false;
  const normalized = normalizeName(physicalDataset);
  if (targetQualifiedName) return normalized === normalizeName(targetQualifiedName);
  return !isTempLikeTableName(normalized);
}

function taskLocalSourceFieldsForExpression(
  expression: JsonRecord,
  catalog: PhysicalTableCatalog,
  load: CurrentBundleLoad,
  taskId: string,
  taskTarget: PhysicalTableCatalogEntry,
  defaultSchema: ReturnType<typeof inferTaskDefaultSchema>,
): ReturnType<typeof sourceFieldsForExpression> {
  const result = sourceFieldsForExpression(
    expression,
    catalog,
    load,
    taskId,
    taskTarget,
    defaultSchema,
  );
  // The legacy resolver can use a unique catalog tail when no task schema exists.
  // Keep task-local projection fail-closed for that one case; task-local schema-backed
  // fields remain valid evidence.
  if (defaultSchema !== null) return result;
  const bareInputTables = new Set(
    records(expression.input_fields)
      .map((input) => normalizeName(String(input.table ?? "")))
      .filter((table) => table !== "" && !table.includes(".")),
  );
  if (bareInputTables.size === 0) return result;
  return {
    ...result,
    fields: result.fields.filter(
      (field) =>
        field.identityStatus === "TASK_LOCAL_SCHEMA_BACKED"
        || !bareInputTables.has(normalizeName(field.qualifiedName.split(".").at(-1) ?? "")),
    ),
  };
}

function expressionFor(load: CurrentBundleLoad, binding: JsonRecord): JsonRecord | null {
  const expressionId = text(binding.expression_id);
  if (!expressionId) return null;
  return records(load.records["field-expression-nodes.jsonl"]).find(
    (expression) => text(expression.expression_id) === expressionId,
  ) ?? null;
}

function projectTaskLocalFromFacts(input: {
  readonly taskId: string;
  readonly generatedAt: string;
  readonly load: CurrentBundleLoad;
  readonly evidenceStatus: "CONFIRMED" | "PROVISIONAL_LEGACY";
  readonly dataRoot: string;
  readonly schedule: TaskScheduleContext | null;
}): TaskLocalProjection {
  const { taskId, generatedAt, load, evidenceStatus, dataRoot, schedule } = input;
  const catalog = physicalCatalogCache.get(dataRoot)
    ?? (() => {
      const next = loadPhysicalTableCatalog(dataRoot, { lazyDdl: true });
      physicalCatalogCache.set(dataRoot, next);
      return next;
    })();
  const pack = loadTaskPack(dataRoot, catalog, taskId);
  const fallbackTable = pack?.target ?? { platform: "hive", dataSource: "unknown" };
  const defaultSchema = pack ? inferTaskDefaultSchema(pack.document) : null;
  const nodes = new Map<string, TaskLocalNode>();
  const edges: TaskLocalEdge[] = [];
  const edgeIds = new Set<string>();

  const pushEdge = (edge: TaskLocalEdge): void => {
    if (edgeIds.has(edge.edgeId)) return;
    edgeIds.add(edge.edgeId);
    edges.push(edge);
  };

  ensureNode(nodes, {
    nodeId: taskNodeId(taskId),
    nodeType: "TASK",
    properties: taskNodeProperties({
      packTaskName: pack?.document.taskName ?? null,
      schedule,
    }),
  });

  const writeRecords = records(load.records["dataset-io.jsonl"]).filter(
    (record) =>
      text(record.task_id) === taskId
      && String(record.direction ?? "").toUpperCase() === "WRITE"
      && text(record.write_observation_id),
  );
  if (writeRecords.length === 0) {
    return buildCollectionFailedProjection({
      taskId,
      generatedAt,
      failureReasonCode: "NO_RESOLVED_WRITE",
      taskProperties: taskNodeProperties({
        packTaskName: pack?.document.taskName ?? null,
        schedule,
      }),
    });
  }

  const resolvedBindings = records(load.records["output-field-bindings.jsonl"]).filter(
    (binding) =>
      text(binding.task_id) === taskId
      && binding.binding_status === "RESOLVED"
      && text(binding.write_observation_id),
  );
  const primaryTarget = pack?.target ?? null;
  if (resolvedBindings.length > 0 && !primaryTarget) {
    return buildCollectionFailedProjection({
      taskId,
      generatedAt,
      failureReasonCode: "SCHEMA_UNRESOLVED",
      taskProperties: taskNodeProperties({
        packTaskName: pack?.document.taskName ?? null,
        schedule,
      }),
    });
  }

  const writeObservationByStatement = new Map<string, string>();
  for (const write of writeRecords) {
    const writeObservationId = text(write.write_observation_id)!;
    const statementId =
      text(write.write_statement_id)
      ?? text(write.statement_id);
    if (statementId) writeObservationByStatement.set(statementId, writeObservationId);
  }
  for (const binding of resolvedBindings) {
    const writeObservationId = text(binding.write_observation_id);
    const statementId =
      text(binding.write_statement_id)
      ?? text(binding.statement_id);
    if (writeObservationId && statementId && !writeObservationByStatement.has(statementId)) {
      writeObservationByStatement.set(statementId, writeObservationId);
    }
  }

  const outputBindings = records(load.records["output-field-bindings.jsonl"]);
  const bindingById = new Map(
    outputBindings
      .map((binding) => [text(binding.binding_id), binding] as const)
      .filter((entry): entry is readonly [string, JsonRecord] => entry[0] !== null),
  );
  const materializationRecords = records(load.records["task-local-materializations.jsonl"])
    .filter((record) => text(record.task_id) === taskId);
  const materializationsByField = new Map<string, JsonRecord[]>();
  for (const materialization of materializationRecords) {
    const dataset = text(materialization.physical_dataset);
    const column = text(materialization.column);
    if (!dataset || !column) continue;
    const key = materializationKey(dataset, column);
    const values = materializationsByField.get(key) ?? [];
    values.push(materialization);
    materializationsByField.set(key, values);
  }

  const targetWriteNodes = new Map<string, string>();
  const finalWriteSummaries: TaskLocalFinalWriteSummary[] = [];
  const finalDatasetNames = new Set<string>();
  for (const write of writeRecords) {
    const writeObservationId = text(write.write_observation_id)!;
    const baseIdentity = resolveTaskLocalTableIdentity({
      catalog,
      rawName: String(write.physical_dataset ?? ""),
      defaultSchema,
      fallback: fallbackTable,
    });
    const writeMaterializations = materializationRecordsForDataset(
      materializationRecords,
      String(write.physical_dataset ?? ""),
      baseIdentity.qualifiedName,
    );
    const identity = isTempLikeTableName(String(write.physical_dataset ?? ""))
      && writeMaterializations.length === 0
      && baseIdentity.identityStatus === "CONFIRMED"
      ? {
        ...baseIdentity,
        identityStatus: "CANDIDATE_DATASET" as const,
        identityReasonCode: "TEMP_MATERIALIZATION_MISSING",
      }
      : baseIdentity;
    const datasetNodeId = ensureDatasetNode(nodes, identity);
    const writeNodeId = targetWriteNodeId({
      taskId,
      datasetNodeId,
      writeObservationId,
    });
    ensureNode(nodes, {
      nodeId: writeNodeId,
      nodeType: "TARGET_WRITE",
      properties: {
        writeObservationId,
        qualifiedName: identity.qualifiedName,
      },
    });
    targetWriteNodes.set(writeObservationId, writeNodeId);
    pushEdge({
      edgeId: taskLocalEdgeId({
        edgeType: "WRITES",
        fromNodeId: taskNodeId(taskId),
        toNodeId: writeNodeId,
        semanticKey: { writeObservationId },
      }),
      edgeType: "WRITES",
      fromNodeId: taskNodeId(taskId),
      toNodeId: writeNodeId,
      properties: { writeObservationId },
    });
    pushEdge({
      edgeId: taskLocalEdgeId({
        edgeType: "WRITES",
        fromNodeId: writeNodeId,
        toNodeId: datasetNodeId,
        semanticKey: { writeObservationId },
      }),
      edgeType: "WRITES",
      fromNodeId: writeNodeId,
      toNodeId: datasetNodeId,
      properties: { writeObservationId },
    });
    if (
      isFinalWrite(
        identity.qualifiedName,
        pack?.target?.qualifiedName ?? null,
        text(write.write_kind),
      )
    ) {
      finalDatasetNames.add(identity.qualifiedName);
      finalWriteSummaries.push({
        writeObservationId,
        targetWriteNodeId: writeNodeId,
        datasetNodeId,
        qualifiedName: identity.qualifiedName,
      });
    }
  }

  const relationRecords = records(load.records["relation-nodes.jsonl"]);
  const predicatesByOccurrence = partitionPredicatesByReadOccurrence({
    taskId,
    relationRecords,
    relationEdgeRecords: records(load.records["relation-edges.jsonl"]),
  });
  const externalReadSummaries: TaskLocalExternalReadSummary[] = [];
  for (const read of records(load.records["dataset-io.jsonl"])) {
    if (text(read.task_id) !== taskId || String(read.direction ?? "").toUpperCase() !== "READ") continue;
    const baseIdentity = resolveTaskLocalTableIdentity({
      catalog,
      rawName: String(read.physical_dataset ?? ""),
      defaultSchema,
      fallback: fallbackTable,
    });
    const rawReadDataset = normalizeName(String(read.physical_dataset ?? ""));
    const datasetMaterializations = materializationRecordsForDataset(
      materializationRecords,
      rawReadDataset,
      baseIdentity.qualifiedName,
    );
    const identity = isTempLikeTableName(rawReadDataset) && datasetMaterializations.length === 0
      ? {
        ...baseIdentity,
        identityStatus: "CANDIDATE_DATASET" as const,
        identityReasonCode: "TEMP_MATERIALIZATION_MISSING",
      }
      : baseIdentity;
    const datasetNodeId = ensureDatasetNode(nodes, identity);
    const hasResolvedMaterialization = datasetMaterializations.some(
      (materialization) => String(materialization.status ?? "").toUpperCase() === "RESOLVED",
    );
    const hasUnresolvedMaterialization = datasetMaterializations.some(
      (materialization) => String(materialization.status ?? "").toUpperCase() !== "RESOLVED",
    );
    const readOccurrenceIds = resolveTaskLocalReadOccurrenceIdentities({
      taskId,
      read,
      qualifiedName: identity.qualifiedName,
      relationRecords,
    });
    for (const [occurrenceIndex, occurrence] of readOccurrenceIds.entries()) {
      const partition = readPartitionPredicatesForOccurrence(
        predicatesByOccurrence,
        occurrence.relationId,
      );
      const selfRead = finalDatasetNames.has(identity.qualifiedName);
      const readDisposition = selfRead
        ? "SELF_READ"
        : hasResolvedMaterialization && !hasUnresolvedMaterialization
        ? "LOCAL_MATERIALIZATION"
        : "EXTERNAL_READ";
      const occurrenceNodeId = readOccurrenceNodeId({
        consumerTaskId: taskId,
        occurrenceId: occurrence.occurrenceId,
        readRelationId: occurrence.relationId ?? `${identity.qualifiedName}:${occurrenceIndex}`,
      });
      ensureNode(nodes, {
        nodeId: occurrenceNodeId,
        nodeType: "READ_OCCURRENCE",
        properties: {
          taskId,
          occurrenceId: occurrence.occurrenceId,
          relationId: occurrence.relationId,
          statementId: text(read.statement_id),
          datasetNodeId,
          physicalDataset: identity.qualifiedName,
          identityStatus: identity.identityStatus,
          ...(identity.qualificationStatus
            ? { qualificationStatus: identity.qualificationStatus }
            : {}),
          ...(identity.identityReasonCode
            ? { identityReasonCode: identity.identityReasonCode }
            : {}),
          readDisposition,
          partitionPredicates: partition.predicates,
          partitionPredicateStatus: partition.status,
          ...(hasUnresolvedMaterialization
            ? { materializationBoundaryReason: "MATERIALIZATION_NOT_RESOLVED" }
            : {}),
        },
      });
      pushEdge({
        edgeId: taskLocalEdgeId({
          edgeType: "READS",
          fromNodeId: taskNodeId(taskId),
          toNodeId: occurrenceNodeId,
          semanticKey: { readOccurrenceId: occurrence.occurrenceId },
        }),
        edgeType: "READS",
        fromNodeId: taskNodeId(taskId),
        toNodeId: occurrenceNodeId,
        properties: {
          readOccurrenceId: occurrence.occurrenceId,
          readDisposition,
        },
      });
      pushEdge({
        edgeId: taskLocalEdgeId({
          edgeType: "READS",
          fromNodeId: occurrenceNodeId,
          toNodeId: datasetNodeId,
          semanticKey: { readOccurrenceId: occurrence.occurrenceId },
        }),
        edgeType: "READS",
        fromNodeId: occurrenceNodeId,
        toNodeId: datasetNodeId,
        properties: {
          readOccurrenceId: occurrence.occurrenceId,
          partitionPredicates: partition.predicates,
          partitionPredicateStatus: partition.status,
          readDisposition,
        },
      });
      if (readDisposition === "EXTERNAL_READ") {
        externalReadSummaries.push({
          readOccurrenceId: occurrence.occurrenceId,
          readOccurrenceNodeId: occurrenceNodeId,
          datasetNodeId,
          qualifiedName: identity.qualifiedName,
          identityStatus: identity.identityStatus,
        });
      }
    }
  }

  const fieldEvidenceIndexes = buildFieldEvidenceIndexes({
    taskId,
    expressions: records(load.records["field-expression-nodes.jsonl"]),
    relationNodes: records(load.records["relation-nodes.jsonl"]),
    relationEdges: records(load.records["relation-edges.jsonl"]),
    datasetIoReads: records(load.records["dataset-io.jsonl"]).filter(
      (row) => text(row.task_id) === taskId,
    ),
  });
  const gaps: TaskLocalProjectionGap[] = [];
  const gapIds = new Set<string>();
  const pushGap = (gap: TaskLocalProjectionGap): void => {
    if (gapIds.has(gap.gapId)) return;
    gapIds.add(gap.gapId);
    gaps.push(gap);
  };
  const writtenDatasets = new Set(
    writeRecords.map((write) => normalizeName(String(write.physical_dataset ?? ""))),
  );
  const materializationBreakTracker = new Map<string, {
    columns: Set<string>;
    affectedEdgeCount: number;
    writeObservationIds: Set<string>;
    materializationRecords: number;
  }>();
  const materializationBreakKeys = new Set<string>();

  const expandedMaterializationMemo = new Map<string, ExpandedMaterializedField[]>();
  const expandMaterializedField = (
    source: PhysicalFieldIdentity,
    visited: ReadonlySet<string> = new Set(),
    context: MaterializationContext = { statementId: null, expressionId: null },
    subtypeHops: readonly ReturnType<typeof classifyExpressionSubtype>[] = [],
  ): ExpandedMaterializedField[] => {
    const fieldKey = materializationKey(source.qualifiedName, source.column);
    const memoKey = `${fieldKey}\u0000${materializationContextKey(context)}`;
    if (visited.size === 0) {
      const cached = expandedMaterializationMemo.get(memoKey);
      if (cached) return cached;
    }
    const candidates = materializationRecordsForField(
      materializationsByField,
      source,
      context,
    );
    const resolved = candidates.filter(
      (materialization) =>
        String(materialization.status ?? "").toUpperCase() === "RESOLVED"
        && text(materialization.output_binding_id),
    );
    if (candidates.length !== 1 || resolved.length !== 1 || !primaryTarget || visited.has(fieldKey)) {
      const result: ExpandedMaterializedField[] = [{
        field: source,
        materializationBridgeIds: [],
        leafExpressionId: context.expressionId,
        leafRelationId: null,
        pathHadAggregation: subtypeHops.some((hop) => hop.pathHadAggregation),
        subtypeHops,
      }];
      if (visited.size === 0) expandedMaterializationMemo.set(memoKey, result);
      return result;
    }
    const materialization = resolved[0]!;
    const binding = bindingById.get(text(materialization.output_binding_id)!);
    const expression = binding ? expressionFor(load, binding) : null;
    if (!expression) {
      const result: ExpandedMaterializedField[] = [{
        field: source,
        materializationBridgeIds: [],
        leafExpressionId: context.expressionId,
        leafRelationId: null,
        pathHadAggregation: subtypeHops.some((hop) => hop.pathHadAggregation),
        subtypeHops,
      }];
      if (visited.size === 0) expandedMaterializationMemo.set(memoKey, result);
      return result;
    }
    const hop = classifyExpressionSubtype(
      expression,
      fieldEvidenceIndexes.relationTree.relations.get(
        text(expression.relation_id) ?? "",
      )?.relationType ?? null,
    );
    const underlying = taskLocalSourceFieldsForExpression(
      expression,
      catalog,
      load,
      taskId,
      primaryTarget,
      defaultSchema,
    );
    if (underlying.fields.length === 0) {
      const result: ExpandedMaterializedField[] = [{
        field: source,
        materializationBridgeIds: [],
        leafExpressionId: text(expression.expression_id),
        leafRelationId: text(expression.relation_id),
        pathHadAggregation: [...subtypeHops, hop].some((item) => item.pathHadAggregation),
        subtypeHops: [...subtypeHops, hop],
      }];
      if (visited.size === 0) expandedMaterializationMemo.set(memoKey, result);
      return result;
    }
    const nextVisited = new Set(visited);
    nextVisited.add(fieldKey);
    const nestedContext = materializationContextForExpression(expression);
    const result = underlying.fields.flatMap((field) =>
      expandMaterializedField(
        field,
        nextVisited,
        nestedContext,
        [...subtypeHops, hop],
      ).map((expanded) => ({
        field: expanded.field,
        materializationBridgeIds: [
          text(materialization.bridge_id) ?? "",
          ...expanded.materializationBridgeIds,
        ].filter(Boolean),
        leafExpressionId: expanded.leafExpressionId ?? text(expression.expression_id),
        leafRelationId: expanded.leafRelationId ?? text(expression.relation_id),
        pathHadAggregation: expanded.pathHadAggregation,
        subtypeHops: expanded.subtypeHops,
      })),
    );
    if (visited.size === 0) expandedMaterializationMemo.set(memoKey, result);
    return result;
  };

  const localFieldPaths: TaskLocalFieldPathSummary[] = [];
  const localFieldPathKeys = new Set<string>();
  const statementIds = new Set<string>();
  for (const binding of resolvedBindings) {
    const writeObservationId = text(binding.write_observation_id)!;
    const targetWriteNode = targetWriteNodes.get(writeObservationId);
    if (!targetWriteNode || !primaryTarget) continue;
    const outputColumn = normalizeName(String(binding.target_field ?? ""));
    if (!outputColumn) continue;
    const expression = expressionFor(load, binding);
    if (!expression || isConstantExpression(expression)) continue;
    const statementId = text(expression.statement_id);
    if (statementId) statementIds.add(statementId);
    const sources = taskLocalSourceFieldsForExpression(
      expression,
      catalog,
      load,
      taskId,
      primaryTarget,
      defaultSchema,
    );
    const materializationContext = materializationContextForExpression(expression);
    for (const rawSource of sources.fields) {
      const isTempBreakSource =
        writtenDatasets.has(normalizeName(rawSource.qualifiedName))
        && isTempLikeTableName(rawSource.qualifiedName);
      for (const source of expandMaterializedField(
        rawSource,
        new Set(),
        materializationContext,
      )) {
      const inputField = inputFieldRecordForSource(expression, source.field);
      const emissions = emitFieldEvidenceForInput({
        taskId,
        expression,
        sourceField: source.field,
        inputField,
        expanded: source,
        indexes: fieldEvidenceIndexes,
      });
      for (const emission of emissions) {
        const context = emission.expressionContexts[0];
        if (!context) continue;
        if (emission.sourceResolution.gap) pushGap(emission.sourceResolution.gap);
        const fromNodeId = ensureFieldNode(nodes, source.field, catalog);
        const bridgeIds = [...new Set(source.materializationBridgeIds)].sort(compareText);
        const sourceReadOccurrenceId = emission.sourceResolution.sourceReadOccurrenceStatus
          === "RESOLVED"
          ? emission.sourceResolution.sourceReadOccurrenceId
          : null;
        pushEdge({
          edgeId: taskLocalEdgeId({
            edgeType: "FIELD_DIRECT",
            fromNodeId,
            toNodeId: targetWriteNode,
            semanticKey: fieldDirectEdgeSemanticKey({
              outputColumn,
              sourceColumn: source.field.column,
              sourceTable: source.field.qualifiedName,
              sourceReadOccurrenceId,
              expressionId: context.expressionId,
            }),
          }),
          edgeType: "FIELD_DIRECT",
          fromNodeId,
          toNodeId: targetWriteNode,
          properties: {
            subtype: emission.subtype,
            ...(emission.subtypeReason ? { subtypeReason: emission.subtypeReason } : {}),
            outputColumn,
            bindingId: text(binding.binding_id),
            expressionId: context.expressionId,
            sourceReadOccurrenceId,
            sourceReadOccurrenceStatus: emission.sourceResolution.sourceReadOccurrenceStatus,
            ...(emission.sourceResolution.sourceReadOccurrenceReason
              ? { sourceReadOccurrenceReason: emission.sourceResolution.sourceReadOccurrenceReason }
              : {}),
            sourceRelationId: emission.sourceResolution.sourceRelationId,
            ...(bridgeIds.length > 0
              ? { materializationBridgeIds: bridgeIds, materializationFolded: true }
              : {}),
          },
        });
        const sourceStillTemp =
          isTempBreakSource
          && bridgeIds.length === 0
          && writtenDatasets.has(normalizeName(source.field.qualifiedName))
          && isTempLikeTableName(source.field.qualifiedName);
        if (sourceStillTemp) {
          const breakKey = `${writeObservationId}|${outputColumn}|${rawSource.column}`;
          if (!materializationBreakKeys.has(breakKey)) {
            materializationBreakKeys.add(breakKey);
            const sourceDataset = normalizeName(rawSource.qualifiedName);
            const tracker = materializationBreakTracker.get(sourceDataset) ?? {
              columns: new Set<string>(),
              affectedEdgeCount: 0,
              writeObservationIds: new Set<string>(),
              materializationRecords: materializationRecordsForDataset(
                materializationRecords,
                sourceDataset,
                sourceDataset,
              ).length,
            };
            tracker.columns.add(rawSource.column);
            tracker.affectedEdgeCount += 1;
            tracker.writeObservationIds.add(writeObservationId);
            materializationBreakTracker.set(sourceDataset, tracker);
          }
        }
        if (bridgeIds.length > 0) {
          const pathKey = `${fromNodeId}|${targetWriteNode}|${outputColumn}`;
          if (!localFieldPathKeys.has(pathKey)) {
            localFieldPathKeys.add(pathKey);
            localFieldPaths.push({
              sourceFieldNodeId: fromNodeId,
              targetWriteNodeId: targetWriteNode,
              outputColumn,
              materializationBridgeIds: bridgeIds,
            });
          }
        }
      }
    }
    }
    for (const conditional of fieldConditionalsForExpression(
      load,
      taskId,
      outputColumn,
      expression,
      catalog,
      defaultSchema,
      primaryTarget,
      evidenceStatus,
    )) {
      for (const source of conditional.fields) {
        const inputField = inputFieldRecordForSource(expression, source);
        const emissions = emitFieldEvidenceForInput({
          taskId,
          expression,
          sourceField: source,
          inputField,
          expanded: {
            field: source,
            materializationBridgeIds: [],
            leafExpressionId: text(expression.expression_id),
            leafRelationId: text(expression.relation_id),
            pathHadAggregation: false,
            subtypeHops: [],
          },
          indexes: fieldEvidenceIndexes,
        });
        for (const emission of emissions) {
          const context = emission.expressionContexts[0];
          if (!context) continue;
          if (emission.sourceResolution.gap) pushGap(emission.sourceResolution.gap);
          const fromNodeId = ensureFieldNode(nodes, source, catalog);
          const sourceReadOccurrenceId = emission.sourceResolution.sourceReadOccurrenceStatus
            === "RESOLVED"
            ? emission.sourceResolution.sourceReadOccurrenceId
            : null;
          pushEdge({
            edgeId: taskLocalEdgeId({
              edgeType: "FIELD_CONDITIONAL",
              fromNodeId,
              toNodeId: targetWriteNode,
              semanticKey: fieldConditionalEdgeSemanticKey({
                outputColumn,
                sourceColumn: source.column,
                sourceTable: source.qualifiedName,
                sourceReadOccurrenceId,
                expressionId: context.expressionId,
                conditionalId: conditional.conditionalId,
              }),
            }),
            edgeType: "FIELD_CONDITIONAL",
            fromNodeId,
            toNodeId: targetWriteNode,
            properties: {
              subtype: "CONDITIONAL",
              outputColumn,
              expressionId: context.expressionId,
              sourceReadOccurrenceId,
              sourceReadOccurrenceStatus: emission.sourceResolution.sourceReadOccurrenceStatus,
              ...(emission.sourceResolution.sourceReadOccurrenceReason
                ? { sourceReadOccurrenceReason: emission.sourceResolution.sourceReadOccurrenceReason }
                : {}),
              sourceRelationId: emission.sourceResolution.sourceRelationId,
            },
          });
        }
      }
    }
  }

  for (const [physicalDataset, tracker] of materializationBreakTracker) {
    pushGap(materializationBreakGap({
      taskId,
      physicalDataset,
      columns: [...tracker.columns],
      affectedEdgeCount: tracker.affectedEdgeCount,
      writeObservationIds: [...tracker.writeObservationIds],
      materializationRecords: tracker.materializationRecords,
    }));
  }

  for (const statementId of writeObservationByStatement.keys()) {
    statementIds.add(statementId);
  }

  for (const statementId of [...statementIds].sort(compareText)) {
    for (const control of datasetControlsForStatement(
      load,
      taskId,
      statementId,
      catalog,
      defaultSchema,
      primaryTarget ?? fallbackTable,
      evidenceStatus,
    )) {
      if (!control.field) continue;
      const writeObservationId =
        writeObservationByStatement.get(control.statementId)
        ?? writeObservationByStatement.get(statementId);
      const targetWriteNode = writeObservationId
        ? targetWriteNodes.get(writeObservationId)
        : undefined;
      if (!targetWriteNode) continue;
      if (control.controlSide === "BOTH") {
        pushGap(controlSideGap({
          taskId,
          relationId: control.relationId ?? "unresolved",
          controlId: control.controlId,
        }));
      }
      const fromNodeId = ensureFieldNode(nodes, control.field, catalog);
      pushEdge({
        edgeId: taskLocalEdgeId({
          edgeType: "DATASET_CONTROL",
          fromNodeId,
          toNodeId: targetWriteNode,
          semanticKey: { controlId: control.controlId },
        }),
        edgeType: "DATASET_CONTROL",
        fromNodeId,
        toNodeId: targetWriteNode,
        properties: {
          subtype: control.subtype,
          grain: control.grain,
          ...(control.grainReason ? { grainReason: control.grainReason } : {}),
          relationId: control.relationId,
          statementId: control.statementId,
          writeObservationId,
          joinType: control.joinType ?? "N/A",
          controlSide: control.controlSide ?? "N/A",
          ...(control.leftRelationId ? { leftRelationId: control.leftRelationId } : {}),
          ...(control.rightRelationId ? { rightRelationId: control.rightRelationId } : {}),
        },
      });
    }
  }

  return canonicalizeTaskLocalProjection({
    schemaVersion: TASK_LOCAL_PROJECTION_SCHEMA_VERSION,
    artifactType: "TASK_LOCAL_PROJECTION",
    generatedAt,
    taskId,
    coverageStatus: "PROJECTED",
    failureReasonCode: null,
    nodes: [...nodes.values()],
    edges,
    gaps,
    localClosure: {
      finalWrites: [...finalWriteSummaries].sort((left, right) =>
        compareText(left.writeObservationId, right.writeObservationId),
      ),
      externalReads: [...externalReadSummaries].sort((left, right) =>
        compareText(left.readOccurrenceId, right.readOccurrenceId),
      ),
      localFieldPaths: [...localFieldPaths].sort((left, right) =>
        compareText(
          `${left.targetWriteNodeId}|${left.outputColumn}|${left.sourceFieldNodeId}`,
          `${right.targetWriteNodeId}|${right.outputColumn}|${right.sourceFieldNodeId}`,
        ),
      ),
    },
  });
}

export function projectTaskLocal(options: ProjectTaskLocalOptions): TaskLocalProjection {
  const taskId = options.taskId.trim();
  const factsRoot = resolve(options.factsRoot);
  const dataRoot = resolve(options.dataRoot);
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const schedule = readTaskScheduleContext(taskId, options.scheduleCacheRoot);
  const load = loadCurrentTaskBundle(factsRoot, taskId);
  const evidenceStatus = factsEvidenceStatus(load);

  if (!evidenceStatus) {
    if (schedule) {
      return buildScheduleOnlyProjection({ taskId, generatedAt, schedule });
    }
    return buildCollectionFailedProjection({
      taskId,
      generatedAt,
      failureReasonCode: failureReasonFromLoad(load),
    });
  }

  try {
    return projectTaskLocalFromFacts({
      taskId,
      generatedAt,
      load,
      evidenceStatus,
      dataRoot,
      schedule,
    });
  } catch (error) {
    const failureReasonCode: TaskLocalFailureReasonCode =
      error instanceof Error && error.message.startsWith("SCHEMA_UNRESOLVED:")
        ? "SCHEMA_UNRESOLVED"
        : "PROJECTION_FAILED";
    return buildCollectionFailedProjection({
      taskId,
      generatedAt,
      failureReasonCode,
    });
  }
}
