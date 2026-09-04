import { normalizeName } from "../../machine-facts/machine-facts-contract.ts";
import type {
  TaskLocalProjectionGap,
  TaskLocalSourceReadOccurrenceReason,
  TaskLocalSourceReadOccurrenceStatus,
} from "../task-local/contract.ts";
import { stableId } from "../task-local/ids.ts";
import {
  nearestSetopAncestor,
  readRelationsInSubtree,
  type RelationRecord,
  type RelationTreeIndex,
} from "./relation-tree.ts";

type JsonRecord = Readonly<Record<string, unknown>>;

export interface SourceReadOccurrenceResolution {
  readonly sourceReadOccurrenceId: string | null;
  readonly sourceReadOccurrenceStatus: TaskLocalSourceReadOccurrenceStatus;
  readonly sourceReadOccurrenceReason: TaskLocalSourceReadOccurrenceReason | null;
  readonly sourceRelationId: string | null;
  readonly gap: TaskLocalProjectionGap | null;
}

export interface FieldExpressionContext {
  readonly expressionId: string;
  readonly expression: JsonRecord;
  readonly relationId: string | null;
  readonly ordinal: number | null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function tableKey(value: string): string {
  return normalizeName(value);
}

function gapForStatus(input: {
  readonly taskId: string;
  readonly expressionId: string;
  readonly sourceTable: string;
  readonly sourceColumn: string;
  readonly status: TaskLocalSourceReadOccurrenceStatus;
  readonly reason: TaskLocalSourceReadOccurrenceReason;
}): TaskLocalProjectionGap {
  const reasonCode = input.status === "AMBIGUOUS"
    ? "FIELD_SOURCE_READ_OCCURRENCE_AMBIGUOUS"
    : "FIELD_SOURCE_READ_OCCURRENCE_UNRESOLVED";
  return {
    gapId: stableId("gap", {
      reasonCode,
      taskId: input.taskId,
      expressionId: input.expressionId,
      sourceTable: input.sourceTable,
      sourceColumn: input.sourceColumn,
    }),
    reasonCode,
    details: {
      taskId: input.taskId,
      expressionId: input.expressionId,
      sourceTable: input.sourceTable,
      sourceColumn: input.sourceColumn,
      sourceReadOccurrenceStatus: input.status,
      reasonCode: input.reason,
    },
  };
}

function unresolved(
  input: {
    readonly taskId: string;
    readonly expressionId: string;
    readonly sourceTable: string;
    readonly sourceColumn: string;
    readonly reason: TaskLocalSourceReadOccurrenceReason;
  },
): SourceReadOccurrenceResolution {
  return {
    sourceReadOccurrenceId: null,
    sourceReadOccurrenceStatus: "UNRESOLVED",
    sourceReadOccurrenceReason: input.reason,
    sourceRelationId: null,
    gap: gapForStatus({
      ...input,
      status: "UNRESOLVED",
    }),
  };
}

function ambiguous(
  input: {
    readonly taskId: string;
    readonly expressionId: string;
    readonly sourceTable: string;
    readonly sourceColumn: string;
    readonly reason: TaskLocalSourceReadOccurrenceReason;
  },
): SourceReadOccurrenceResolution {
  return {
    sourceReadOccurrenceId: null,
    sourceReadOccurrenceStatus: "AMBIGUOUS",
    sourceReadOccurrenceReason: input.reason,
    sourceRelationId: null,
    gap: gapForStatus({
      ...input,
      status: "AMBIGUOUS",
    }),
  };
}

function resolved(
  sourceReadOccurrenceId: string,
  sourceRelationId: string,
): SourceReadOccurrenceResolution {
  return {
    sourceReadOccurrenceId,
    sourceReadOccurrenceStatus: "RESOLVED",
    sourceReadOccurrenceReason: null,
    sourceRelationId,
    gap: null,
  };
}

function qualifierFromInput(inputField: JsonRecord): string | null {
  return text(inputField.qualifier) ?? text(inputField.alias);
}

/**
 * Extract table/alias qualifiers that appear as `qualifier.column` in expression text.
 * Ported from physical-field-expander expressionQualifiersForColumn — no task literals.
 */
export function expressionQualifiersForColumn(
  expressionText: string | null | undefined,
  column: string,
): readonly string[] {
  if (!expressionText?.trim() || !column.trim()) return [];
  const escapedColumn = column.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `(?:^|[^\\w$])["\`\\[]?([A-Za-z_][\\w$]*)["\`\\]]?\\s*\\.\\s*["\`\\[]?${escapedColumn}["\`\\]]?(?![\\w$])`,
    "gi",
  );
  const qualifiers = new Set<string>();
  for (const match of expressionText.matchAll(pattern)) {
    if (match[1]) qualifiers.add(normalizeName(match[1]));
  }
  return [...qualifiers].sort((left, right) => left.localeCompare(right));
}

