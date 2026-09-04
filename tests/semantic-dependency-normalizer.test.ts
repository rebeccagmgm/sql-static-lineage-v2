import { describe, expect, it } from "vitest";

import {
  normalizeSemanticDependencies,
  type SemanticDependencyNormalizerInput,
} from "../scripts/reconcile/consumer/target-field-causal-slice/semantic-dependency-normalizer.ts";
import {
  crossJoinPlan,
  existsPlan,
  semanticNormalizerPlan,
  column,
  expression,
  plan,
  read,
} from "./fixtures/field-lineage/semantic-dependency-normalizer.ts";
import { testSemanticRoot } from "./fixtures/field-lineage/semantic-occurrence-scope.ts";

function normalize(
  planFacts: Parameters<typeof normalizeSemanticDependencies>[0]["plan"],
  rootTargetFieldId: string,
  relationId: string,
  outputName?: string,
): ReturnType<typeof normalizeSemanticDependencies> {
  const input: SemanticDependencyNormalizerInput = {
    plan: planFacts,
    ...testSemanticRoot(planFacts, {
      rootTargetFieldId,
      relationId,
      ...(outputName === undefined ? {} : { outputName }),
    }),
  };
  return normalizeSemanticDependencies(input);
}

describe("semantic dependency normalizer", () => {
  it("creates canonical definitions, per-root applications, and independent semantic edges", () => {
    const legacy = [{ edgeId: "legacy-value", kind: "VALUE_FLOW" }];
    const result = normalizeSemanticDependencies({
      plan: semanticNormalizerPlan,
      ...testSemanticRoot(semanticNormalizerPlan, {
        rootTargetFieldId: "target:amount-out",
        relationId: "project",
        outputName: "amount_out",
      }),
      legacyEdges: legacy,
    });

    expect(result.definitions.length).toBeGreaterThan(0);
    expect(result.applications.length).toBeGreaterThan(0);
    expect(result.edges.length).toBe(result.semanticEdges.length);
    expect(result.legacyEdges).toEqual(legacy);
    expect(
      result.edges.every(
        (edge) =>
          edge.localEdgeKind !== "VALUE_FLOW" ||
          edge.rootDependenceKind === "VALUE_TO_TARGET",
      ),
    ).toBe(true);
    expect(
      result.definitions.some(
        (definition) =>
          definition.operatorVariant === "CASE" &&
          definition.operatorRole === "BRANCH_SELECTOR" &&
          definition.effectKind === "BRANCH_SELECTION",
      ),
    ).toBe(true);
    expect(
      result.definitions.some(
        (definition) =>
          definition.operatorVariant === "CASE" &&
          definition.operatorRole === "BRANCH_VALUE" &&
          definition.localEdgeKind === "VALUE_FLOW",
      ),
    ).toBe(true);
  });

  it("splits CASE, IF, and COALESCE selector/value roles", () => {
    const definitions = [
      ["amount_out", "target:case"],
      ["score_out", "target:if"],
      ["fallback_out", "target:coalesce"],
    ].flatMap(
      ([outputName, rootTargetFieldId]) =>
        normalize(
          semanticNormalizerPlan,
          rootTargetFieldId,
          "project",
          outputName,
        ).definitions,
    );
    const keys = new Set(
      definitions.map(
        (definition) =>
          `${definition.operatorVariant}:${definition.operatorRole}:${definition.effectKind}`,
      ),
    );
    for (const variant of ["CASE", "IF", "COALESCE"])
      expect(keys.has(`${variant}:BRANCH_SELECTOR:BRANCH_SELECTION`)).toBe(
        true,
      );
    for (const variant of ["CASE", "IF", "COALESCE"])
      expect(keys.has(`${variant}:BRANCH_VALUE:VALUE_CONTRIBUTION`)).toBe(true);
  });

  it("normalizes rowset, join, grouping, setop, window, and Top-N controls", () => {
    const definitions = [
      normalize(semanticNormalizerPlan, "target:top", "top", "score_out"),
      normalize(semanticNormalizerPlan, "target:union", "union_all", "id"),
      normalize(semanticNormalizerPlan, "target:window", "project", "rolling"),
    ].flatMap((result) => result.definitions);
    const variants = new Set(
      definitions.map((definition) => definition.operatorVariant),
    );
    for (const variant of [
      "LEFT",
      "WHERE",
      "GROUP_BY",
      "UNION_ALL",
      "LIMIT",
      "WINDOW_PARTITION_BY",
      "WINDOW_ORDER_BY",
    ])
      expect(variants.has(variant), variant).toBe(true);
    expect(
      definitions.some(
        (definition) =>
          definition.operatorVariant === "WINDOW_PARTITION_BY" &&
          definition.localEdgeKind === "WINDOW_CONTEXT",
      ),
    ).toBe(true);
    expect(
      definitions.some(
        (definition) =>
          definition.operatorVariant === "LIMIT" &&
          definition.operatorRole === "ORDER_KEY",
      ),
    ).toBe(true);
  });

  it("emits relation subjects for COUNT(*), EXISTS, CROSS JOIN, and literal-from-relation", () => {
    const aggregate = normalize(
      semanticNormalizerPlan,
      "target:aggregate",
      "aggregate",
      "cnt",
    );
    expect(
      aggregate.definitions.filter(
        (definition) => definition.operatorVariant === "COUNT_STAR",
      ),
    ).toHaveLength(4);
    expect(
      aggregate.definitions.some(
        (definition) =>
          definition.subject.subjectKind === "RELATION_OCCURRENCE",
      ),
    ).toBe(true);

    const exists = normalize(existsPlan, "target:exists", "exists");
    expect(
      exists.definitions.some(
        (definition) => definition.operatorVariant === "EXISTS",
      ),
    ).toBe(true);
    expect(exists.definitions[0]?.subject.subjectKind).toBe(
      "RELATION_OCCURRENCE",
    );

    const cross = normalize(crossJoinPlan, "target:literal", "literal", "flag");
    expect(
      cross.definitions.some(
        (definition) => definition.operatorVariant === "CROSS_JOIN",
      ),
    ).toBe(true);
    expect(
      cross.definitions.some(
        (definition) => definition.operatorVariant === "LITERAL_FROM_RELATION",
      ),
    ).toBe(true);
  });

  it("keeps missing structure and unknown operators as hard negative-proof gaps", () => {
    const incomplete = plan(
      [
        read("source", "source"),
        {
          id: "project",
          type: "project",
          span: { start: 0, end: 5 },
          provenance: "extracted",
          output_columns: null,
          expressions: [
            expression("value", "case", [column("source", "value")]),
          ],
        },
        {
          id: "other",
          type: "other",
          span: { start: 0, end: 5 },
          provenance: "unknown",
          output_columns: null,
          body_kind: "pipe",
          note: "fixture",
        },
      ],
      ["project", "other"],
    );
    const result = normalize(
      incomplete,
      "target:incomplete",
      "project",
      "value",
    );
    expect(
      result.gaps.some((gap) => gap.reasonCode === "STRUCTURALLY_INCOMPLETE"),
    ).toBe(true);

    const unknown = normalize(incomplete, "target:unknown", "other");
    expect(unknown.gaps.length).toBeGreaterThan(0);
    expect(unknown.gaps.every((gap) => gap.blocksNegativeProof)).toBe(true);
    expect(unknown.gaps.some((gap) => gap.operatorVariant === "PIPE")).toBe(
      true,
    );
  });

  it("uses the shared physical resolver when Plan Facts supplies physical identities", () => {
    const calls: string[] = [];
    const result = normalizeSemanticDependencies({
      plan: semanticNormalizerPlan,
      ...testSemanticRoot(semanticNormalizerPlan, {
        rootTargetFieldId: "target:amount",
        relationId: "project",
        outputName: "amount_out",
      }),
      physicalFieldResolver: {
        resolve(reference) {
          calls.push(`${reference.table}.${reference.column}`);
          return {
            platform: "hive",
            dataSource: "warehouse",
            stableTableId: `table:${reference.table}`,
            qualifiedName: reference.table,
            column: reference.column,
            identityStatus: "SCHEMA_BACKED",
          };
        },
      },
    });
    expect(calls.length).toBeGreaterThan(0);
    expect(
      result.definitions.some(
        (definition) =>
          definition.subject.subjectKind === "PHYSICAL_FIELD" &&
          definition.subject.physicalFieldId.includes("table:trade"),
      ),
    ).toBe(true);
  });
});
