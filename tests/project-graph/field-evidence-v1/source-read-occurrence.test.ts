import { describe, expect, it } from "vitest";

import {
  buildRelationTreeIndex,
  controlSideForJoin,
  normalizeJoinType,
  readRelationsInSubtree,
  relationSubtree,
  withIncomingRelations,
} from "../../../scripts/project-graph/field-evidence-v1/relation-tree.ts";
import {
  expandSetopBranchExpressions,
  expressionsByRelationAndOrdinal,
  resolveSourceReadOccurrence,
} from "../../../scripts/project-graph/field-evidence-v1/source-read-occurrence.ts";

describe("source-read-occurrence", () => {
  it("resolves a single read relation under the leaf expression subtree", () => {
    const relationNodes = [
      {
        relation_id: "rel:read:0",
        relation_type: "read",
        relation: { table: "demo.source", type: "read", binding: "s" },
      },
      {
        relation_id: "rel:project:0",
        relation_type: "project",
        relation: { type: "project" },
      },
    ];
    const relationEdges = [
      {
        from_relation_id: "rel:read:0",
        to_relation_id: "rel:project:0",
      },
    ];
    const index = withIncomingRelations(
      buildRelationTreeIndex(relationNodes),
      relationEdges,
    );
    const resolution = resolveSourceReadOccurrence({
      taskId: "task-1",
      expressionId: "expr:0",
      sourceTable: "demo.source",
      sourceColumn: "id",
      inputField: { table: "demo.source", column: "id" },
      leafRelationId: "rel:project:0",
      index,
      readOccurrenceByRelationId: new Map([["rel:read:0", "occ:0"]]),
      bindingByReadRelation: new Map([["rel:read:0", "s"]]),
    });
    expect(resolution.sourceReadOccurrenceStatus).toBe("RESOLVED");
    expect(resolution.sourceReadOccurrenceId).toBe("occ:0");
    expect(resolution.sourceRelationId).toBe("rel:read:0");
    expect(resolution.gap).toBeNull();
  });

  it("marks self-join reads without qualifier as ambiguous", () => {
    const relationNodes = [
      {
        relation_id: "rel:read:left",
        relation_type: "read",
        relation: { table: "demo.source", type: "read", binding: "a", scope_id: "root.a" },
      },
      {
        relation_id: "rel:read:right",
        relation_type: "read",
        relation: { table: "demo.source", type: "read", binding: "b", scope_id: "root.b" },
      },
      {
        relation_id: "rel:join:0",
        relation_type: "join",
        relation: { type: "join", scope_id: "root" },
      },
    ];
    const relationEdges = [
      { from_relation_id: "rel:read:left", to_relation_id: "rel:join:0" },
      { from_relation_id: "rel:read:right", to_relation_id: "rel:join:0" },
    ];
    const index = withIncomingRelations(
      buildRelationTreeIndex(relationNodes),
      relationEdges,
    );
    const resolution = resolveSourceReadOccurrence({
      taskId: "task-1",
      expressionId: "expr:0",
      sourceTable: "demo.source",
      sourceColumn: "id",
      inputField: { table: "demo.source", column: "id" },
      leafRelationId: "rel:join:0",
      index,
      readOccurrenceByRelationId: new Map([
        ["rel:read:left", "occ:left"],
        ["rel:read:right", "occ:right"],
      ]),
      bindingByReadRelation: new Map(),
    });
    expect(resolution.sourceReadOccurrenceStatus).toBe("AMBIGUOUS");
    expect(resolution.sourceReadOccurrenceReason).toBe("SELF_JOIN_NO_QUALIFIER");
    expect(resolution.gap?.reasonCode).toBe("FIELD_SOURCE_READ_OCCURRENCE_AMBIGUOUS");
  });

  it("excludes CTE-body reads when the expression is outside that CTE scope", () => {
    const relationNodes = [
      {
        relation_id: "rel:root.a.read.source",
        relation_type: "read",
        relation: {
          table: "demo.source",
          type: "read",
          binding: "source",
          scope_id: "root.a",
        },
      },
      {
        relation_id: "rel:root.(child).t.read.source",
        relation_type: "read",
        relation: {
          table: "demo.source",
          type: "read",
          binding: "source",
          scope_id: "root.(child).t",
        },
      },
      {
        relation_id: "rel:root.read.temp",
        relation_type: "read",
        relation: {
          table: "demo.temp",
          type: "read",
          binding: "temp",
          scope_id: "root",
        },
      },
      {
        relation_id: "rel:root.project",
        relation_type: "project",
        relation: { type: "project", scope_id: "root" },
      },
    ];
    const relationEdges = [
      { from_relation_id: "rel:root.(child).t.read.source", to_relation_id: "rel:root.read.temp" },
      { from_relation_id: "rel:root.read.temp", to_relation_id: "rel:root.project" },
      { from_relation_id: "rel:root.a.read.source", to_relation_id: "rel:root.project" },
    ];
    const index = withIncomingRelations(
      buildRelationTreeIndex(relationNodes),
      relationEdges,
    );
    const resolution = resolveSourceReadOccurrence({
      taskId: "task-1",
      expressionId: "expr:0",
      sourceTable: "demo.source",
      sourceColumn: "amount",
      inputField: { table: "demo.source", column: "amount" },
      leafRelationId: "rel:root.project",
      index,
      readOccurrenceByRelationId: new Map([
        ["rel:root.a.read.source", "occ:main"],
        ["rel:root.(child).t.read.source", "occ:cte"],
      ]),
      bindingByReadRelation: new Map([
        ["rel:root.a.read.source", "source"],
        ["rel:root.(child).t.read.source", "source"],
      ]),
    });
    expect(resolution.sourceReadOccurrenceStatus).toBe("RESOLVED");
    expect(resolution.sourceReadOccurrenceId).toBe("occ:main");
    expect(resolution.sourceRelationId).toBe("rel:root.a.read.source");
  });

  it("resolves same-table joins using qualifier from expression text against path/scope", () => {
    const relationNodes = [
      {
        relation_id: "rel:root.b.read.lookup",
        relation_type: "read",
        relation: {
          table: "demo.lookup",
          type: "read",
          binding: "lookup",
          scope_id: "root.b",
        },
      },
      {
        relation_id: "rel:root.c.read.lookup",
        relation_type: "read",
        relation: {
          table: "demo.lookup",
          type: "read",
          binding: "lookup",
          scope_id: "root.c",
        },
      },
      {
        relation_id: "rel:root.project",
        relation_type: "project",
        relation: { type: "project", scope_id: "root" },
      },
    ];
    const relationEdges = [
      { from_relation_id: "rel:root.b.read.lookup", to_relation_id: "rel:root.project" },
      { from_relation_id: "rel:root.c.read.lookup", to_relation_id: "rel:root.project" },
    ];
    const index = withIncomingRelations(
      buildRelationTreeIndex(relationNodes),
      relationEdges,
    );
    const resolution = resolveSourceReadOccurrence({
      taskId: "task-1",
      expressionId: "expr:0",
      sourceTable: "demo.lookup",
      sourceColumn: "code",
      inputField: { table: "demo.lookup", column: "code" },
      expressionText: "NVL(B.CODE, ASSET_TYPE) AS Asset_Type",
      leafRelationId: "rel:root.project",
      index,
      readOccurrenceByRelationId: new Map([
        ["rel:root.b.read.lookup", "occ:b"],
        ["rel:root.c.read.lookup", "occ:c"],
      ]),
      bindingByReadRelation: new Map([
        ["rel:root.b.read.lookup", "lookup"],
        ["rel:root.c.read.lookup", "lookup"],
      ]),
    });
    expect(resolution.sourceReadOccurrenceStatus).toBe("RESOLVED");
    expect(resolution.sourceReadOccurrenceId).toBe("occ:b");
  });

  it("expands setop branches by output ordinal", () => {
    const relationNodes = [
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
    ];
    const expressions = [
      {
        expression_id: "expr:top",
        relation_id: "rel:setop",
        ordinal: 1,
        expression_text: "gamma",
        input_fields: [{ table: "demo.a", column: "gamma" }],
      },
      {
        expression_id: "expr:b0",
        relation_id: "rel:b0.project",
        ordinal: 1,
        expression_text: "gamma",
        input_fields: [{ table: "demo.a", column: "gamma" }],
      },
      {
        expression_id: "expr:b1",
        relation_id: "rel:b1.project",
        ordinal: 1,
        expression_text: "gamma",
        input_fields: [{ table: "demo.b", column: "gamma" }],
      },
    ];
    const index = withIncomingRelations(
      buildRelationTreeIndex(relationNodes),
      [],
    );
    const contexts = expandSetopBranchExpressions({
      expression: expressions[0]!,
      expressionsByRelation: expressionsByRelationAndOrdinal(expressions),
      index,
    });
    expect(contexts.map((context) => context.expressionId).sort()).toEqual([
      "expr:b0",
      "expr:b1",
    ]);
  });

  it("recursively expands nested setop branches to leaf projects", () => {
    const relationNodes = [
      {
        relation_id: "rel:outer.setop",
        relation_type: "setop",
        relation: {
          type: "setop",
          branches: ["rel:inner.setop", "rel:b2.project"],
        },
      },
      {
        relation_id: "rel:inner.setop",
        relation_type: "setop",
        relation: {
          type: "setop",
          branches: ["rel:b0.project", "rel:b1.project"],
        },
      },
      { relation_id: "rel:b0.project", relation_type: "project", relation: { type: "project" } },
      { relation_id: "rel:b1.project", relation_type: "project", relation: { type: "project" } },
      { relation_id: "rel:b2.project", relation_type: "project", relation: { type: "project" } },
    ];
    const expressions = [
      {
        expression_id: "expr:outer",
        relation_id: "rel:outer.setop",
        ordinal: 0,
        expression_text: "UNION_OUTPUT(id)",
        input_fields: [{ table: "demo.t", column: "id" }],
      },
      {
        expression_id: "expr:inner",
        relation_id: "rel:inner.setop",
        ordinal: 0,
        expression_text: "UNION_OUTPUT(id)",
        input_fields: [{ table: "demo.t", column: "id" }],
      },
      {
        expression_id: "expr:b0",
        relation_id: "rel:b0.project",
        ordinal: 0,
        expression_text: "id",
        input_fields: [{ table: "demo.t", column: "id" }],
      },
      {
        expression_id: "expr:b1",
        relation_id: "rel:b1.project",
        ordinal: 0,
        expression_text: "id1 AS id",
        input_fields: [{ table: "demo.t", column: "id" }],
      },
      {
        expression_id: "expr:b2",
        relation_id: "rel:b2.project",
        ordinal: 0,
        expression_text: "id2 AS id",
        input_fields: [{ table: "demo.t", column: "id" }],
      },
    ];
    const contexts = expandSetopBranchExpressions({
      expression: expressions[0]!,
      expressionsByRelation: expressionsByRelationAndOrdinal(expressions),
      index: withIncomingRelations(buildRelationTreeIndex(relationNodes), []),
    });
    expect(contexts.map((context) => context.expressionId).sort()).toEqual([
      "expr:b0",
      "expr:b1",
      "expr:b2",
    ]);
  });
});