function readOccurrenceIdForRelation(
  readOccurrenceByRelationId: ReadonlyMap<string, string>,
  relationId: string,
): string | null {
  return readOccurrenceByRelationId.get(relationId) ?? relationId;
}

/** Facts mark CTE-body scopes with `.(child)`; expressions outside that body must not bind its reads. */
export function cteBodyScopePrefix(scopeId: string | null | undefined): string | null {
  if (!scopeId) return null;
  const marker = ".(child)";
  const index = scopeId.indexOf(marker);
  if (index < 0) return null;
  return scopeId.slice(0, index + marker.length);
}

export function isReadVisibleFromExpressionScope(
  expressionScopeId: string | null,
  readScopeId: string | null,
): boolean {
  const expressionCte = cteBodyScopePrefix(expressionScopeId);
  const readCte = cteBodyScopePrefix(readScopeId);
  if (readCte && readCte !== expressionCte) return false;
  return true;
}

function matchingReads(input: {
  readonly index: RelationTreeIndex;
  readonly leafRelationId: string;
  readonly sourceTable: string;
}): readonly RelationRecord[] {
  const targetTable = tableKey(input.sourceTable);
  const expressionScopeId = input.index.relations.get(input.leafRelationId)?.scopeId ?? null;
  return readRelationsInSubtree(input.index, input.leafRelationId).filter((relation) => {
    if (relation.physicalDataset !== targetTable) return false;
    return isReadVisibleFromExpressionScope(expressionScopeId, relation.scopeId);
  });
}

function relationMatchesQualifier(
  relation: RelationRecord,
  qualifier: string,
  bindingByReadRelation: ReadonlyMap<string, string>,
): boolean {
  const normalizedQualifier = normalizeName(qualifier);
  const binding = bindingByReadRelation.get(relation.relationId);
  if (binding !== undefined && normalizeName(binding) === normalizedQualifier) {
    return true;
  }
  if (relation.scopeId) {
    const scopeTail = relation.scopeId.split(".").at(-1);
    if (scopeTail && normalizeName(scopeTail) === normalizedQualifier) return true;
  }
  const relationSegments = relation.relationId.toLowerCase().split(/[:.]/);
  return relationSegments.includes(normalizedQualifier);
}

function narrowByQualifiers(input: {
  readonly matches: readonly RelationRecord[];
  readonly qualifiers: readonly string[];
  readonly bindingByReadRelation: ReadonlyMap<string, string>;
}): readonly RelationRecord[] {
  if (input.qualifiers.length === 0 || input.matches.length <= 1) return input.matches;
  const narrowed = input.matches.filter((relation) =>
    input.qualifiers.some((qualifier) =>
      relationMatchesQualifier(relation, qualifier, input.bindingByReadRelation),
    ),
  );
  return narrowed.length > 0 ? narrowed : input.matches;
}

export function resolveSourceReadOccurrence(input: {
  readonly taskId: string;
  readonly expressionId: string;
  readonly sourceTable: string;
  readonly sourceColumn: string;
  readonly inputField: JsonRecord;
  readonly expressionText?: string | null;
  readonly leafRelationId: string | null;
  readonly index: RelationTreeIndex;
  readonly readOccurrenceByRelationId: ReadonlyMap<string, string>;
  readonly bindingByReadRelation: ReadonlyMap<string, string>;
}): SourceReadOccurrenceResolution {
  const base = {
    taskId: input.taskId,
    expressionId: input.expressionId,
    sourceTable: input.sourceTable,
    sourceColumn: input.sourceColumn,
  };
  if (!input.leafRelationId) {
    return unresolved({ ...base, reason: "MATERIALIZATION_LEAF_MISSING" });
  }

  const inputQualifier = qualifierFromInput(input.inputField);
  const textQualifiers = expressionQualifiersForColumn(
    input.expressionText,
    input.sourceColumn,
  );
  const qualifiers = [
    ...new Set([
      ...(inputQualifier ? [normalizeName(inputQualifier)] : []),
      ...textQualifiers,
    ]),
  ];

  const matches = narrowByQualifiers({
    matches: matchingReads({
      index: input.index,
      leafRelationId: input.leafRelationId,
      sourceTable: input.sourceTable,
    }),
    qualifiers,
    bindingByReadRelation: input.bindingByReadRelation,
  });
  if (matches.length === 1) {
    const relation = matches[0]!;
    const occurrenceId = readOccurrenceIdForRelation(
      input.readOccurrenceByRelationId,
      relation.relationId,
    );
    if (!occurrenceId) {
      return unresolved({ ...base, reason: "CTE_SCOPE_UNRESOLVED" });
    }
    return resolved(occurrenceId, relation.relationId);
  }
  if (matches.length > 1) {
    return ambiguous({ ...base, reason: "SELF_JOIN_NO_QUALIFIER" });
  }
  return unresolved({ ...base, reason: "CTE_SCOPE_UNRESOLVED" });
}

