import { canonicalMachineFactsJson as canonicalJson } from "../../../src/contracts/canonical-json.js";
import { sha256Hex as sha256 } from "../../../src/contracts/sha256.js";

/** Copied from data-graph project-topology-contract; keep frozen vectors in sync. */
export function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function stableId(prefix: string, value: unknown): string {
  return `${prefix}:${sha256(canonicalJson(value))}`;
}

export function taskLocalEdgeId(input: {
  readonly edgeType: string;
  readonly fromNodeId: string;
  readonly toNodeId: string;
  readonly semanticKey?: unknown;
}): string {
  return stableId("edge", input);
}

export function fieldDirectEdgeSemanticKey(input: {
  readonly outputColumn: string;
  readonly sourceColumn: string;
  readonly sourceTable: string;
  readonly sourceReadOccurrenceId: string | null;
  readonly expressionId: string;
}): Readonly<Record<string, string | null>> {
  return {
    outputColumn: input.outputColumn,
    sourceColumn: input.sourceColumn,
    sourceTable: input.sourceTable,
    sourceReadOccurrenceId: input.sourceReadOccurrenceId,
    expressionId: input.expressionId,
  };
}

export function fieldConditionalEdgeSemanticKey(input: {
  readonly outputColumn: string;
  readonly sourceColumn: string;
  readonly sourceTable: string;
  readonly sourceReadOccurrenceId: string | null;
  readonly expressionId: string;
  readonly conditionalId: string;
}): Readonly<Record<string, string | null>> {
  return {
    outputColumn: input.outputColumn,
    sourceColumn: input.sourceColumn,
    sourceTable: input.sourceTable,
    sourceReadOccurrenceId: input.sourceReadOccurrenceId,
    expressionId: input.expressionId,
    conditionalId: input.conditionalId,
  };
}
