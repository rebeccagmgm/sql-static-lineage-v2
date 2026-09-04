import { canonicalMachineFactsJson } from "./canonical-json.js";
import { sha256Hex } from "./sha256.js";

export interface PhysicalFieldKeyInput {
  readonly platform: string;
  readonly dataSource: string;
  readonly stableTableId: string;
  readonly qualifiedName: string;
  readonly column: string;
}

export interface TaskLocalPhysicalDatasetIdentity {
  readonly platform: string | null;
  readonly dataSource: string | null;
  readonly qualifiedName: string;
}

export interface TaskLocalPhysicalFieldIdentity extends PhysicalFieldKeyInput {}

export interface TaskLocalReadOccurrenceIdentity {
  readonly consumerTaskId: string;
  readonly occurrenceId: string;
  readonly readRelationId: string;
}

export interface TaskLocalTargetWriteIdentity {
  readonly taskId: string;
  readonly datasetNodeId: string;
  readonly writeObservationId: string;
}

export interface CausalTargetWriteIdentity {
  readonly taskId: string;
  readonly targetTableKey: string;
  readonly sqlSourceId: string;
  readonly statementOrdinal: number;
  readonly taskWriteOrdinal: number;
  readonly rootRelationId: string;
  readonly writeObservationId: string;
}

function safePathSegment(value: string, label: string): string {
  const reserved = /^(con|prn|aux|nul|clock\$|com[1-9]|lpt[1-9])(?:\..*)?$/i;
  if (
    !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value) ||
    /[. ]$/.test(value) ||
    reserved.test(value)
  ) {
    throw new Error(`${label} must be a safe path segment`);
  }
  return value;
}

function normalizeMachineFactsName(value: string): string {
  return value
    .replace(/[`"\[\]]/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function hashedIdentity(prefix: string, value: unknown): string {
  return `${prefix}:${sha256Hex(canonicalMachineFactsJson(value))}`;
}

export function taskNodeId(taskId: string): string {
  return `task:${safePathSegment(taskId, "taskId")}`;
}

export function machineFactsDatasetId(
  logicalSourceId: string,
  name: string,
): string {
  return `dataset:${safePathSegment(
    logicalSourceId,
    "logical_source_id",
  )}:${normalizeMachineFactsName(name)}`;
}

export function machineFactsFieldId(
  logicalSourceId: string,
  table: string,
  column: string,
): string {
  return `field:${safePathSegment(
    logicalSourceId,
    "logical_source_id",
  )}:${normalizeMachineFactsName(table)}.${normalizeMachineFactsName(column)}`;
}

export function physicalFieldKey(field: PhysicalFieldKeyInput): string {
  return [
    field.platform.trim().toLowerCase(),
    field.dataSource.trim().toLowerCase(),
    field.stableTableId.trim().toLowerCase(),
    field.qualifiedName.trim().toLowerCase(),
    field.column.trim().toLowerCase(),
  ].join("|");
}

export function taskLocalPhysicalDatasetNodeId(
  input: TaskLocalPhysicalDatasetIdentity,
): string {
  return hashedIdentity("dataset", {
    platform: input.platform?.trim().toLowerCase() ?? null,
    dataSource: input.dataSource?.trim().toLowerCase() ?? null,
    qualifiedName: input.qualifiedName.trim().toLowerCase(),
  });
}

export function taskLocalPhysicalFieldNodeId(
  input: TaskLocalPhysicalFieldIdentity,
): string {
  return hashedIdentity("physical-field", {
    platform: input.platform.trim().toLowerCase(),
    dataSource: input.dataSource.trim().toLowerCase(),
    stableTableId: input.stableTableId.trim().toLowerCase(),
    qualifiedName: input.qualifiedName.trim().toLowerCase(),
    column: input.column.trim().toLowerCase(),
  });
}

export function taskLocalReadOccurrenceNodeId(
  input: TaskLocalReadOccurrenceIdentity,
): string {
  return hashedIdentity("read-occurrence", input);
}

export function taskLocalTargetWriteNodeId(
  input: TaskLocalTargetWriteIdentity,
): string {
  return hashedIdentity("target-write", input);
}

/**
 * Builds the richer target-write identity used by target-causal analysis.
 * It intentionally retains the historical `target-write:` prefix used by the
 * distinct task-local target-write node identity.
 */
export function causalTargetWriteId(input: CausalTargetWriteIdentity): string {
  return hashedIdentity("target-write", input);
}

export function sqlParsedWriteObservationId(
  taskId: string,
  statementIndex: number,
): string {
  return `write-observation:${taskId}:${statementIndex}`;
}

export function platformTargetWriteObservationId(
  taskId: string,
  statementIndex: number,
): string {
  return `write-observation:${taskId}:platform-target:${statementIndex}`;
}