export function expressionsByRelationAndOrdinal(
  expressions: readonly JsonRecord[],
): ReadonlyMap<string, ReadonlyMap<number, JsonRecord>> {
  const byRelation = new Map<string, Map<number, JsonRecord>>();
  for (const expression of expressions) {
    const relationId = text(expression.relation_id);
    const ordinal = numberValue(expression.ordinal);
    if (!relationId || ordinal === null) continue;
    const ordinals = byRelation.get(relationId) ?? new Map<number, JsonRecord>();
    if (!ordinals.has(ordinal)) ordinals.set(ordinal, expression);
    byRelation.set(relationId, ordinals);
  }
  return byRelation;
}

export function expandSetopBranchExpressions(input: {
  readonly expression: JsonRecord;
  readonly expressionsByRelation: ReadonlyMap<string, ReadonlyMap<number, JsonRecord>>;
  readonly index: RelationTreeIndex;
}): readonly FieldExpressionContext[] {
  const expressionId = text(input.expression.expression_id);
  const relationId = text(input.expression.relation_id);
  const ordinal = numberValue(input.expression.ordinal);
  if (!expressionId || !relationId || ordinal === null) {
    return [{
      expressionId,
      expression: input.expression,
      relationId,
      ordinal,
    }].filter((item): item is FieldExpressionContext => item.expressionId !== null);
  }

  const directRelation = input.index.relations.get(relationId);
  if (directRelation?.relationType === "setop") {
    const nested = expandSetopBranches({
      setopRelation: directRelation,
      ordinal,
      expressionsByRelation: input.expressionsByRelation,
      index: input.index,
    });
    return nested.length > 0
      ? nested
      : [{
        expressionId,
        expression: input.expression,
        relationId,
        ordinal,
      }];
  }

  const setopAncestor = nearestSetopAncestor(input.index, relationId);
  if (!setopAncestor || setopAncestor.setopBranches.length === 0) {
    return [{
      expressionId,
      expression: input.expression,
      relationId,
      ordinal,
    }];
  }
  const branchContexts = expandSetopBranches({
    setopRelation: setopAncestor,
    ordinal,
    expressionsByRelation: input.expressionsByRelation,
    index: input.index,
  });
  return branchContexts.length > 0
    ? branchContexts
    : [{
      expressionId,
      expression: input.expression,
      relationId,
      ordinal,
    }];
}

function expandSetopBranches(input: {
  readonly setopRelation: RelationRecord;
  readonly ordinal: number;
  readonly expressionsByRelation: ReadonlyMap<string, ReadonlyMap<number, JsonRecord>>;
  readonly index: RelationTreeIndex;
  readonly seenSetops?: ReadonlySet<string>;
}): readonly FieldExpressionContext[] {
  const seen = new Set(input.seenSetops ?? []);
  if (seen.has(input.setopRelation.relationId)) return [];
  seen.add(input.setopRelation.relationId);

  const contexts: FieldExpressionContext[] = [];
  for (const branchRelationId of input.setopRelation.setopBranches) {
    const branchRelation = input.index.relations.get(branchRelationId);
    if (branchRelation?.relationType === "setop") {
      contexts.push(...expandSetopBranches({
        setopRelation: branchRelation,
        ordinal: input.ordinal,
        expressionsByRelation: input.expressionsByRelation,
        index: input.index,
        seenSetops: seen,
      }));
      continue;
    }

    const branchExpression = input.expressionsByRelation
      .get(branchRelationId)
      ?.get(input.ordinal);
    if (!branchExpression) continue;
    const expressionId = text(branchExpression.expression_id);
    if (!expressionId) continue;
    const expressionRelationId = text(branchExpression.relation_id) ?? branchRelationId;
    const expressionRelation = input.index.relations.get(expressionRelationId);
    if (expressionRelation?.relationType === "setop") {
      contexts.push(...expandSetopBranches({
        setopRelation: expressionRelation,
        ordinal: numberValue(branchExpression.ordinal) ?? input.ordinal,
        expressionsByRelation: input.expressionsByRelation,
        index: input.index,
        seenSetops: seen,
      }));
      continue;
    }
    contexts.push({
      expressionId,
      expression: branchExpression,
      relationId: expressionRelationId,
      ordinal: numberValue(branchExpression.ordinal),
    });
  }
  return contexts;
}

export function leafRelationIdForExpression(
  expression: JsonRecord,
  materializedLeafRelationId: string | null,
): string | null {
  return materializedLeafRelationId ?? text(expression.relation_id);
}
