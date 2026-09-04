import { describe, expect, it } from "vitest";
import { Schema, SqlSession } from "sqllens";
import {
  buildPlanFacts,
  EXPRESSION_DEPENDENCY_ADAPTER_VERSION,
} from "../scripts/plans/plan-adapter.ts";
import { taskSqlDialect } from "../scripts/plans/task-sql-dialect.ts";
import { resolveReadPartitionScope } from "../scripts/evidence/sql-read-scope.ts";
import { planAdapterRoleFixtures } from "./fixtures/plan-adapter/roles.ts";

describe("plan adapter star expansion", () => {
  it("retains structured filter predicates and physical partition origins", () => {
    const sql =
      "SELECT id FROM demo.events e WHERE e.busi_date = '2026-08-23' AND e.grp_id IN ('01', '02')";
    const schema = new Schema({
      "demo.events": { busi_date: "date", grp_id: "string", id: "int" },
    });
    const session = SqlSession.create(sql, "databricks", { schema });
    const plan = buildPlanFacts(session.doc.statements[0]!, sql, {
      dialect: "databricks",
      schema,
      include_expression_dependencies: true,
    });
    const filter = plan.relations.find(
      (relation) => relation.type === "filter",
    );
    if (filter?.type !== "filter") throw new Error("filter relation missing");
    expect(filter.predicate_tree).toMatchObject({
      kind: "AND",
      children: [
        {
          kind: "ATOM",
          operator: "EQ",
          operands: [
            {
              kind: "COLUMN",
              column: {
                physical: [{ table: "demo.events", column: "busi_date" }],
              },
            },
            { kind: "LITERAL", observedValue: "2026-08-23" },
          ],
        },
        {
          kind: "ATOM",
          operator: "IN",
          operands: [
            {
              kind: "COLUMN",
              column: {
                physical: [{ table: "demo.events", column: "grp_id" }],
              },
            },
            { kind: "LITERAL", observedValue: "01" },
            { kind: "LITERAL", observedValue: "02" },
          ],
        },
      ],
    });
    const readScope = resolveReadPartitionScope({
      predicate: filter.predicate_tree ?? null,
      tableQualifiedName: "demo.events",
      partitionFields: ["busi_date"],
    });
    expect(readScope).toMatchObject({
      status: "CONSTRAINED",
      predicate: {
        kind: "ATOM",
        field: "busi_date",
        operator: "EQ",
      },
    });
  });

  it("keeps unsafe partition boolean branches partial or unknown", () => {
    const schema = new Schema({
      "demo.events": { busi_date: "date", grp_id: "string", id: "int" },
    });
    for (const [sql, partitionFields, expectedStatus] of [
      [
        "SELECT id FROM demo.events WHERE busi_date = '2026-08-23' OR grp_id = '01'",
        ["busi_date", "grp_id"],
        "PARTIAL",
      ],
      [
        "SELECT id FROM demo.events WHERE NOT (busi_date = '2026-08-23')",
        ["busi_date"],
        "UNKNOWN",
      ],
    ] as const) {
      const session = SqlSession.create(sql, "databricks", { schema });
      const plan = buildPlanFacts(session.doc.statements[0]!, sql, {
        dialect: "databricks",
        schema,
        include_expression_dependencies: true,
      });
      const filter = plan.relations.find(
        (relation) => relation.type === "filter",
      );
      if (filter?.type !== "filter")
        throw new Error("filter relation missing");
      expect(
        resolveReadPartitionScope({
          predicate: filter.predicate_tree ?? null,
          tableQualifiedName: "demo.events",
          partitionFields,
        }).status,
      ).toBe(expectedStatus);
    }
  });

  it("uses the Oracle-compatible parser profile for Oracle source tasks", () => {
    expect(taskSqlDialect("oracle2hive")).toBe("duckdb");
    expect(taskSqlDialect("oracle2oracle")).toBe("duckdb");
    expect(taskSqlDialect("postgre2hive")).toBe("duckdb");
    expect(taskSqlDialect("postgre2postgre")).toBe("duckdb");
    expect(taskSqlDialect("hive2oracle")).toBe("databricks");
  });

  it("parses PostgreSQL three-part quoted source names with the PostgreSQL-compatible profile", () => {
    const sql = 'SELECT id FROM aums."a_epa"."tcust_rela"';
    const session = SqlSession.create(sql, taskSqlDialect("postgre2hive"));
    expect(session.doc.statements[0]?.errors).toBe(0);
  });

  it("preserves native physical origins through a nested scalar subquery", () => {
    const sql =
      "SELECT x.y AS result FROM (SELECT (SELECT l.value FROM demo.lookup l WHERE l.id = t.id) AS y FROM demo.base t) x";
    const schema = new Schema({
      "demo.base": { id: "int" },
      "demo.lookup": { id: "int", value: "int" },
    });
    const session = SqlSession.create(sql, "databricks", { schema });

    const plan = buildPlanFacts(session.doc.statements[0]!, sql, {
      dialect: "databricks",
      schema,
      include_expression_dependencies: true,
    });

    const rootProject = plan.relations.find(
      (relation) =>
        relation.id === "root.project" && relation.type === "project",
    );
    if (rootProject?.type !== "project")
      throw new Error("root project relation missing");
    expect(rootProject.expressions[0]?.input_columns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resolution: "PHYSICAL",
          physical: [{ table: "demo.lookup", column: "value" }],
        }),
      ]),
    );
  });

  it("keeps native origins from a scalar subquery inside a mixed expression", () => {
    const sql =
      "SELECT CASE WHEN t.flag = 1 THEN (SELECT l.value FROM demo.lookup l WHERE l.id = t.id) ELSE t.fallback END AS result FROM demo.base t";
    const schema = new Schema({
      "demo.base": { id: "int", flag: "int", fallback: "int" },
      "demo.lookup": { id: "int", value: "int" },
    });
    const session = SqlSession.create(sql, "databricks", { schema });

    const plan = buildPlanFacts(session.doc.statements[0]!, sql, {
      dialect: "databricks",
      schema,
      include_expression_dependencies: true,
    });

    const rootProject = plan.relations.find(
      (relation) =>
        relation.id === "root.project" && relation.type === "project",
    );
    if (rootProject?.type !== "project")
      throw new Error("root project relation missing");
    const physical =
      rootProject.expressions[0]?.input_columns?.flatMap(
        (input) => input.physical ?? [],
      ) ?? [];
    expect(physical).toEqual(
      expect.arrayContaining([
        { table: "demo.base", column: "flag" },
        { table: "demo.base", column: "fallback" },
        { table: "demo.lookup", column: "value" },
      ]),
    );
  });

  it("preserves native window partition and order origins", () => {
    const sql =
      "SELECT ROW_NUMBER() OVER (PARTITION BY t.k ORDER BY t.ts) AS rn FROM demo.events t";
    const schema = new Schema({
      "demo.events": { k: "int", ts: "timestamp" },
    });
    const session = SqlSession.create(sql, "databricks", { schema });

    const plan = buildPlanFacts(session.doc.statements[0]!, sql, {
      dialect: "databricks",
      schema,
      include_expression_dependencies: true,
    });

    const rootProject = plan.relations.find(
      (relation) =>
        relation.id === "root.project" && relation.type === "project",
    );
    if (rootProject?.type !== "project")
      throw new Error("root project relation missing");
    const physical =
      rootProject.expressions[0]?.input_columns?.flatMap(
        (input) => input.physical ?? [],
      ) ?? [];
    expect(physical).toEqual(
      expect.arrayContaining([
        { table: "demo.events", column: "k" },
        { table: "demo.events", column: "ts" },
      ]),
    );
  });

  it("treats explicitly configured bare system values as derived outputs", () => {
    const sql = "SELECT sysdate AS created_at FROM demo.source";
    const schema = new Schema({
      "demo.source": { id: "int" },
    });
    const session = SqlSession.create(sql, "databricks", { schema });

    const plan = buildPlanFacts(session.doc.statements[0]!, sql, {
      dialect: "databricks",
      schema,
      system_value_names: ["sysdate"],
      include_expression_dependencies: true,
    });

    expect(plan.unknowns).toEqual([]);
    const rootProject = plan.relations.find(
      (relation) =>
        relation.id === "root.project" && relation.type === "project",
    );
    if (rootProject?.type !== "project")
      throw new Error("root project relation missing");
    expect(rootProject.expressions[0]?.input_columns).toMatchObject([
      {
        name: "sysdate",
        resolution: "DERIVED_OUTPUT",
        derived_from: "SYSTEM_VALUE:SYSDATE",
      },
    ]);
  });

  it("resolves backtick-quoted columns against schema evidence", () => {
    const sql =
      "SELECT t.id FROM demo.trade t JOIN demo.mapping m ON t.id = m.`condition`";
    const schema = new Schema({
      "demo.trade": { id: "int" },
      "demo.mapping": { condition: "string" },
    });
    const session = SqlSession.create(sql, "databricks", { schema });

    const plan = buildPlanFacts(session.doc.statements[0]!, sql, {
      dialect: "databricks",
      schema,
      include_expression_dependencies: true,
    });

    expect(plan.unknowns).toEqual([]);
    const join = plan.relations.find(
      (relation) => relation.type === "join",
    );
    expect(join?.type).toBe("join");
    if (join?.type !== "join") throw new Error("join relation missing");
    expect(join.condition_columns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "`condition`",
          resolution: "PHYSICAL",
          physical: [{ table: "demo.mapping", column: "condition" }],
        }),
      ]),
    );
  });

  it("surfaces native lineage failures as plan unknowns", () => {
    const sql = "SELECT (SELECT l.value FROM demo.lookup l) AS result";
    let failNextSchemaLookup = true;
    const schema = {
      columnsFor: (parts: string[]) => {
        if (failNextSchemaLookup) {
          failNextSchemaLookup = false;
          throw new Error("synthetic native lineage failure");
        }
        return parts.join(".").toLowerCase() === "demo.lookup"
          ? [{ name: "value" }]
          : undefined;
      },
    };
    const session = SqlSession.create(sql, "databricks");

    const plan = buildPlanFacts(session.doc.statements[0]!, sql, {
      dialect: "databricks",
      schema,
      include_expression_dependencies: true,
    });

    expect(plan.unknowns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "native_lineage",
          reason: expect.stringContaining("synthetic native lineage failure"),
        }),
      ]),
    );
  });

  it("keeps a set-operation subquery star unresolved instead of crashing", () => {
    const sql = "SELECT * FROM (SELECT 1 AS a UNION ALL SELECT 2 AS a) x";
    const session = SqlSession.create(sql, "databricks");

    const plan = buildPlanFacts(session.doc.statements[0]!, sql, {
      statement_index: 0,
      dialect: "databricks",
    });

    expect(plan.relations.length).toBeGreaterThan(0);
    const rootProject = plan.relations.find(
      (relation) => relation.id === "root.project",
    );
    expect(rootProject?.type).toBe("project");
    if (rootProject?.type !== "project")
      throw new Error("root project relation missing");
    expect(rootProject.expressions[0]?.output_name_status).toBe(
      "STAR_EXPANSION",
    );
    expect(rootProject.expressions[0]?.input_columns).toBeUndefined();
  });

  it("classifies schema-backed star origins as partial without inventing a native hop", () => {
    const sql = "SELECT * FROM demo.source";
    const schema = new Schema({
      "demo.source": { id: "int", amount: "decimal" },
    });
    const session = SqlSession.create(sql, "databricks", { schema });

    const plan = buildPlanFacts(session.doc.statements[0]!, sql, {
      dialect: "databricks",
      schema,
      include_expression_dependencies: true,
    });

    const starRoots = plan.lineage_hops.roots.filter((root) =>
      root.root_expression_id.startsWith("root.project:expression:"),
    );
    expect(starRoots).toHaveLength(2);
    expect(starRoots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          head_hop_id: null,
          coverage_state: "FLAT_ORIGIN_ONLY",
          projection_status: "PARTIAL_NATIVE",
          reason_code: "NATIVE_STAR_COLUMN_ANCHOR_UNAVAILABLE",
          physical_input_fields: [{ table: "demo.source", column: "id" }],
        }),
        expect.objectContaining({
          head_hop_id: null,
          coverage_state: "FLAT_ORIGIN_ONLY",
          projection_status: "PARTIAL_NATIVE",
          physical_input_fields: [{ table: "demo.source", column: "amount" }],
        }),
      ]),
    );
    expect(plan.lineage_hops.nodes).toEqual([]);
    expect(plan.lineage_hops.edges).toEqual([]);
  });

  it("keeps star unevaluable when schema cannot prove its physical origins", () => {
    const sql = "SELECT * FROM demo.source";
    const session = SqlSession.create(sql, "databricks");

    const plan = buildPlanFacts(session.doc.statements[0]!, sql, {
      dialect: "databricks",
      include_expression_dependencies: true,
    });

    expect(plan.lineage_hops.roots).toContainEqual(
      expect.objectContaining({
        coverage_state: "NOT_EVALUABLE",
        projection_status: "NOT_EVALUABLE",
        reason_code: "NATIVE_STAR_COLUMN_ANCHOR_UNAVAILABLE",
        head_hop_id: null,
      }),
    );
  });

  it("preserves lateral output columns as derived outputs", () => {
    const sql =
      "SELECT y.pos FROM demo.base t LATERAL VIEW posexplode(array(1)) y AS pos, val";
    const session = SqlSession.create(sql, "databricks");
    const plan = buildPlanFacts(session.doc.statements[0]!, sql, {
      dialect: "databricks",
      schema: {
        columnsFor: (parts: string[]) =>
          parts.join(".").toLowerCase() === "demo.base"
            ? [{ name: "id" }]
            : undefined,
      },
      include_expression_dependencies: true,
    });

    expect(plan.unknowns).toEqual([]);
    const rootProject = plan.relations.find(
      (relation) =>
        relation.id === "root.project" && relation.type === "project",
    );
    if (rootProject?.type !== "project")
      throw new Error("root project relation missing");
    expect(rootProject.expressions[0]?.input_columns?.[0]).toMatchObject({
      name: "pos",
      qualifier: "y",
      resolution: "DERIVED_OUTPUT",
    });
  });

  it("propagates physical inputs through a lateral-derived subquery output", () => {
    const sql =
      "SELECT x.busi_date FROM (SELECT date_add(t.dt, y.pos) AS busi_date FROM demo.base t LATERAL VIEW posexplode(array(1)) y AS pos, val) x";
    const session = SqlSession.create(sql, "databricks");
    const plan = buildPlanFacts(session.doc.statements[0]!, sql, {
      dialect: "databricks",
      schema: {
        columnsFor: (parts: string[]) =>
          parts.join(".").toLowerCase() === "demo.base"
            ? [{ name: "dt" }]
            : undefined,
      },
      include_expression_dependencies: true,
    });

    expect(plan.unknowns).toEqual([]);
    const rootProject = plan.relations.find(
      (relation) =>
        relation.id === "root.project" && relation.type === "project",
    );
    if (rootProject?.type !== "project")
      throw new Error("root project relation missing");
    expect(rootProject.expressions[0]?.input_columns).toMatchObject([
      {
        name: "busi_date",
        qualifier: "x",
        resolution: "PHYSICAL",
        physical: [{ table: "demo.base", column: "dt" }],
      },
    ]);
  });

  it("propagates physical inputs through a computed lateral-derived output", () => {
    const sql =
      "SELECT c_sp.busi_date FROM (SELECT date_add(strt_date, pos) AS busi_date FROM (SELECT start_date AS strt_date FROM demo.source) x LATERAL VIEW posexplode(array(1)) y AS pos, val) c_sp";
    const session = SqlSession.create(sql, "databricks");
    const plan = buildPlanFacts(session.doc.statements[0]!, sql, {
      dialect: "databricks",
      schema: {
        columnsFor: (parts: string[]) =>
          parts.join(".").toLowerCase() === "demo.source"
            ? [{ name: "start_date" }]
            : undefined,
      },
      include_expression_dependencies: true,
    });

    const rootProject = plan.relations.find(
      (relation) =>
        relation.id === "root.project" && relation.type === "project",
    );
    if (rootProject?.type !== "project")
      throw new Error("root project relation missing");
    expect(plan.unknowns).toEqual([]);
    expect(rootProject.expressions[0]?.input_columns).toMatchObject([
      {
        name: "busi_date",
        qualifier: "c_sp",
        resolution: "PHYSICAL",
        physical: [{ table: "demo.source", column: "start_date" }],
      },
    ]);
  });

  it("does not promote a computed lateral-derived output without base schema evidence", () => {
    const sql =
      "SELECT c_sp.busi_date FROM (SELECT date_add(strt_date, pos) AS busi_date FROM (SELECT start_date AS strt_date FROM demo.source) x LATERAL VIEW posexplode(array(1)) y AS pos, val) c_sp";
    const session = SqlSession.create(sql, "databricks");
    const plan = buildPlanFacts(session.doc.statements[0]!, sql, {
      dialect: "databricks",
      schema: { columnsFor: () => undefined },
      include_expression_dependencies: true,
    });

    const rootProject = plan.relations.find(
      (relation) =>
        relation.id === "root.project" && relation.type === "project",
    );
    if (rootProject?.type !== "project")
      throw new Error("root project relation missing");
    expect(rootProject.expressions[0]?.input_columns?.[0]?.resolution).not.toBe(
      "PHYSICAL",
    );
  });

  it("resolves unqualified outputs from a set-operation derived table", () => {
    const sql =
      "SELECT rec_id FROM (SELECT concat('a', id) AS rec_id FROM demo.a UNION ALL SELECT concat('b', id) AS rec_id FROM demo.b) casttable";
    const session = SqlSession.create(sql, "databricks");
    const schema = {
      columnsFor: (parts: string[]) => {
        const table = parts.join(".").toLowerCase();
        return table === "demo.a" || table === "demo.b"
          ? [{ name: "id" }]
          : undefined;
      },
    };
    const plan = buildPlanFacts(session.doc.statements[0]!, sql, {
      dialect: "databricks",
      schema,
      include_expression_dependencies: true,
    });

    expect(plan.unknowns).toEqual([]);
    const rootProject = plan.relations.find(
      (relation) =>
        relation.id === "root.project" && relation.type === "project",
    );
    if (rootProject?.type !== "project")
      throw new Error("root project relation missing");
    expect(rootProject.expressions[0]?.input_columns?.[0]).toMatchObject({
      name: "rec_id",
      resolution: "PHYSICAL",
      physical: [
        { table: "demo.a", column: "id" },
        { table: "demo.b", column: "id" },
      ],
    });
  });

  // sqllens@1.8.0 does not preserve simple-CASE subjects in the IR `when`
  // arms, so physical inputs for `kind` stop at the subquery output boundary.
  it("keeps simple-case outputs and inputless computed outputs across set operations", () => {
    const sql =
      "SELECT label, generated FROM (SELECT CASE kind WHEN 'a' THEN 'A' ELSE 'B' END AS label, from_unixtime(unix_timestamp()) AS generated FROM demo.a UNION ALL SELECT CASE kind WHEN 'b' THEN 'B' ELSE 'A' END AS label, from_unixtime(unix_timestamp()) AS generated FROM demo.b) x";
    const session = SqlSession.create(sql, "databricks");
    const schema = {
      columnsFor: (parts: string[]) => {
        const table = parts.join(".").toLowerCase();
        return table === "demo.a" || table === "demo.b"
          ? [{ name: "kind" }]
          : undefined;
      },
    };
    const plan = buildPlanFacts(session.doc.statements[0]!, sql, {
      dialect: "databricks",
      schema,
      include_expression_dependencies: true,
    });

    expect(plan.unknowns).toEqual([]);
    const rootProject = plan.relations.find(
      (relation) =>
        relation.id === "root.project" && relation.type === "project",
    );
    if (rootProject?.type !== "project")
      throw new Error("root project relation missing");
    expect(rootProject.expressions[0]?.input_columns).toMatchObject([
      {
        name: "label",
        resolution: "DERIVED_OUTPUT",
        physical: null,
      },
    ]);
    expect(rootProject.expressions[1]?.input_columns).toMatchObject([
      { name: "generated", resolution: "DERIVED_OUTPUT" },
    ]);
  });

  it("propagates physical inputs through a CTE output boundary", () => {
    const sql =
      "WITH base AS (SELECT id AS record_id FROM demo.base) SELECT record_id FROM base";
    const session = SqlSession.create(sql, "databricks");
    const plan = buildPlanFacts(session.doc.statements[0]!, sql, {
      dialect: "databricks",
      schema: {
        columnsFor: (parts: string[]) =>
          parts.join(".").toLowerCase() === "demo.base"
            ? [{ name: "id" }]
            : undefined,
      },
      include_expression_dependencies: true,
    });

    expect(plan.unknowns).toEqual([]);
    const rootProject = plan.relations.find(
      (relation) =>
        relation.id === "root.project" && relation.type === "project",
    );
    if (rootProject?.type !== "project")
      throw new Error("root project relation missing");
    expect(rootProject.expressions[0]?.input_columns).toMatchObject([
      {
        name: "record_id",
        resolution: "PHYSICAL",
        physical: [{ table: "demo.base", column: "id" }],
      },
    ]);
  });

  it("resolves a set-operation CTE that depends on an earlier CTE", () => {
    const sql =
      "WITH base AS (SELECT id AS record_id FROM demo.base), mapped AS (SELECT record_id FROM base UNION ALL SELECT record_id FROM base) SELECT m.record_id FROM mapped m";
    const session = SqlSession.create(sql, "databricks");
    const schema = new Schema({
      "demo.base": { id: "int" },
    });
    const plan = buildPlanFacts(session.doc.statements[0]!, sql, {
      dialect: "databricks",
      schema,
      include_expression_dependencies: true,
    });

    expect(plan.unknowns).toEqual([]);
    expect(plan.physical_inputs).toEqual(["demo.base"]);
    const rootProject = plan.relations.find(
      (relation) =>
        relation.id === "root.project" && relation.type === "project",
    );
    if (rootProject?.type !== "project")
      throw new Error("root project relation missing");
    expect(rootProject.expressions[0]?.input_columns).toMatchObject([
      {
        name: "record_id",
        qualifier: "m",
        resolution: "PHYSICAL",
        physical: [{ table: "demo.base", column: "id" }],
      },
    ]);
  });

  it("keeps mixed physical and SQL-candidate branches across a set operation", () => {
    const sql =
      "SELECT book FROM (SELECT book FROM demo.physical UNION ALL SELECT book FROM demo.unverified) x";
    const session = SqlSession.create(sql, "databricks");
    const plan = buildPlanFacts(session.doc.statements[0]!, sql, {
      dialect: "databricks",
      schema: {
        columnsFor: (parts: string[]) =>
          parts.join(".").toLowerCase() === "demo.physical"
            ? [{ name: "book" }]
            : undefined,
      },
      include_expression_dependencies: true,
    });

    expect(plan.unknowns).toEqual([]);
    const rootProject = plan.relations.find(
      (relation) =>
        relation.id === "root.project" && relation.type === "project",
    );
    if (rootProject?.type !== "project")
      throw new Error("root project relation missing");
    expect(rootProject.expressions[0]?.input_columns?.[0]).toMatchObject({
      name: "book",
      resolution: "SQL_CANDIDATE",
      sql_candidate: [
        { table: "demo.physical", column: "book" },
        { table: "demo.unverified", column: "book" },
      ],
    });
  });

  it("propagates star outputs through a nested set-operation subquery", () => {
    const sql =
      "SELECT id FROM (SELECT * FROM (SELECT id FROM demo.a UNION ALL SELECT id FROM demo.b) x) y";
    const session = SqlSession.create(sql, "databricks");
    const schema = {
      columnsFor: (parts: string[]) => {
        const table = parts.join(".").toLowerCase();
        return table === "demo.a" || table === "demo.b"
          ? [{ name: "id" }]
          : undefined;
      },
    };
    const plan = buildPlanFacts(session.doc.statements[0]!, sql, {
      dialect: "databricks",
      schema,
      include_expression_dependencies: true,
    });

    expect(plan.unknowns).toEqual([]);
    const rootProject = plan.relations.find(
      (relation) =>
        relation.id === "root.project" && relation.type === "project",
    );
    if (rootProject?.type !== "project")
      throw new Error("root project relation missing");
    expect(rootProject.expressions[0]?.input_columns?.[0]).toMatchObject({
      name: "id",
      resolution: "PHYSICAL",
      physical: [
        { table: "demo.a", column: "id" },
        { table: "demo.b", column: "id" },
      ],
    });
  });
});

