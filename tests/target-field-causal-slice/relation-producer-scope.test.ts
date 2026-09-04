import { describe, expect, it } from "vitest";

import {
  resolveUnambiguousRelationProducerScopes,
  selectSingleWriteProducerScopes,
} from "../../scripts/reconcile/consumer/target-field-causal-slice/relation-producer-scope.ts";

function scope(writeObservationId: string, field: string) {
  return {
    field,
    localRootCriterion: {
      rootWriteObservationId: writeObservationId,
    },
  };
}

describe("relation producer scope selection", () => {
  it("keeps multiple output fields from one exact producer write", () => {
    const scopes = [scope("write:1", "a"), scope("write:1", "b")];

    expect(selectSingleWriteProducerScopes(scopes, 2)).toEqual(scopes);
  });

  it("fails closed when a table-level bridge spans sibling writes", () => {
    const scopes = [scope("write:1", "a"), scope("write:2", "b")];

    expect(selectSingleWriteProducerScopes(scopes, 2)).toBeNull();
  });

  it("fails closed when not every output binding resolves", () => {
    const scopes = [scope("write:1", "a")];

    expect(selectSingleWriteProducerScopes(scopes, 2)).toBeNull();
  });

  const write = (id: string) => ({
    task_id: "producer",
    direction: "WRITE",
    physical_dataset: "db.target",
    write_observation_id: id,
  });
  const binding = (id: string, field: string) => ({
    task_id: "producer",
    target_dataset: "db.target",
    target_field: field,
    binding_status: "RESOLVED",
    write_observation_id: id,
  });
  const resolve = (row: Readonly<Record<string, unknown>>) => [
    scope(String(row.write_observation_id), String(row.target_field)),
  ];

  it("resolves production bridge evidence for one write with many fields", () => {
    const result = resolveUnambiguousRelationProducerScopes({
      producerTaskId: "producer",
      targetTable: "db.target",
      datasetWrites: [write("write:1")],
      outputBindings: [binding("write:1", "a"), binding("write:1", "b")],
      resolveBinding: resolve,
    });

    expect(result?.map((item) => item.field)).toEqual(["a", "b"]);
  });

  it("fails closed when all bindings expose two writes to the same table", () => {
    const result = resolveUnambiguousRelationProducerScopes({
      producerTaskId: "producer",
      targetTable: "db.target",
      datasetWrites: [write("write:1"), write("write:2")],
      outputBindings: [binding("write:1", "a"), binding("write:2", "b")],
      resolveBinding: resolve,
    });

    expect(result).toBeNull();
  });

  it("fails closed when a sibling table write has no resolved binding", () => {
    const result = resolveUnambiguousRelationProducerScopes({
      producerTaskId: "producer",
      targetTable: "db.target",
      datasetWrites: [write("write:1"), write("write:2")],
      outputBindings: [binding("write:1", "a")],
      resolveBinding: resolve,
    });

    expect(result).toBeNull();
  });
});
