import { describe, expect, it } from "vitest";
import { Schema, SqlSession } from "sqllens";
import { resolveReadPartitionScope } from "../scripts/evidence/sql-read-scope.ts";
import { buildPlanFacts } from "../scripts/plans/plan-adapter.ts";
import { resolveReadOccurrences } from "../scripts/plans/read-occurrence-resolver.ts";

function resolve(sql: string, tables: readonly string[]) {
  const schema = new Schema(
    Object.fromEntries(
      tables.map((table) => [
        table,
        {
          id: "int",
          busi_date: "date",
          grp_id: "string",
        },
      ]),
    ),
  );
  const session = SqlSession.create(sql, "databricks", { schema });
  const plan = buildPlanFacts(session.doc.statements[0]!, sql, {
    dialect: "databricks",
    schema,
    include_expression_dependencies: true,
  });
  return { plan, occurrences: resolveReadOccurrences(plan) };
}

function literalValues(tree: unknown): string[] {
  if (!tree || typeof tree !== "object") return [];
  const value = tree as {
    kind?: string;
    children?: unknown[];
    child?: unknown;
    operands?: { kind?: string; observedValue?: string | null }[];
  };
  if (value.kind === "AND" || value.kind === "OR")
    return (value.children ?? []).flatMap(literalValues);
  if (value.kind === "NOT") return literalValues(value.child);
  return (value.operands ?? [])
    .filter(
      (operand) => operand.kind === "LITERAL" && operand.observedValue !== null,
    )
    .map((operand) => operand.observedValue!);
}