describe("relation-tree", () => {
  it("collects read relations in a subtree and normalizes join types", () => {
    const relationNodes = [
      {
        relation_id: "rel:left",
        relation_type: "project",
        relation: { type: "project" },
      },
      {
        relation_id: "rel:read:0",
        relation_type: "read",
        relation: { table: "demo.source", type: "read" },
      },
      {
        relation_id: "rel:join:0",
        relation_type: "join",
        relation: {
          type: "join",
          join_type: "left",
          left: "rel:left",
          right: "rel:right",
        },
      },
    ];
    const relationEdges = [
      { from_relation_id: "rel:read:0", to_relation_id: "rel:left" },
      { from_relation_id: "rel:left", to_relation_id: "rel:join:0" },
    ];
    const index = withIncomingRelations(
      buildRelationTreeIndex(relationNodes),
      relationEdges,
    );
    expect(readRelationsInSubtree(index, "rel:join:0").map((item) => item.relationId)).toEqual([
      "rel:read:0",
    ]);
    expect(relationSubtree(index, "rel:join:0")).toEqual(new Set(["rel:join:0", "rel:left", "rel:read:0"]));
    expect(normalizeJoinType("LEFT OUTER")).toBe("LEFT");
    const joinRelation = index.relations.get("rel:join:0")!;
    expect(
      controlSideForJoin({
        index,
        joinRelation,
        controlReadRelationId: "rel:read:0",
      }),
    ).toBe("LEFT");
  });
});
