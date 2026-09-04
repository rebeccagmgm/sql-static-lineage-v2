import { describe, expect, it } from "vitest";

import type { PhysicalFieldExpansion } from "../../scripts/reconcile/consumer/field-lineage/physical-field-expander.ts";
import { guardOccurrenceExactPhysicalExpansion } from "../../scripts/reconcile/consumer/target-field-causal-slice/strict-physical-expansion.ts";

const field = {
  platform: "hive",
  dataSource: "warehouse",
  stableTableId: "demo.source__warehouse",
  qualifiedName: "demo.source",
  column: "amount",
  identityStatus: "SCHEMA_BACKED",
} as const;

function expansion(writeObservationIds: readonly string[]): PhysicalFieldExpansion {
  return {
    classified: true,
    ambiguous: false,
    candidates: [],
    gaps: [],
    producers: [
      {
        producerTaskId: "producer",
        producerPack: null,
        producerField: field,
        producerBindings: writeObservationIds.map((writeObservationId, index) => ({
          binding_id: `binding:${index}`,
          write_observation_id: writeObservationId,
        })),
        bridge: null,
        bridges: [],
        producerRole: "PRIMARY",
        evidenceStatus: "CONFIRMED",
        evidenceRefs: ["producer-evidence"],
        shouldRecurse: true,
      },
    ],
  };
}

describe("strict causal physical expansion guard", () => {
  it("preserves one occurrence-exact confirmed producer write", () => {
    const original = expansion(["write:1"]);

    expect(guardOccurrenceExactPhysicalExpansion({
      taskId: "consumer",
      sourceNodeId: "source-node",
      field,
      expansion: original,
    })).toBe(original);
  });

  it("fails closed when a confirmed producer expansion aggregates sibling writes", () => {
    const result = guardOccurrenceExactPhysicalExpansion({
      taskId: "consumer",
      sourceNodeId: "source-node",
      field,
      expansion: expansion(["write:1", "write:2"]),
    });

    expect(result.ambiguous).toBe(true);
    expect(result.producers).toEqual([]);
    expect(result.gaps).toEqual([
      expect.objectContaining({
        reasonCode: "PRODUCER_WRITE_OBSERVATION_AMBIGUOUS",
        evidenceStatus: "UNRESOLVED",
        evidenceRefs: expect.arrayContaining([
          "write:1",
          "write:2",
          "binding:0",
          "binding:1",
        ]),
      }),
    ]);
  });

  it("also catches sibling writes split across confirmed producer groups", () => {
    const base = expansion(["write:1"]);
    const second = {
      ...base.producers[0]!,
      producerBindings: [{
        binding_id: "binding:2",
        write_observation_id: "write:2",
      }],
    };

    const result = guardOccurrenceExactPhysicalExpansion({
      taskId: "consumer",
      sourceNodeId: "source-node",
      field,
      expansion: { ...base, producers: [base.producers[0]!, second] },
    });

    expect(result.ambiguous).toBe(true);
    expect(result.producers).toEqual([]);
  });
});
