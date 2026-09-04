import { describe, expect, it } from "vitest";

import {
  canonicalSemanticApplicationId,
  canonicalSemanticDependencyId,
  canonicalSemanticEdgeId,
  canonicalProofRefId,
  createProofRef,
  makeSemanticDependencyApplication,
  makeSemanticDependencyDefinition,
  makeSemanticDependencyEdge,
} from "../scripts/reconcile/consumer/target-field-causal-slice/semantic-dependency-contract.ts";

describe("semantic dependency contract", () => {
  it("keeps dependency dimensions orthogonal", () => {
    const identity = {
      subject: {
        subjectKind: "PHYSICAL_FIELD" as const,
        physicalFieldId: "hive:warehouse:demo.orders:status",
      },
      effectKind: "BRANCH_SELECTION" as const,
      operatorKind: "PROJECT" as const,
      operatorVariant: "CASE",
      operatorRole: "BRANCH_SELECTOR",
      localEdgeKind: "EXPRESSION_CONTROL" as const,
    };
    const definition = makeSemanticDependencyDefinition(identity, "SUPPORTED", [
      createProofRef("SOURCE_SPAN", "expr:case:0"),
    ]);
    const application = makeSemanticDependencyApplication({
      dependencyId: definition.dependencyId,
      rootTargetFieldId: "hive:warehouse:demo.summary:risk_flag",
      rootDependenceKind: "CONTROL_TO_TARGET",
      pathCertainty: "CONFIRMED",
    });
    const edge = makeSemanticDependencyEdge({
      dependencyId: definition.dependencyId,
      fromSubject: identity.subject,
      toSubject: {
        subjectKind: "PHYSICAL_FIELD",
        physicalFieldId: "hive:warehouse:demo.summary:risk_flag",
      },
      rootDependenceKind: "CONTROL_TO_TARGET",
      localEdgeKind: "EXPRESSION_CONTROL",
      pathCertainty: "CONFIRMED",
    });

    expect(definition.effectKind).toBe("BRANCH_SELECTION");
    expect(definition.localEdgeKind).toBe("EXPRESSION_CONTROL");
    expect(application.rootDependenceKind).toBe("CONTROL_TO_TARGET");
    expect(edge.pathCertainty).toBe("CONFIRMED");
    expect(edge.edgeId).toBe(
      canonicalSemanticEdgeId({
        dependencyId: definition.dependencyId,
        fromSubject: identity.subject,
        toSubject: {
          subjectKind: "PHYSICAL_FIELD",
          physicalFieldId: "hive:warehouse:demo.summary:risk_flag",
        },
        rootDependenceKind: "CONTROL_TO_TARGET",
        localEdgeKind: "EXPRESSION_CONTROL",
      }),
    );
  });

  it("generates deterministic IDs independent of object property order", () => {
    const left = canonicalSemanticDependencyId({
      subject: {
        subjectKind: "RELATION_OCCURRENCE",
        relationOccurrenceId: "relation:task-1:scope-2",
      },
      effectKind: "RELATION_EXISTENCE",
      operatorKind: "SUBQUERY",
      operatorVariant: "EXISTS",
      operatorRole: "RELATION",
      localEdgeKind: "RELATION_CONTEXT",
    });
    const right = canonicalSemanticDependencyId({
      localEdgeKind: "RELATION_CONTEXT",
      operatorRole: "RELATION",
      operatorVariant: "EXISTS",
      operatorKind: "SUBQUERY",
      effectKind: "RELATION_EXISTENCE",
      subject: {
        relationOccurrenceId: "relation:task-1:scope-2",
        subjectKind: "RELATION_OCCURRENCE",
      },
    });

    expect(left).toBe(right);
    expect(left).toMatch(/^semantic-dependency:[0-9a-f]{64}$/);
    expect(canonicalProofRefId("SOURCE_SPAN", "expr:1")).toBe(
      canonicalProofRefId("SOURCE_SPAN", "expr:1"),
    );
    expect(
      canonicalSemanticApplicationId("target:f", left, "VALUE_TO_TARGET"),
    ).not.toBe(
      canonicalSemanticApplicationId("target:f", left, "CONTROL_TO_TARGET"),
    );
  });

  it("sorts proof refs while retaining path certainty and support separately", () => {
    const first = createProofRef("SOURCE_SPAN", "span:1");
    const second = createProofRef("CANONICAL_FACT", "fact:1");
    const definition = makeSemanticDependencyDefinition(
      {
        subject: {
          subjectKind: "RELATION_OCCURRENCE",
          relationOccurrenceId: "relation:1",
        },
        effectKind: "RELATION_EXISTENCE",
        operatorKind: "RELATION",
        operatorVariant: "LITERAL_FROM_RELATION",
        operatorRole: "RELATION",
        localEdgeKind: "RELATION_CONTEXT",
      },
      "SUPPORTED",
      [first, second],
    );

    expect(definition.supportStatus).toBe("SUPPORTED");
    const application = makeSemanticDependencyApplication({
      dependencyId: definition.dependencyId,
      rootTargetFieldId: "target:literal-from-relation",
      rootDependenceKind: "RELATION_TO_TARGET",
      pathCertainty: "CONDITIONAL",
    });
    expect(application.pathCertainty).toBe("CONDITIONAL");
    expect(definition.proofRefs.map((ref) => ref.proofRefId)).toEqual(
      [...definition.proofRefs].map((ref) => ref.proofRefId).sort(),
    );
  });
});
