export interface PlanAdapterRoleFixture {
	name: string;
	sql: string;
	schema: Record<string, Record<string, string>>;
	dialect?: "databricks" | "tsql";
}

export const planAdapterRoleFixtures: readonly PlanAdapterRoleFixture[] = [
	{
		name: "case",
		sql: "SELECT CASE WHEN t.flag = 1 THEN t.a ELSE t.b END AS result FROM demo.t t",
		schema: { "demo.t": { flag: "int", a: "int", b: "int" } },
	},
	{
		name: "simple-case",
		sql: "SELECT CASE t.kind WHEN 'a' THEN t.a WHEN 'b' THEN t.b ELSE 0 END AS result FROM demo.t t",
		schema: { "demo.t": { kind: "string", a: "int", b: "int" } },
	},
	{
		name: "if",
		sql: "SELECT IF(t.flag = 1, t.a, t.b) AS result FROM demo.t t",
		schema: { "demo.t": { flag: "int", a: "int", b: "int" } },
	},
	{
		name: "coalesce",
		sql: "SELECT COALESCE(t.a, t.b, 0) AS result FROM demo.t t",
		schema: { "demo.t": { a: "int", b: "int" } },
	},
	{
		name: "window-frame",
		sql: "SELECT SUM(t.a) OVER (PARTITION BY t.k ORDER BY t.ts ROWS BETWEEN 2 PRECEDING AND CURRENT ROW) AS result FROM demo.t t",
		schema: {
			"demo.t": { a: "int", k: "int", ts: "timestamp" },
		},
	},
	{
		name: "top-n",
		sql: "SELECT t.a FROM demo.t t ORDER BY t.ts DESC LIMIT 10",
		schema: { "demo.t": { a: "int", ts: "timestamp" } },
	},
	{
		name: "top-n-offset-only",
		sql: "SELECT t.a FROM demo.t t ORDER BY t.ts DESC OFFSET 5 ROWS",
		schema: { "demo.t": { a: "int", ts: "timestamp" } },
		dialect: "tsql",
	},
	{
		name: "top-n-setop",
		sql: "SELECT 1 AS a\nUNION ALL\nSELECT 2 AS a\nORDER BY a DESC\nLIMIT 1",
		schema: {},
	},
	{
		name: "top-n-except",
		sql: "SELECT 1 AS a\nEXCEPT\nSELECT 2 AS a\nORDER BY a DESC\nLIMIT 1",
		schema: {},
	},
	{
		name: "top-n-intersect",
		sql: "SELECT 1 AS a\nINTERSECT\nSELECT 2 AS a\nORDER BY a DESC\nLIMIT 1",
		schema: {},
	},
];