describe("plan adapter structured semantic roles", () => {
  function buildFixture(name: string) {
    const fixture = planAdapterRoleFixtures.find((item) => item.name === name);
    if (!fixture) throw new Error(`fixture ${name} missing`);
    const schema = new Schema(fixture.schema);
    const dialect = fixture.dialect ?? "databricks";
    const session = SqlSession.create(fixture.sql, dialect, { schema });
    const plan = buildPlanFacts(session.doc.statements[0]!, fixture.sql, {
      dialect,
      schema,
      include_expression_dependencies: true,
    });
    const project = plan.relations.find(
      (relation) => relation.type === "project",
    );
    if (project?.type !== "project") throw new Error("project relation missing");
    return { fixture, plan, project, expression: project.expressions[0]! };
  }

  it.each(["case", "if"])(
    "separates %s branch selectors from result values",
    (name) => {
      const { fixture, expression } = buildFixture(name);
      expect(expression.expression_roles).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: "BRANCH_SELECTOR",
            effects: ["BRANCH_SELECTION"],
          }),
          expect.objectContaining({
            role: "RESULT_VALUE",
            effects: ["VALUE_CONTRIBUTION"],
          }),
        ]),
      );
      for (const role of expression.expression_roles ?? []) {
        expect(fixture.sql.slice(role.span.start, role.span.end)).toContain(
          role.expression_text,
        );
      }
    },
  );

  // sqllens@1.8.0 exposes simple-CASE WHEN values as selectors, not the shared
  // CASE subject. Keep the span/text contract against those WHEN literals.
  it("uses the WHEN value span for simple CASE selectors under sqllens", () => {
    const { fixture, expression } = buildFixture("simple-case");
    const selectors = (expression.expression_roles ?? []).filter(
      (role) => role.role === "BRANCH_SELECTOR",
    );

    expect(selectors).toHaveLength(2);
    expect(selectors.map((selector) => selector.expression_text).sort()).toEqual([
      "'a'",
      "'b'",
    ]);
    for (const selector of selectors) {
      expect(fixture.sql.slice(selector.span.start, selector.span.end)).toBe(
        selector.expression_text,
      );
    }
  });

  it("records COALESCE arguments as value and selection inputs", () => {
    const { expression } = buildFixture("coalesce");
    expect(expression.expression_roles).toHaveLength(3);
    expect(expression.expression_roles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operator: "COALESCE",
          role: "COALESCE_ARGUMENT",
          effects: ["VALUE_CONTRIBUTION", "BRANCH_SELECTION"],
          ordinal: 0,
        }),
        expect.objectContaining({ ordinal: 2, expression_text: "0" }),
      ]),
    );
  });

  it("preserves source expression bytes and keeps normalized display text separate", () => {
    const fixture = {
      sql: "SELECT COALESCE(\n  t.a,\n  t.b\n) AS result FROM demo.t t",
      schema: { "demo.t": { a: "int", b: "int" } },
    };
    const session = SqlSession.create(fixture.sql, "databricks");
    const plan = buildPlanFacts(session.doc.statements[0]!, fixture.sql, {
      dialect: "databricks",
      schema: new Schema(fixture.schema),
      include_expression_dependencies: true,
    });
    const project = plan.relations.find((relation) => relation.type === "project");
    if (project?.type !== "project") throw new Error("project relation missing");
    const expression = project.expressions[0]!;

    expect(expression.expr_text).toBe(
      fixture.sql.slice(expression.span.start, expression.span.end),
    );
    expect(expression.display_text).toBe("COALESCE( t.a, t.b ) AS result");
    expect(expression.expr_text).not.toBe(expression.display_text);
  });

  it("does not classify one-argument Databricks ISNULL as COALESCE", () => {
    const fixture = {
      sql: "SELECT ISNULL(t.a) AS result FROM demo.t t",
      schema: { "demo.t": { a: "int" } },
    };
    const session = SqlSession.create(fixture.sql, "databricks");
    const plan = buildPlanFacts(session.doc.statements[0]!, fixture.sql, {
      dialect: "databricks",
      schema: new Schema(fixture.schema),
      include_expression_dependencies: true,
    });
    const project = plan.relations.find((relation) => relation.type === "project");
    if (project?.type !== "project") throw new Error("project relation missing");

    expect(project.expressions[0]?.expression_roles ?? []).toEqual([]);
  });

  it("preserves WHERE, HAVING, and QUALIFY as distinct filter clauses", () => {
    const fixture = {
      sql: "SELECT t.k, COUNT(*) AS n FROM demo.t t WHERE t.a > 0 GROUP BY t.k HAVING COUNT(*) > 1 QUALIFY t.k > 0",
      schema: { "demo.t": { k: "int", a: "int" } },
    };
    const session = SqlSession.create(fixture.sql, "databricks", {
      schema: new Schema(fixture.schema),
    });
    const plan = buildPlanFacts(session.doc.statements[0]!, fixture.sql, {
      dialect: "databricks",
      schema: new Schema(fixture.schema),
      include_expression_dependencies: true,
    });

    expect(
      plan.relations
        .filter((relation) => relation.type === "filter")
        .map((relation) => relation.type === "filter" && relation.clause),
    ).toEqual(["where", "having", "qualify"]);
  });

  it("emits stable read occurrence provenance in Plan Facts", () => {
    const fixture = {
      sql: "SELECT x.a FROM demo.t x JOIN demo.t y ON x.a = y.a",
      schema: { "demo.t": { a: "int" } },
    };
    const session = SqlSession.create(fixture.sql, "databricks", {
      schema: new Schema(fixture.schema),
    });
    const plan = buildPlanFacts(session.doc.statements[0]!, fixture.sql, {
      dialect: "databricks",
      schema: new Schema(fixture.schema),
      include_expression_dependencies: true,
    });
    const reads = plan.relations.filter((relation) => relation.type === "read");

    expect(reads.map((read) => read.read_occurrence_id)).toEqual([
      "root.read.x",
      "root.read.y",
    ]);
    expect(reads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          scope_id: "root",
          read_occurrence: expect.objectContaining({
            relation_id: "root.read.x",
            scope_id: "root",
            source_span: expect.any(Object),
          }),
        }),
      ]),
    );
  });

  it("keeps unavailable window frame semantics explicitly unknown", () => {
    const { expression, plan } = buildFixture("window-frame");
    const windowSpec = expression.window_spec;
    if (!windowSpec) throw new Error("window spec missing");
    expect(windowSpec.input_bindings.map((item) => item.role)).toEqual([
      "VALUE",
      "WINDOW_PARTITION",
      "WINDOW_ORDER",
    ]);
    expect(windowSpec.input_bindings).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ expression_text: "2" })]),
    );
    expect(windowSpec.frame).toEqual({
      status: "UNKNOWN",
      expression_text: null,
      display_text: null,
      span: windowSpec.source_span,
      input_columns: [],
      reason: "canonical WindowSpec IR does not expose frame bounds",
    });
    expect(plan.unknowns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "expressions[0].window.frame",
          span: windowSpec.source_span,
        }),
      ]),
    );
  });

  it("projects Top-N relation/control inputs from Scope IR", () => {
    const { plan } = buildFixture("top-n");
    const topN = plan.relations.find((relation) => relation.type === "top_n");
    if (topN?.type !== "top_n") throw new Error("top_n relation missing");
    expect(plan.roots).toEqual(["root.top_n"]);
    expect(topN).toMatchObject({
      id: "root.top_n",
      source: "root.project",
      order_by: [
        expect.objectContaining({
          role: "ORDER",
          expression_text: "t.ts",
          direction: "DESC",
          nulls: "UNSPECIFIED",
        }),
      ],
      limit: {
        kind: "LIMIT",
        top: expect.objectContaining({ role: "LIMIT", expression_text: "10" }),
      },
      span_status: "EXTRACTED",
    });
    expect(topN.span).toEqual({ start: 0, end: fixtureSql("top-n").length });
  });

  it("classifies OFFSET-only Top-N as OFFSET_FETCH", () => {
    const { plan } = buildFixture("top-n-offset-only");
    const topN = plan.relations.find((relation) => relation.type === "top_n");
    if (topN?.type !== "top_n") throw new Error("top_n relation missing");

    expect(topN.limit).toMatchObject({
      kind: "OFFSET_FETCH",
      offset: expect.objectContaining({ role: "OFFSET", expression_text: "5" }),
    });
    expect(topN.limit.fetch).toBeUndefined();
  });

  it.each(["top-n-setop", "top-n-except", "top-n-intersect"])(
    "wraps a query-level Top-N around a %s root and preserves its full span",
    (fixtureName) => {
    const fixture = planAdapterRoleFixtures.find(
      (item) => item.name === fixtureName,
    )!;
    const originalSql = fixture.sql;
    const session = SqlSession.create(originalSql, "databricks");
    const plan = buildPlanFacts(session.doc.statements[0]!, originalSql, {
      dialect: "databricks",
      include_expression_dependencies: true,
    });
    const topN = plan.relations.find((relation) => relation.type === "top_n");
    if (topN?.type !== "top_n") throw new Error("top_n relation missing");

    expect(plan.roots).toEqual(["root.top_n"]);
    const setop = plan.relations.find((relation) => relation.id === "root.setop");
    if (setop?.type !== "setop") throw new Error("setop relation missing");
    expect(setop.setop).toBe(
      fixtureName === "top-n-setop"
        ? "union"
        : fixtureName.replace("top-n-", ""),
    );
    expect(topN).toMatchObject({
      id: "root.top_n",
      source: "root.setop",
      order_by: [
        expect.objectContaining({
          role: "ORDER",
          expression_text: "a",
          direction: "DESC",
        }),
      ],
      limit: {
        kind: "LIMIT",
        top: expect.objectContaining({ role: "LIMIT", expression_text: "1" }),
      },
      span_status: "EXTRACTED",
    });
    expect(topN.span).toEqual({ start: 0, end: originalSql.length });
    expect(originalSql.slice(topN.span!.start, topN.span!.end)).toBe(originalSql);
    expect(plan.relations.filter((relation) => relation.type === "top_n")).toHaveLength(1);
    },
  );

  it("bumps serialized plan and dependency-cache identities for the new fields", () => {
    const fixture = planAdapterRoleFixtures.find((item) => item.name === "top-n")!;
    const session = SqlSession.create(fixture.sql, "databricks");
    const plan = buildPlanFacts(session.doc.statements[0]!, fixture.sql, {
      dialect: "databricks",
    });
    const dependencyPlan = buildPlanFacts(session.doc.statements[0]!, fixture.sql, {
      dialect: "databricks",
      include_expression_dependencies: true,
    });

    expect(plan.meta.contract_version).toBe("1.4.0");
    expect(plan.meta.adapter_version).toBe("0.5.0");
    expect(dependencyPlan.meta.contract_version).toBe("1.4.0");
    expect(dependencyPlan.meta.adapter_version).toBe(
      EXPRESSION_DEPENDENCY_ADAPTER_VERSION,
    );
    expect(dependencyPlan.meta.adapter_version).not.toBe("0.4.0");
  });

  it("does not add role fields when expression dependencies are disabled", () => {
    const fixture = planAdapterRoleFixtures.find((item) => item.name === "case")!;
    const session = SqlSession.create(fixture.sql, "databricks");
    const plan = buildPlanFacts(session.doc.statements[0]!, fixture.sql, {
      dialect: "databricks",
    });
    const project = plan.relations.find((relation) => relation.type === "project");
    if (project?.type !== "project") throw new Error("project relation missing");
    expect("expression_roles" in project.expressions[0]!).toBe(false);
  });
});

function fixtureSql(name: string): string {
  return planAdapterRoleFixtures.find((item) => item.name === name)!.sql;
}
