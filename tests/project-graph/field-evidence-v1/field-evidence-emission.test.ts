import { describe, expect, it } from "vitest";

import {
  buildFieldEvidenceIndexes,
  emitFieldEvidenceForInput,
  expressionAcceptsSourceField,
} from "../../../scripts/project-graph/field-evidence-v1/field-evidence-emission.ts";
import type { PhysicalFieldIdentity } from "../../../scripts/reconcile/consumer/field-lineage/field-lineage-contract.ts";

function field(qualifiedName: string, column: string): PhysicalFieldIdentity {
  return {
    platform: "hive",
    dataSource: "gfhive",
    stableTableId: `table:${qualifiedName}`,
    qualifiedName,
    column,
    identityStatus: "SCHEMA_BACKED",
  };
}

describe("field-evidence emission branch scoping", () => {
  it("rejects sources absent from the branch expression input_fields", () => {
    const branch = {
      expression_id: "expr:b1",
      relation_id: "rel:b1.project",
      ordinal: 0,
      expression_text: "m.vega as vega",
      input_fields: [{ table: "demo.hold", column: "vega" }],
    };
    expect(expressionAcceptsSourceField(branch, field("demo.hold", "vega"))).toBe(true);
    expect(expressionAcceptsSourceField(branch, field("demo.opt", "vega"))).toBe(false);
    expect(expressionAcceptsSourceField({
      ...branch,
      input_fields: [],
    }, field("demo.hold", "vega"))).toBe(false);
  });

  it("emits only branch-local sources after setop ordinal sink", () => {
    const relationNodes = [
      {
        relation_id: "rel:root.project",
        relation_type: "project",
        relation: { type: "project" },
      },
      {
        relation_id: "rel:setop",
        relation_type: "setop",
        relation: {
          type: "setop",
          branches: ["rel:b0.project", "rel:b1.project"],
        },
      },
      { relation_id: "rel:b0.project", relation_type: "project", relation: { type: "project" } },
      { relation_id: "rel:b1.project", relation_type: "project", relation: { type: "project" } },
      {
        relation_id: "rel:b0.read.opt",
        relation_type: "read",
        relation: { type: "read", table: "demo.opt", binding: "opt" },
      },
      {
        relation_id: "rel:b1.read.hold",
        relation_type: "read",
        relation: { type: "read", table: "demo.hold", binding: "m" },
      },
    ];
    const relationEdges = [
      { from_relation_id: "rel:setop", to_relation_id: "rel:root.project" },
      { from_relation_id: "rel:b0.project", to_relation_id: "rel:setop" },
      { from_relation_id: "rel:b1.project", to_relation_id: "rel:setop" },
      { from_relation_id: "rel:b0.read.opt", to_relation_id: "rel:b0.project" },
      { from_relation_id: "rel:b1.read.hold", to_relation_id: "rel:b1.project" },
    ];
    const expressions = [
      {
        expression_id: "expr:root",
        relation_id: "rel:root.project",
        ordinal: 0,
        expression_text: "vega",
        input_fields: [
          { table: "demo.opt", column: "vega" },
          { table: "demo.hold", column: "vega" },
        ],
      },
      {
        expression_id: "expr:b0",
        relation_id: "rel:b0.project",
        ordinal: 0,
        expression_text: "opt.vega",
        input_fields: [{ table: "demo.opt", column: "vega" }],
      },
      {
        expression_id: "expr:b1",
        relation_id: "rel:b1.project",
        ordinal: 0,
        expression_text: "m.vega",
        input_fields: [{ table: "demo.hold", column: "vega" }],
      },
    ];
    const indexes = buildFieldEvidenceIndexes({
      taskId: "t1",
      expressions,
      relationNodes,
      relationEdges,
      datasetIoReads: [
        {
          direction: "READ",
          read_occurrences: [
            { relation_id: "rel:b0.read.opt", occurrence_id: "occ:opt" },
            { relation_id: "rel:b1.read.hold", occurrence_id: "occ:hold" },
          ],
        },
      ],
    });

    const foreignOnB1 = emitFieldEvidenceForInput({
      taskId: "t1",
      expression: expressions[0]!,
      sourceField: field("demo.opt", "vega"),
      inputField: { table: "demo.opt", column: "vega" },
      expanded: {
        field: field("demo.opt", "vega"),
        materializationBridgeIds: [],
        leafExpressionId: "expr:root",
        leafRelationId: "rel:root.project",
        pathHadAggregation: false,
        subtypeHops: [],
      },
      indexes,
    });
    expect(foreignOnB1.map((item) => item.expressionContexts[0]?.expressionId)).toEqual([
      "expr:b0",
    ]);
    expect(foreignOnB1[0]?.sourceResolution.sourceReadOccurrenceStatus).toBe("RESOLVED");
    expect(foreignOnB1[0]?.sourceResolution.sourceRelationId).toBe("rel:b0.read.opt");

    const holdOnBranches = emitFieldEvidenceForInput({
      taskId: "t1",
      expression: expressions[0]!,
      sourceField: field("demo.hold", "vega"),
      inputField: { table: "demo.hold", column: "vega" },
      expanded: {
        field: field("demo.hold", "vega"),
        materializationBridgeIds: [],
        leafExpressionId: "expr:root",
        leafRelationId: "rel:root.project",
        pathHadAggregation: false,
        subtypeHops: [],
      },
      indexes,
    });
    expect(holdOnBranches.map((item) => item.expressionContexts[0]?.expressionId)).toEqual([
      "expr:b1",
    ]);
    expect(holdOnBranches[0]?.sourceResolution.sourceReadOccurrenceStatus).toBe("RESOLVED");
  });
});
