import { describe, expect, it } from "vitest";
import { SqlSession } from "sqllens";
import { buildPlanFacts } from "../scripts/plans/plan-adapter.ts";
import {
	buildScopePlan,
	legacySourceBindingKey,
	summarizeScopePlan,
	type SelectScopePlan,
} from "../scripts/plans/internal/plan-scope-plan.ts";

describe("parallel ScopeTree plan projection", () => {
	it("matches the legacy relation shape for a select/join/filter/aggregate", () => {
		const sql = `
      SELECT a.id, SUM(b.amount) AS total
      FROM demo.a a
      LEFT JOIN demo.b b ON a.id = b.a_id
      WHERE b.status = 'ACTIVE'
      GROUP BY a.id
    `;
		const session = SqlSession.create(sql, "databricks");
		const legacy = buildPlanFacts(session.doc.statements[0]!, sql, {
			dialect: "databricks",
		});
		const projected = buildScopePlan(session.scopes);

		if (projected.kind !== "select") throw new Error("select plan expected");
		const select = projected as SelectScopePlan;
		const legacyReads = legacy.relations
			.filter((relation) => relation.type === "read")
			.map((relation) => relation.binding);
		const legacyJoins = legacy.relations
			.filter((relation) => relation.type === "join")
			.map((relation) => relation.join_type);

		expect(select.sources.map((source) => source.key)).toEqual(legacyReads);
		expect(select.joins.map((join) => join.join.kind)).toEqual(legacyJoins);
		expect(select.from.map((entry) => entry.bindingKey)).toEqual(["a", "b"]);
		expect(select.joins.map((join) => join.sourceIndex)).toEqual([1]);
		expect(select.where).toBeDefined();
		expect(select.aggregate).toBe(true);
		expect(legacy.relations.map((relation) => relation.type)).toEqual([
			"read",
			"read",
			"join",
			"filter",
			"aggregate",
			"project",
		]);
	});

	it("preserves set-op branches as ScopeTree branches", () => {
		const sql = "SELECT id FROM demo.a UNION ALL SELECT id FROM demo.b";
		const session = SqlSession.create(sql, "databricks");
		const legacy = buildPlanFacts(session.doc.statements[0]!, sql, {
			dialect: "databricks",
		});
		const projected = buildScopePlan(session.scopes);

		expect(projected.kind).toBe("setop");
		if (projected.kind !== "setop") return;
		expect(projected.operator).toBe("union");
		expect(projected.branches).toHaveLength(2);
		expect(legacy.relations.find((relation) => relation.type === "setop")).toMatchObject({
			type: "setop",
			setop: "union",
			all: true,
			branches: expect.arrayContaining([expect.any(String), expect.any(String)]),
		});
	});

	it("keeps CTE and subquery Scope boundaries while matching legacy reads", () => {
		const sql = `
      WITH c AS (SELECT id FROM demo.a)
      SELECT x.id
      FROM (SELECT id FROM c) x
    `;
		const session = SqlSession.create(sql, "databricks");
		const legacy = buildPlanFacts(session.doc.statements[0]!, sql, {
			dialect: "databricks",
		});
		const projected = buildScopePlan(session.scopes);

		if (projected.kind !== "select") throw new Error("select plan expected");
		expect(projected.from).toHaveLength(1);
		expect(projected.from[0]?.bindingKey).toBe("x");
		expect(projected.from[0]?.match).toBe("identity");
		expect(projected.children.length).toBeGreaterThan(0);
		expect(legacy.relations.filter((relation) => relation.type === "read")).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ binding: "c", is_cte: true }),
			],
		),
	);
	});

	it("makes unresolved source matching visible instead of guessing", () => {
		const sql = "SELECT id FROM demo.a a, demo.b b";
		const session = SqlSession.create(sql, "databricks");
		const projected = buildScopePlan(session.scopes);

		if (projected.kind !== "select") throw new Error("select plan expected");
		expect(projected.from.map((entry) => entry.match)).toEqual([
			"identity",
			"identity",
		]);
		expect(projected.joins).toHaveLength(0);
		expect(summarizeScopePlan(projected)[0]).toContain("root:select:a,b:a,b:");
	});

	it("uses the native Join source identity when a comma precedes an explicit join", () => {
		const sql = `
      SELECT a.id
      FROM demo.a a, demo.b b
      LEFT JOIN demo.c c ON b.id = c.id
    `;
		const session = SqlSession.create(sql, "databricks");
		const projected = buildScopePlan(session.scopes);

		if (projected.kind !== "select") throw new Error("select plan expected");
		expect(projected.from.map((entry) => entry.bindingKey)).toEqual([
			"a",
			"b",
			"c",
		]);
		expect(projected.joins.map((join) => join.sourceIndex)).toEqual([2]);
		expect(projected.joins.map((join) => join.join.kind)).toEqual(["left"]);
	});

	it.each([
		"SELECT a.id FROM demo.a a LEFT JOIN demo.b b ON a.id = b.a_id",
		"SELECT a.id FROM demo.a a RIGHT JOIN demo.b b ON a.id = b.a_id INNER JOIN demo.c c ON b.id = c.b_id",
		"WITH cte AS (SELECT id FROM demo.a) SELECT x.id FROM (SELECT id FROM cte) x",
	])("keeps new source bindings equal to the legacy matcher: %s", (sql) => {
		const session = SqlSession.create(sql, "databricks");
		const projected = buildScopePlan(session.scopes);

		if (projected.kind !== "select") throw new Error("select plan expected");
		const body = projected.scope.body;
		if (body.kind !== "select") throw new Error("select body expected");
		expect(projected.from.map((entry) => entry.bindingKey)).toEqual(
			body.from.map((source) => legacySourceBindingKey(projected.scope, source)),
		);
	});
});
