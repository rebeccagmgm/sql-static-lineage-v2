import {
  canonicalJson,
  sha256,
} from "../../../scripts/machine-facts/machine-facts-contract.ts";
import {
  globalExpressionId,
  globalRelationId,
} from "../../../scripts/machine-facts/plan-occurrence-id.ts";
import type {
  PlanFacts,
  PlanRelation,
} from "../../../scripts/plans/plan-contract.ts";
import {
  makeSemanticOccurrenceScope,
  type SemanticOccurrenceScope,
} from "../../../scripts/reconcile/consumer/target-field-causal-slice/semantic-dependency-contract.ts";
import type { RootCriterion } from "../../../scripts/reconcile/consumer/target-field-causal-slice/write-scoped-plan-inputs.ts";

interface TestSemanticRootOptions {
  readonly rootTargetFieldId: string;
  readonly relationId?: string;
  readonly outputName?: string;
}

export interface TestSemanticRoot {
  readonly rootCriterion: RootCriterion;
  readonly semanticScope: SemanticOccurrenceScope;
}

function expressions(relation: PlanRelation): {
  readonly role: string;
  readonly outputs: readonly string[];
} {
  if (relation.type === "project")
    return {
      role: "PROJECT_EXPRESSION",
      outputs: (relation.expressions ?? []).map((item) => item.output),
    };
  if (relation.type === "aggregate")
    return {
      role: "AGGREGATE_MEASURE",
      outputs: (relation.measures ?? []).map((item) => item.output),
    };
  if (relation.type === "setop")
    return {
      role: "SETOP_OUTPUT",
      outputs: (relation.output_columns ?? []).map(String),
    };
  return {
    role: "RELATION_OUTPUT",
    outputs: (relation.output_columns ?? []).map(String),
  };
}

export function testSemanticRoot(
  plan: PlanFacts,
  options: TestSemanticRootOptions,
): TestSemanticRoot {
  const relationId = options.relationId ?? plan.roots[0];
  if (!relationId) throw new Error("test semantic root relation is required");
  const relation = plan.relations.find((item) => item.id === relationId);
  if (!relation)
    throw new Error(`test semantic root relation is missing: ${relationId}`);
  const selection = expressions(relation);
  const sourceOrdinal =
    options.outputName === undefined
      ? 0
      : selection.outputs.findIndex(
          (output) =>
            output.toLowerCase() === options.outputName!.toLowerCase(),
        );
  const ordinal = sourceOrdinal >= 0 ? sourceOrdinal : 0;
  const statementIndex = plan.meta.statement_index;
  const taskId = "test-semantic-normalizer";
  const statementId = `task:${taskId}:statement:${statementIndex}`;
  const localOutputExpressionId = `${relationId}:expression:${selection.role.toLowerCase()}:${ordinal}`;
  const rootRelationId = globalRelationId(taskId, statementIndex, relationId);
  const outputExpressionId = globalExpressionId(
    taskId,
    statementIndex,
    localOutputExpressionId,
  );
  const identity = {
    rootTargetFieldId: options.rootTargetFieldId,
    relationId,
    outputName: options.outputName ?? null,
    statementIndex,
  };
  const identityHash = sha256(canonicalJson(identity));
  const writeObservationId = `write-observation:${taskId}:${identityHash}`;
  const rootCriterion: RootCriterion = {
    rootCriterionId: `root-criterion:${identityHash}`,
    rootTaskId: taskId,
    targetTableKey: "test|fixture|target",
    targetFieldName: options.outputName ?? "relation",
    rootTargetFieldId: options.rootTargetFieldId,
    targetFieldBindingId: `field-binding:${identityHash}`,
    rootWriteObservationId: writeObservationId,
    writeKind: "TEST",
    sqlSourceId: "sql:test-semantic-normalizer:fixture",
    sqlSnapshot: "snapshots/sql/test-semantic-normalizer.sql",
    sqlSha256: "fixture",
    writeStatementId: statementId,
    writeStatementIndex: statementIndex,
    statementId,
    statementIndex,
    queryProducerStatementId: statementId,
    rootRelationId,
    outputExpressionId,
    outputBindingId: `output-binding:${identityHash}`,
    sourceOrdinal: ordinal,
    targetOrdinal: ordinal,
    producerOutputName: options.outputName ?? null,
    expressionRole: selection.role,
    localRootRelationId: relationId,
    localOutputExpressionId,
    evidenceRefs: [
      writeObservationId,
      statementId,
      rootRelationId,
      outputExpressionId,
    ],
  };
  return {
    rootCriterion,
    semanticScope: makeSemanticOccurrenceScope({ rootCriterion }),
  };
}