describe("read occurrence predicate resolver", () => {
  it("assigns independent filters and keeps a cross-table JOIN as local unknown evidence", () => {
    const { occurrences } = resolve(
      "SELECT a.id FROM demo.a a JOIN demo.b b ON a.id = b.id WHERE a.busi_date = '2026-08-23' AND b.busi_date = '2026-08-24'",
      ["demo.a", "demo.b"],
    );
    expect(occurrences).toHaveLength(2);
    expect(occurrences.map((item) => item.binding)).toEqual(["a", "b"]);
    expect(
      occurrences.map((item) => literalValues(item.predicateTree)),
    ).toEqual([["2026-08-23"], ["2026-08-24"]]);
    expect(
      occurrences.every((item) => item.bindingStatus === "CONSTRAINED"),
    ).toBe(true);
    expect(
      occurrences.every((item) =>
        item.predicateEvidence.some(
          (evidence) =>
            evidence.relationType === "join" &&
            evidence.disposition === "UNKNOWN" &&
            evidence.reasonCodes.includes(
              "READ_OCCURRENCE_CROSS_TABLE_PREDICATE_NOT_PUSHDOWN",
            ),
        ),
      ),
    ).toBe(true);
  });

  it("retains two READ occurrences for two aliases of one physical table", () => {
    const { plan, occurrences } = resolve(
      "SELECT x.id FROM demo.a x JOIN demo.a y ON x.id = y.id WHERE x.busi_date = '2026-08-23' AND y.busi_date = '2026-08-24'",
      ["demo.a"],
    );
    expect(
      plan.relations
        .filter((relation) => relation.type === "read")
        .map((r) => r.id),
    ).toEqual(["root.read.x", "root.read.y"]);
    expect(
      occurrences.map((item) => [
        item.binding,
        literalValues(item.predicateTree),
      ]),
    ).toEqual([
      ["x", ["2026-08-23"]],
      ["y", ["2026-08-24"]],
    ]);
    expect(
      occurrences.every((item) => item.bindingStatus === "CONSTRAINED"),
    ).toBe(true);
  });

  it("crosses a CTE scope only through the explicit scope binding", () => {
    const { plan, occurrences } = resolve(
      "WITH base AS (SELECT id, busi_date FROM demo.a WHERE busi_date = '2026-08-23') SELECT id FROM base WHERE busi_date = '2026-08-24'",
      ["demo.a"],
    );
    expect(plan.scope_bindings).toEqual([
      expect.objectContaining({
        relation_id: "root.read.base",
        target_relation_id: "root.(child).project",
      }),
    ]);
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]?.table).toBe("demo.a");
    expect(literalValues(occurrences[0]?.predicateTree).sort()).toEqual([
      "2026-08-23",
      "2026-08-24",
    ]);
    expect(
      occurrences[0]?.predicateEvidence.map((item) => item.relationId),
    ).toEqual(["root.filter", "root.(child).filter"]);
  });

  it("retains separate physical occurrences when one CTE is referenced twice", () => {
    const { occurrences } = resolve(
      "WITH base AS (SELECT id, busi_date FROM demo.a WHERE busi_date = '2026-08-23') SELECT x.id FROM base x JOIN base y ON x.id = y.id WHERE x.busi_date = '2026-08-24' AND y.busi_date = '2026-08-25'",
      ["demo.a"],
    );
    expect(occurrences).toHaveLength(2);
    expect(
      occurrences.map((item) => [
        item.binding,
        literalValues(item.predicateTree),
      ]),
    ).toEqual([
      ["x", ["2026-08-24", "2026-08-23"]],
      ["y", ["2026-08-25", "2026-08-23"]],
    ]);
    expect(new Set(occurrences.map((item) => item.readRelationId))).toEqual(
      new Set(["root.(child).read.a"]),
    );
  });

  it("keeps an unmapped child-scope UNKNOWN local to that scope", () => {
    const { plan } = resolve(
      "WITH base AS (SELECT id FROM demo.a WHERE id = 1) SELECT b.id FROM demo.b b JOIN base x ON b.id = x.id WHERE b.id = 2",
      ["demo.a", "demo.b"],
    );
    const childFilter = plan.relations.find(
      (relation) => relation.id === "root.(child).filter",
    );
    expect(childFilter?.type).toBe("filter");
    if (childFilter?.type === "filter")
      childFilter.source = "missing-child-source";

    const occurrences = resolveReadOccurrences(plan);
    const base = occurrences.find((item) => item.table === "demo.a");
    const unrelated = occurrences.find((item) => item.table === "demo.b");
    expect(base?.bindingStatus).toBe("UNKNOWN");
    expect(base?.reasonCodes).toContain(
      "READ_OCCURRENCE_SCOPE_REACHABILITY_UNKNOWN",
    );
    expect(unrelated?.bindingStatus).toBe("CONSTRAINED");
    expect(unrelated?.reasonCodes).not.toContain(
      "READ_OCCURRENCE_SCOPE_REACHABILITY_UNKNOWN",
    );
  });

  it("does not invent a partition pushdown through an aggregate subquery", () => {
    const { occurrences } = resolve(
      "SELECT x.busi_date FROM (SELECT busi_date, count(*) AS n FROM demo.a GROUP BY busi_date) x WHERE x.busi_date = '2026-08-23'",
      ["demo.a"],
    );
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]?.bindingStatus).toBe("UNKNOWN");
    expect(occurrences[0]?.reasonCodes).toContain(
      "READ_OCCURRENCE_AGGREGATE_BOUNDARY_NOT_PUSHDOWN",
    );
  });

  it("distributes a direct outer predicate to each UNION branch", () => {
    const { occurrences } = resolve(
      "SELECT id FROM (SELECT id, busi_date FROM demo.a UNION ALL SELECT id, busi_date FROM demo.b) x WHERE busi_date = '2026-08-23'",
      ["demo.a", "demo.b"],
    );
    expect(occurrences).toHaveLength(2);
    expect(
      occurrences.every((item) => item.bindingStatus === "CONSTRAINED"),
    ).toBe(true);
    expect(
      occurrences.every((item) =>
        item.reasonCodes.includes("READ_OCCURRENCE_SETOP_BRANCH_DISTRIBUTED"),
      ),
    ).toBe(true);
  });

  it("keeps an OR over one table for the existing ReadScope resolver", () => {
    const { occurrences } = resolve(
      "SELECT id FROM demo.a WHERE busi_date = '2026-08-23' OR grp_id = '01'",
      ["demo.a"],
    );
    const predicate = occurrences[0]?.predicateTree;
    expect(predicate?.kind).toBe("OR");
    const scope = resolveReadPartitionScope({
      predicate: predicate ?? null,
      tableQualifiedName: "demo.a",
      partitionFields: ["busi_date"],
    });
    expect(scope.status).toBe("PARTIAL");
    expect(scope.predicate).toBeNull();
  });

  it("matches a resolved qualified table to its SQL-visible bare table name", () => {
    const scope = resolveReadPartitionScope({
      predicate: {
        kind: "ATOM",
        operator: "IN",
        operands: [
          {
            kind: "COLUMN",
            expression: "src_tbl",
            column: {
              name: "src_tbl",
              clause: "where",
              physical: [{ table: "T03_AGT_STATI_INFO_H", column: "src_tbl" }],
            },
          },
          {
            kind: "LITERAL",
            expression: "'ODATA_N_TIT.D_TRD_OTC_TRADE'",
            observedValue: "ODATA_N_TIT.D_TRD_OTC_TRADE",
          },
        ],
        span: { start: 0, end: 1 },
      },
      tableQualifiedName: "pdata_n.t03_agt_stati_info_h",
      partitionFields: ["src_tbl"],
    });
    expect(scope.status).toBe("CONSTRAINED");
    expect(scope.predicate).toMatchObject({
      kind: "ATOM",
      field: "src_tbl",
      operator: "IN",
    });
  });

  it("keeps local filters while marking a correlated EXISTS as unknown", () => {
    const { occurrences } = resolve(
      "SELECT a.id FROM demo.a a WHERE a.busi_date = '2026-08-23' AND EXISTS (SELECT 1 FROM demo.b b WHERE b.id = a.id)",
      ["demo.a", "demo.b"],
    );
    const base = occurrences.find((item) => item.table === "demo.a");
    const correlated = occurrences.find((item) => item.table === "demo.b");
    expect(base?.bindingStatus).toBe("CONSTRAINED");
    expect(base?.reasonCodes).toContain(
      "READ_OCCURRENCE_CORRELATED_SUBQUERY_NOT_PUSHDOWN",
    );
    expect(correlated?.bindingStatus).toBe("UNKNOWN");
  });
});
