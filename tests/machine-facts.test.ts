import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { canonicalJson, datasetId, fieldId, sha256, safeSegment, stripVolatile } from "../scripts/machine-facts/machine-facts-contract.ts";
import { gzipCanonicalBytes, gzipJsonlPath, inspectJsonlStore, readJsonlRecords, readJsonlText } from "../scripts/machine-facts/jsonl-store.ts";
import { inputDependencyStatus, mergeSchemaEvidence, processProfile, rebuildIndex, relationNeedsMissingSchema } from "../scripts/machine-facts/machine-facts.ts";

const workspace = resolve(import.meta.dirname, "..");
const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(): { root: string; profile: string; output: string; sql: string } {
	const root = mkdtempSync(join(tmpdir(), "titans-machine-facts-"));
	roots.push(root);
	const sql = join(root, "task.sql");
	const schema = join(root, "schema.json");
	const profile = join(root, "profile.json");
	writeFileSync(sql, "SELECT id FROM demo.source;\nINSERT OVERWRITE TABLE demo.target SELECT s.id FROM (SELECT id FROM demo.source) s WHERE s.id > 0;\n", "utf8");
	writeFileSync(schema, JSON.stringify({ records: [{ qualified_name: "demo.source", db: "demo", table: "source", status: "SUCCESS", guid: "guid-source", source: "SZDATA_TABLE_DDL", metadata_qualified_name: "DEMO.SOURCE", ddl_sha256: "ddl-source", required_for_star: true, table_status: "ONLINE", columns: [{ name: "id", partition: false }, { name: "dt", partition: true }] }, { qualified_name: "demo.target", db: "demo", table: "target", status: "SUCCESS", columns: [{ name: "id", partition: false }] }], captured_at: "volatile" }), "utf8");
	writeFileSync(profile, JSON.stringify({ schema_version: "test", dialect: "databricks", schema_evidence: relative(workspace, schema).replace(/\\/g, "/"), tasks: [{ task_id: "test-task", sql_snapshot: relative(workspace, sql).replace(/\\/g, "/"), writes: "demo.target" }] }), "utf8");
	return { root, profile: relative(workspace, profile).replace(/\\/g, "/"), output: relative(workspace, join(root, "machine-facts")).replace(/\\/g, "/"), sql };
}

describe("machine facts contract", () => {
	it("canonicalizes keys while preserving array order and removes volatile schema fields", () => {
		const left = canonicalJson({ b: 2, a: 1, items: ["z", "a"] });
		const right = canonicalJson({ items: ["z", "a"], a: 1, b: 2 });
		expect(left).toBe(right);
		expect(stripVolatile({ captured_at: "now", nested: { source_path: "x", keep: true } })).toEqual({ nested: { keep: true } });
		expect(sha256(left)).toHaveLength(64);
		expect(() => safeSegment("../bad", "task_id")).toThrow();
		expect(() => safeSegment("CON", "task_id")).toThrow();
		expect(() => safeSegment("name.", "task_id")).toThrow();
		expect(datasetId("source-a", "Demo.Source")).not.toBe(datasetId("source-b", "Demo.Source"));
	});

	it("merges persisted schema evidence deterministically without task-specific rules", () => {
		const merged = mergeSchemaEvidence([
			{ records: [
				{ qualified_name: "demo.source", status: "SUCCESS", columns: [{ name: "id" }] },
				{ qualified_name: "demo.missing", status: "NOT_EVALUABLE", columns: [] },
			] },
			{ records: [
				{ qualified_name: "DEMO.SOURCE", status: "SUCCESS", columns: [{ name: "id" }, { name: "dt" }], ddl: "CREATE TABLE demo.source" },
				{ qualified_name: "demo.extra", status: "SUCCESS", columns: [{ name: "key" }] },
			] },
		], "test-source");

		expect(merged.logical_source_id).toBe("test-source");
		expect(merged.records).toHaveLength(3);
		expect(merged.records.find((record: { qualified_name?: string }) => record.qualified_name?.toLowerCase() === "demo.source")).toMatchObject({
		status: "SUCCESS",
		columns: [{ name: "id" }, { name: "dt" }],
		});
	});

	it("scopes each task bundle to its SQL inputs and declared output", () => {
		const f = fixture();
		const schemaPath = join(f.root, "schema.json");
		const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
		schema.records.push({
			qualified_name: "demo.unrelated",
			status: "SUCCESS",
			columns: [{ name: "noise" }],
		});
		writeFileSync(schemaPath, JSON.stringify(schema), "utf8");

		processProfile(f.profile, f.output, "test-source");
		const bundle = join(f.root, "machine-facts", "registry", "tasks", "test-task", "bundle");
		expect(inspectJsonlStore(join(bundle, "schema-refs.jsonl")).status).toBe("GZIP");
		const schemaRefs = readJsonlText(join(bundle, "schema-refs.jsonl"))
			.trim()
			.split(/\r?\n/)
			.filter(Boolean)
			.map((line) => JSON.parse(line));

		expect(schemaRefs.map((record) => record.qualified_name)).toEqual(["demo.source", "demo.target"]);
	});

	it("creates one current bundle, reuses it, and replaces it when SQL changes", () => {
		const f = fixture();
		const first = processProfile(f.profile, f.output, "test-source");
		expect(first.tasks).toHaveLength(1);
		expect(first.tasks[0]?.status).toBe("CREATED");
		expect(first.index.count).toBe(1);
		const relation = readJsonlText(join(f.root, "machine-facts", "registry", "tasks", "test-task", "bundle", "relation-nodes.jsonl"));
		expect(relation).not.toContain("statement:sql:");
		const schemaRefs = readJsonlText(join(f.root, "machine-facts", "registry", "tasks", "test-task", "bundle", "schema-refs.jsonl"))
			.trim().split(/\r?\n/).map((line) => JSON.parse(line));
		const sourceRef = schemaRefs.find((record: { qualified_name?: string }) => record.qualified_name === "demo.source");
		expect(sourceRef).toMatchObject({ required_for_star: true, ddl_sha256: "ddl-source", source: "SZDATA_TABLE_DDL", metadata_qualified_name: "DEMO.SOURCE", partition_columns: ["dt"] });
		const manifestPath = join(f.root, "machine-facts", "registry", "tasks", "test-task", "bundle", "manifest.json");
		const firstManifest = JSON.parse(readFileSync(manifestPath, "utf8"));

		const replay = processProfile(f.profile, f.output, "test-source");
		expect(replay.tasks[0]?.status).toBe("REUSED");

		writeFileSync(f.sql, "INSERT OVERWRITE TABLE demo.target SELECT id + 1 AS id FROM demo.source;\n", "utf8");
		const replaced = processProfile(f.profile, f.output, "test-source");
		expect(replaced.tasks[0]?.status).toBe("REPLACED");
		const secondManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
		expect(secondManifest.inputs.sql_sha256).not.toBe(firstManifest.inputs.sql_sha256);
		expect(rebuildIndex(join(f.root, "machine-facts")).count).toBe(1);
	});

	it("binds root SELECT expressions to an explicit INSERT target by target schema order", () => {
		const f = fixture();
		processProfile(f.profile, f.output, "test-source");
		const bundle = join(f.root, "machine-facts", "registry", "tasks", "test-task", "bundle");
		const bindings = readJsonlText(join(bundle, "output-field-bindings.jsonl"))
			.trim()
			.split(/\r?\n/)
			.filter(Boolean)
			.map((line) => JSON.parse(line));
		const manifest = JSON.parse(readFileSync(join(bundle, "manifest.json"), "utf8"));

		expect(bindings).toHaveLength(1);
		expect(bindings[0]).toMatchObject({
			task_id: "test-task",
			statement_id: "task:test-task:statement:1",
			target_dataset_id: datasetId("test-source", "demo.target"),
			target_field_id: fieldId("test-source", "demo.target", "id"),
			target_dataset: "demo.target",
			target_field: "id",
			source_ordinal: 0,
			target_ordinal: 0,
			binding_method: "TARGET_SCHEMA_POSITIONAL",
			binding_status: "RESOLVED",
			target_schema_status: "MATCH",
		});
		expect(manifest.counts.output_field_bindings).toBe(1);
		expect(manifest.outputs.some((output: { path?: string }) => output.path === "output-field-bindings.jsonl")).toBe(true);
	});

	it("binds the query producer of a WITH-prefixed INSERT", () => {
		const f = fixture();
		writeFileSync(
			f.sql,
			"WITH source_rows AS (SELECT id FROM demo.source) INSERT OVERWRITE TABLE demo.target SELECT id FROM source_rows;\n",
			"utf8",
		);

		processProfile(f.profile, f.output, "test-source");
		const bundle = join(f.root, "machine-facts", "registry", "tasks", "test-task", "bundle");
		const statements = readJsonlText(join(bundle, "statements.jsonl"))
			.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
		const bindings = readJsonlText(join(bundle, "output-field-bindings.jsonl"))
			.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
		const expressions = readJsonlText(join(bundle, "field-expression-nodes.jsonl"))
			.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
		const writes = readJsonlText(join(bundle, "dataset-io.jsonl"))
			.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
			.filter((record) => record.direction === "WRITE" && record.field_producing === true);

		expect(statements[0]).toMatchObject({ statement_type: "INSERT_OVERWRITE", parse_status: "SUCCESS" });
		expect(writes).toHaveLength(1);
		expect(writes[0]).toMatchObject({
			physical_dataset: "demo.target",
			producer_enumeration_status: "COMPLETE",
		});
		expect(bindings).toHaveLength(1);
		expect(bindings[0]).toMatchObject({
			target_dataset: "demo.target",
			target_field: "id",
			expression_id: expressions.find((expression) => expression.relation_id.endsWith(":root.project"))?.expression_id,
		});
	});

	it("keeps one Write Observation across a CTE, physical SELECT * subquery, and dynamic partition", () => {
		const f = fixture();
		const schemaPath = join(f.root, "schema.json");
		const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
		schema.records = [
			{
				qualified_name: "demo.source",
				status: "SUCCESS",
				required_for_star: true,
				columns: [{ name: "key_col", partition: false }, { name: "payload", partition: false }],
			},
			{
				qualified_name: "demo.target",
				status: "SUCCESS",
				columns: [{ name: "out_col", partition: false }, { name: "busi_date", partition: true }],
			},
		];
		writeFileSync(schemaPath, JSON.stringify(schema), "utf8");
		const sql =
			"WITH src AS (\n" +
			"SELECT key_col FROM demo.source\n" +
			")\n" +
			"INSERT OVERWRITE TABLE demo.target PARTITION(busi_date)\n" +
			"SELECT s.key_col AS out_col, '2026-01-01' AS busi_date\n" +
			"FROM (SELECT * FROM demo.source) s\n" +
			"JOIN src ON s.key_col = src.key_col;\n\n";
		writeFileSync(f.sql, sql, "utf8");
		const profile = JSON.parse(readFileSync(join(f.root, "profile.json"), "utf8"));
		profile.tasks[0].sql_write_partition_evidence = [{
			target: "demo.target",
			statement_start: sql.indexOf("INSERT OVERWRITE"),
			statement_end: sql.indexOf(";"),
			status: "COMPLETE",
			partition_columns: ["busi_date"],
			evidence_refs: ["test:partition-span"],
		}];
		writeFileSync(join(f.root, "profile.json"), JSON.stringify(profile), "utf8");

		processProfile(f.profile, f.output, "test-source");
		const bundle = join(f.root, "machine-facts", "registry", "tasks", "test-task", "bundle");
		const jsonl = (name: string): any[] => readJsonlRecords(join(bundle, name));
		const statements = jsonl("statements.jsonl");
		const writes = jsonl("dataset-io.jsonl").filter((record) => record.direction === "WRITE" && record.field_producing === true);
		const bindings = jsonl("output-field-bindings.jsonl");
		const unknowns = jsonl("unknowns.jsonl");
		const expressions = jsonl("field-expression-nodes.jsonl");

		expect(statements).toHaveLength(1);
		expect(statements[0]).toMatchObject({ statement_type: "INSERT_OVERWRITE", parse_status: "SUCCESS" });
		expect(writes).toHaveLength(1);
		expect(writes[0]).toMatchObject({
			physical_dataset: "demo.target",
			write_observation_id: "write-observation:test-task:0",
			statement_id: statements[0].statement_id,
			write_statement_id: statements[0].statement_id,
			query_producer_statement_id: statements[0].statement_id,
			producer_enumeration_status: "COMPLETE",
		});
		expect(bindings).toHaveLength(2);
		expect(bindings.find((binding) => binding.target_field === "out_col")).toMatchObject({
			write_observation_id: writes[0].write_observation_id,
			expression_id: expressions.find((expression) => expression.output_name === "out_col").expression_id,
			static_partition_columns: ["busi_date"],
		});
		expect(bindings.find((binding) => binding.target_field === "busi_date")).toMatchObject({
			write_observation_id: writes[0].write_observation_id,
		});
		expect(unknowns.some((unknown) => unknown.reason_code === "PLAN_FACT_UNRESOLVED")).toBe(false);
	});

	it("resolves a bare INSERT target to the declared physical table identity", () => {
		const f = fixture();
		const schemaPath = join(f.root, "schema.json");
		const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
		schema.records = [
			{ qualified_name: "demo.source", status: "SUCCESS", columns: [{ name: "id", partition: false }] },
			{ qualified_name: "warehouse.demo.target", status: "SUCCESS", columns: [{ name: "id", partition: false }] },
			{ qualified_name: "target", status: "SUCCESS", columns: [{ name: "legacy_only", partition: false }] },
		];
		writeFileSync(schemaPath, JSON.stringify(schema), "utf8");
		writeFileSync(f.sql, "INSERT OVERWRITE TABLE target SELECT id FROM demo.source;\n", "utf8");
		const profilePath = join(f.root, "profile.json");
		const profile = JSON.parse(readFileSync(profilePath, "utf8"));
		profile.tasks[0].writes = "warehouse.demo.target";
		writeFileSync(profilePath, JSON.stringify(profile), "utf8");

		processProfile(f.profile, f.output, "test-source");
		const bundle = join(f.root, "machine-facts", "registry", "tasks", "test-task", "bundle");
		const jsonl = (name: string): any[] => readJsonlRecords(join(bundle, name));
		const write = jsonl("dataset-io.jsonl").find((record) => record.direction === "WRITE" && record.field_producing === true);
		const binding = jsonl("output-field-bindings.jsonl")[0];

		expect(write).toMatchObject({ physical_dataset: "warehouse.demo.target" });
		expect(binding).toMatchObject({ target_dataset: "warehouse.demo.target", target_field: "id" });
	});

	it("binds every resolvable multi-column CTAS producer ordinal to the same Write", () => {
		const f = fixture();
		const schemaPath = join(f.root, "schema.json");
		const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
		const source = schema.records.find((record: { qualified_name?: string }) => record.qualified_name === "demo.source");
		const target = schema.records.find((record: { qualified_name?: string }) => record.qualified_name === "demo.target");
		source.columns = [{ name: "id", partition: false }, { name: "amount", partition: false }];
		target.columns = [{ name: "id", partition: false }, { name: "amount", partition: false }];
		writeFileSync(schemaPath, JSON.stringify(schema), "utf8");
		writeFileSync(
			f.sql,
			"CREATE TABLE demo.target (id STRING, amount DECIMAL(18, 2)) AS SELECT id, amount FROM demo.source;\n",
			"utf8",
		);

		processProfile(f.profile, f.output, "test-source");
		const bundle = join(f.root, "machine-facts", "registry", "tasks", "test-task", "bundle");
		const fields = readJsonlText(join(bundle, "field-expression-nodes.jsonl"))
			.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
		const bindings = readJsonlText(join(bundle, "output-field-bindings.jsonl"))
			.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
		const unknowns = readJsonlText(join(bundle, "unknowns.jsonl"))
			.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
		const writeStatementId = "task:test-task:statement:0";
		const producerOrdinals = fields
			.filter((field) => field.statement_id === writeStatementId)
			.map((field) => field.ordinal)
			.sort((left, right) => left - right);
		const sameWriteBindings = bindings.filter((binding) => binding.statement_id === writeStatementId);
		const sameWriteGaps = unknowns.filter(
			(gap) => gap.statement_id === writeStatementId && gap.gap_domain === "OUTPUT_BINDING",
		);
		const disposedOrdinals = new Set([
			...sameWriteBindings.map((binding) => binding.source_ordinal),
			...sameWriteGaps.flatMap((gap) => gap.uncovered_ordinals ?? []),
		]);

		expect(producerOrdinals).toEqual([0, 1]);
		expect([...disposedOrdinals].sort((left, right) => left - right)).toEqual(producerOrdinals);
		expect(sameWriteBindings).toHaveLength(2);
		expect(sameWriteBindings.map((binding) => binding.target_field)).toEqual(["id", "amount"]);
		expect(new Set(sameWriteBindings.map((binding) => binding.write_observation_id)).size).toBe(1);
		expect(sameWriteBindings.every((binding) => binding.binding_status === "RESOLVED")).toBe(true);
		expect(sameWriteGaps).toHaveLength(0);
	});

	it("records every unprovable CTAS producer ordinal as a same-Write binding gap", () => {
		const f = fixture();
		const schemaPath = join(f.root, "schema.json");
		const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
		const source = schema.records.find((record: { qualified_name?: string }) => record.qualified_name === "demo.source");
		source.columns = [{ name: "id", partition: false }, { name: "amount", partition: false }];
		schema.records = schema.records.filter(
			(record: { qualified_name?: string }) => record.qualified_name !== "demo.target",
		);
		writeFileSync(schemaPath, JSON.stringify(schema), "utf8");
		writeFileSync(f.sql, "CREATE TABLE demo.target AS SELECT id, amount FROM demo.source;\n", "utf8");

		processProfile(f.profile, f.output, "test-source");
		const bundle = join(f.root, "machine-facts", "registry", "tasks", "test-task", "bundle");
		const bindings = readJsonlText(join(bundle, "output-field-bindings.jsonl")).trim();
		const unknowns = readJsonlText(join(bundle, "unknowns.jsonl"))
			.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
		const gap = unknowns.find(
			(item) => item.statement_id === "task:test-task:statement:0" && item.gap_domain === "OUTPUT_BINDING",
		);

		expect(bindings).toBe("");
		expect(gap).toMatchObject({
			outcome_class: "NOT_EVALUABLE",
			reason_code: "CTAS_OUTPUT_BINDING_NOT_PROVABLE",
			uncovered_ordinals: [0, 1],
		});
		expect(gap.write_observation_id).toEqual(expect.any(String));
	});

	it("never pairs a CTAS Write with a following independent SELECT Statement", () => {
		const f = fixture();
		const schemaPath = join(f.root, "schema.json");
		const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
		schema.records.push({
			qualified_name: "demo.other",
			status: "SUCCESS",
			columns: [{ name: "other", partition: false }],
		});
		writeFileSync(schemaPath, JSON.stringify(schema), "utf8");
		writeFileSync(
			f.sql,
			"CREATE TABLE demo.target AS SELECT id FROM demo.source;\nSELECT other FROM demo.other;\n",
			"utf8",
		);

		processProfile(f.profile, f.output, "test-source");
		const bundle = join(f.root, "machine-facts", "registry", "tasks", "test-task", "bundle");
		const statements = readJsonlText(join(bundle, "statements.jsonl"))
			.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
		const fields = readJsonlText(join(bundle, "field-expression-nodes.jsonl"))
			.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
		const bindings = readJsonlText(join(bundle, "output-field-bindings.jsonl"))
			.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
		const ctasExpression = fields.find((field) => field.statement_id === "task:test-task:statement:0");
		const independentExpression = fields.find((field) => field.statement_id === "task:test-task:statement:1");

		expect(
			statements.filter((statement) => String(statement.raw_sql).trim().length > 0).map((statement) => statement.statement_type),
		).toEqual(["CREATE_TABLE", "SELECT"]);
		expect(bindings).toHaveLength(1);
		expect(bindings[0]).toMatchObject({
			statement_id: "task:test-task:statement:0",
			expression_id: ctasExpression.expression_id,
			target_field: "id",
			source_ordinal: 0,
		});
		expect(bindings.some((binding) => binding.expression_id === independentExpression.expression_id)).toBe(false);
	});

	it("uses a matching task-local CREATE schema while preserving physical target schema drift", () => {
		const f = fixture();
		const schemaPath = join(f.root, "schema.json");
		const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
		const target = schema.records.find((record: { qualified_name?: string }) => record.qualified_name === "demo.target");
		target.columns.push({ name: "new_tail", partition: false });
		writeFileSync(schemaPath, JSON.stringify(schema), "utf8");
		writeFileSync(
			f.sql,
			"CREATE TABLE IF NOT EXISTS demo.target (id STRING);\nINSERT OVERWRITE TABLE demo.target SELECT id FROM demo.source;\n",
			"utf8",
		);

		processProfile(f.profile, f.output, "test-source");
		const bundle = join(f.root, "machine-facts", "registry", "tasks", "test-task", "bundle");
		const bindings = readJsonlText(join(bundle, "output-field-bindings.jsonl"))
			.trim()
			.split(/\r?\n/)
			.filter(Boolean)
			.map((line) => JSON.parse(line));
		const unknowns = readJsonlText(join(bundle, "unknowns.jsonl"))
			.trim()
			.split(/\r?\n/)
			.filter(Boolean)
			.map((line) => JSON.parse(line));

		expect(bindings).toHaveLength(1);
		expect(bindings[0]).toMatchObject({
			target_field: "id",
			binding_method: "SQL_CREATE_POSITIONAL",
			binding_status: "RESOLVED",
			target_schema_status: "DRIFT_EXTRA_TARGET_COLUMNS",
		});
		expect(unknowns).toContainEqual(
			expect.objectContaining({
				outcome_class: "UNKNOWN",
				reason_code: "TARGET_SCHEMA_DRIFT",
			}),
		);
	});

	it("does not guess positional output bindings when target schema and SELECT counts differ", () => {
		const f = fixture();
		const schemaPath = join(f.root, "schema.json");
		const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
		const target = schema.records.find((record: { qualified_name?: string }) => record.qualified_name === "demo.target");
		target.columns.push({ name: "required_tail", partition: false });
		writeFileSync(schemaPath, JSON.stringify(schema), "utf8");
		writeFileSync(f.sql, "INSERT OVERWRITE TABLE demo.target SELECT id FROM demo.source;\n", "utf8");

		processProfile(f.profile, f.output, "test-source");
		const bundle = join(f.root, "machine-facts", "registry", "tasks", "test-task", "bundle");
		const bindingText = readJsonlText(join(bundle, "output-field-bindings.jsonl")).trim();
		const unknowns = readJsonlText(join(bundle, "unknowns.jsonl"))
			.trim()
			.split(/\r?\n/)
			.filter(Boolean)
			.map((line) => JSON.parse(line));

		expect(bindingText).toBe("");
		expect(unknowns).toContainEqual(
			expect.objectContaining({
				outcome_class: "NOT_EVALUABLE",
				reason_code: "OUTPUT_BINDING_NOT_PROVABLE",
			}),
		);
	});

	it("honors an explicit INSERT target column list instead of physical schema position", () => {
		const f = fixture();
		const schemaPath = join(f.root, "schema.json");
		const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
		const source = schema.records.find((record: { qualified_name?: string }) => record.qualified_name === "demo.source");
		const target = schema.records.find((record: { qualified_name?: string }) => record.qualified_name === "demo.target");
		source.columns.unshift({ name: "amount", partition: false });
		target.columns = [
			{ name: "id", partition: false },
			{ name: "amount", partition: false },
			{ name: "unused_tail", partition: false },
		];
		writeFileSync(schemaPath, JSON.stringify(schema), "utf8");
		writeFileSync(
			f.sql,
			"INSERT OVERWRITE TABLE demo.target (amount, id) SELECT amount, id FROM demo.source;\n",
			"utf8",
		);

		processProfile(f.profile, f.output, "test-source");
		const bundle = join(f.root, "machine-facts", "registry", "tasks", "test-task", "bundle");
		const bindings = readJsonlText(join(bundle, "output-field-bindings.jsonl"))
			.trim()
			.split(/\r?\n/)
			.filter(Boolean)
			.map((line) => JSON.parse(line));

		expect(bindings).toHaveLength(2);
		expect(bindings.map((binding) => ({
			target: binding.target_field,
			sourceOrdinal: binding.source_ordinal,
			targetOrdinal: binding.target_ordinal,
			method: binding.binding_method,
			schema: binding.target_schema_status,
		}))).toEqual([
			{ target: "amount", sourceOrdinal: 0, targetOrdinal: 1, method: "EXPLICIT_TARGET_COLUMN_LIST", schema: "MATCH" },
			{ target: "id", sourceOrdinal: 1, targetOrdinal: 0, method: "EXPLICIT_TARGET_COLUMN_LIST", schema: "MATCH" },
		]);
	});

	it("keeps dynamic partition output mapping unresolved", () => {
		const f = fixture();
		const schemaPath = join(f.root, "schema.json");
		const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
		const target = schema.records.find((record: { qualified_name?: string }) => record.qualified_name === "demo.target");
		target.columns.push({ name: "dt", partition: true });
		writeFileSync(schemaPath, JSON.stringify(schema), "utf8");
		writeFileSync(
			f.sql,
			"INSERT OVERWRITE TABLE demo.target PARTITION (dt) SELECT id, '2026-08-18' AS dt FROM demo.source;\n",
			"utf8",
		);

		processProfile(f.profile, f.output, "test-source");
		const bundle = join(f.root, "machine-facts", "registry", "tasks", "test-task", "bundle");
		expect(readJsonlText(join(bundle, "output-field-bindings.jsonl")).trim()).toBe("");
		const unknowns = readJsonlText(join(bundle, "unknowns.jsonl"))
			.trim()
			.split(/\r?\n/)
			.filter(Boolean)
			.map((line) => JSON.parse(line));
		expect(unknowns).toContainEqual(
			expect.objectContaining({
				outcome_class: "NOT_EVALUABLE",
				reason_code: "DYNAMIC_PARTITION_BINDING_NOT_PROVABLE",
			}),
		);
	});

	it("excludes failed status and corrupted current bundles from the index", () => {
		const f = fixture();
		processProfile(f.profile, f.output, "test-source");
		const taskRoot = join(f.root, "machine-facts", "registry", "tasks", "test-task");
		const statusPath = join(taskRoot, "analysis-status.json");
		const status = JSON.parse(readFileSync(statusPath, "utf8"));
		status.state = "FAILED";
		status.failure = { outcome_class: "FAILURE", reason_code: "TEST_FAILURE", message: "test" };
		writeFileSync(statusPath, JSON.stringify(status), "utf8");
		expect(rebuildIndex(join(f.root, "machine-facts")).count).toBe(0);

		processProfile(f.profile, f.output, "test-source");
		const statements = join(taskRoot, "bundle", "statements.jsonl");
		writeFileSync(gzipJsonlPath(statements), gzipCanonicalBytes(`${readJsonlText(statements)}corrupt\n`));
		const result = rebuildIndex(join(f.root, "machine-facts"));
		expect(result.count).toBe(0);
		expect(result.failures.join(" ")).toContain("hash mismatch");
	});

	it("requires a logical source and rejects same-context output drift", () => {
		const f = fixture();
		const profileWithoutSource = JSON.parse(readFileSync(join(f.root, "profile.json"), "utf8"));
		const profilePath = join(f.root, "profile-without-source.json");
		writeFileSync(profilePath, JSON.stringify({ ...profileWithoutSource, logical_source_id: undefined }), "utf8");
		expect(() => processProfile(relative(workspace, profilePath).replace(/\\/g, "/"), f.output)).toThrow("logical_source_id is required");

		processProfile(f.profile, f.output, "test-source");
		const manifestPath = join(f.root, "machine-facts", "registry", "tasks", "test-task", "bundle", "manifest.json");
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
		manifest.counts.unknowns += 1;
		writeFileSync(manifestPath, JSON.stringify(manifest), "utf8");
		const result = processProfile(f.profile, f.output, "test-source");
		expect(result.tasks[0]?.status).toBe("FAILED");
		expect(result.tasks[0]?.failures[0]?.reason_code).toBe("NON_DETERMINISTIC_OUTPUT");
	});

	it("restores a valid recovery bundle before replay", () => {
		const f = fixture();
		processProfile(f.profile, f.output, "test-source");
		const taskRoot = join(f.root, "machine-facts", "registry", "tasks", "test-task");
		renameSync(join(taskRoot, "bundle"), join(taskRoot, ".recovery"));
		const result = processProfile(f.profile, f.output, "test-source");
		expect(result.tasks[0]?.status).toBe("REUSED");
	});

	it("excludes unsafe snapshots and mismatched status identities", () => {
		const f = fixture();
		processProfile(f.profile, f.output, "test-source");
		const taskRoot = join(f.root, "machine-facts", "registry", "tasks", "test-task");
		const manifestPath = join(taskRoot, "bundle", "manifest.json");
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
		manifest.inputs.sql_snapshot = "../../outside.sql";
		writeFileSync(manifestPath, JSON.stringify(manifest), "utf8");
		let result = rebuildIndex(join(f.root, "machine-facts"));
		expect(result.count).toBe(0);
		expect(result.failures.join(" ")).toContain("unsafe");

		processProfile(f.profile, f.output, "test-source");
		const statusPath = join(taskRoot, "analysis-status.json");
		const status = JSON.parse(readFileSync(statusPath, "utf8"));
		status.logical_source_id = "other-source";
		writeFileSync(statusPath, JSON.stringify(status), "utf8");
		result = rebuildIndex(join(f.root, "machine-facts"));
		expect(result.count).toBe(0);
		expect(result.failures.join(" ")).toContain("identity");
	});

	it("turns a corrupt status file into a typed recovery failure", () => {
		const f = fixture();
		processProfile(f.profile, f.output, "test-source");
		const statusPath = join(f.root, "machine-facts", "registry", "tasks", "test-task", "analysis-status.json");
		writeFileSync(statusPath, "{not-json", "utf8");
		const result = processProfile(f.profile, f.output, "test-source");
		expect(result.tasks[0]?.failures[0]?.reason_code).toBe("RECOVERY_REQUIRED");
		expect(JSON.parse(readFileSync(statusPath, "utf8")).state).toBe("FAILED");
	});

	it("isolates malformed status and manifest during index rebuild", () => {
		const f = fixture();
		processProfile(f.profile, f.output, "test-source");
		const taskRoot = join(f.root, "machine-facts", "registry", "tasks", "test-task");
		writeFileSync(join(taskRoot, "analysis-status.json"), "{broken", "utf8");
		let result = rebuildIndex(join(f.root, "machine-facts"));
		expect(result.count).toBe(0);
		expect(result.failures.join(" ")).toContain("invalid analysis-status");

		const f2 = fixture();
		processProfile(f2.profile, f2.output, "test-source");
		const taskRoot2 = join(f2.root, "machine-facts", "registry", "tasks", "test-task");
		writeFileSync(join(taskRoot2, "bundle", "manifest.json"), JSON.stringify({ outputs: "not-an-array" }), "utf8");
		result = rebuildIndex(join(f2.root, "machine-facts"));
		expect(result.count).toBe(0);
		expect(result.failures.join(" ")).toContain("structural");
	});

	it("rejects duplicate task identities before writing", () => {
		const f = fixture();
		const profile = JSON.parse(readFileSync(join(f.root, "profile.json"), "utf8"));
		profile.tasks.push(profile.tasks[0]);
		const duplicatePath = join(f.root, "duplicate-profile.json");
		writeFileSync(duplicatePath, JSON.stringify(profile), "utf8");
		expect(() => processProfile(relative(workspace, duplicatePath).replace(/\\/g, "/"), f.output, "test-source")).toThrow("task_id values must be unique");
	});

	it("preserves plan unknown classes without manufacturing field-binding unknowns", () => {
		const f = fixture();
		writeFileSync(
			f.sql,
			"CREATE TABLE IF NOT EXISTS demo.target (id STRING);\nINSERT OVERWRITE TABLE demo.target SELECT s.id, id AS ambiguous_id, from_unixtime(unix_timestamp()) AS loaded_at FROM demo.source s JOIN demo.target t ON s.id = t.id;\n",
			"utf8",
		);

		processProfile(f.profile, f.output, "test-source");
		const bundle = join(f.root, "machine-facts", "registry", "tasks", "test-task", "bundle");
		const unknowns = readJsonlText(join(bundle, "unknowns.jsonl"))
			.trim()
			.split(/\r?\n/)
			.filter(Boolean)
			.map((line) => JSON.parse(line));
		const expressions = readJsonlText(join(bundle, "field-expression-nodes.jsonl"))
			.trim()
			.split(/\r?\n/)
			.filter(Boolean)
			.map((line) => JSON.parse(line));
		const manifest = JSON.parse(readFileSync(join(bundle, "manifest.json"), "utf8"));

		expect(unknowns.some((item) => item.outcome_class === "NOT_APPLICABLE" && item.reason_code === "NON_QUERY_OUTPUT_NOT_APPLICABLE")).toBe(true);
		expect(unknowns.some((item) => item.reason_code === "PHYSICAL_FIELD_BINDING_UNRESOLVED")).toBe(false);
		expect(expressions.some((item) => item.input_dependency_status === "NO_PHYSICAL_INPUT")).toBe(true);
		expect(expressions.some((item) => item.input_dependency_status === "UNRESOLVED")).toBe(true);
		expect(manifest.method.adapter.name).toBe("machine-facts-writer");
		expect(manifest.method.plan_adapter.name).toBe("plan-adapter");
		expect(manifest.counts.unknowns_by_outcome.NOT_APPLICABLE).toBe(1);
		expect(Object.values(manifest.counts.unknowns_by_outcome as Record<string, number>).reduce((sum, value) => sum + value, 0)).toBe(manifest.counts.unknowns);
	});

	it("keeps mixed physical and unresolved dependencies explicitly partial", () => {
		expect(inputDependencyStatus({ input_columns: [
			{ name: "known_id", resolution: "PHYSICAL", physical: [{ table: "demo.source", column: "known_id" }] },
			{ name: "missing_id", resolution: "UNRESOLVED", physical: null },
		] })).toBe("PARTIAL");
		expect(inputDependencyStatus({ input_columns: [
			{ name: "known_id", resolution: "PHYSICAL", physical: [{ table: "demo.source", column: "known_id" }] },
			{ name: "derived_id", resolution: "DERIVED_OUTPUT", derived_from: "cte.id" },
		] })).toBe("PARTIAL");
	});

	it("detects missing schema evidence through relation inputs", () => {
		const relations = [
			{ id: "source", type: "read", table: "demo.source" },
			{ id: "missing", type: "read", table: "demo.missing" },
			{ id: "join", type: "join", left: "source", right: "missing" },
		];
		expect(relationNeedsMissingSchema("join", relations, new Set(["demo.source"]))).toBe(true);
		expect(relationNeedsMissingSchema("join", relations, new Set(["demo.source", "demo.missing"]))).toBe(false);
	});

	it("keeps qualified missing-schema columns as candidates", () => {
		const f = fixture();
		writeFileSync(f.sql, "INSERT OVERWRITE TABLE demo.target SELECT s.id FROM demo.source s JOIN demo.missing m ON s.id = m.id;\n", "utf8");
		processProfile(f.profile, f.output, "test-source");
		const bundle = join(f.root, "machine-facts", "registry", "tasks", "test-task", "bundle");
		const unknowns = readJsonlText(join(bundle, "unknowns.jsonl"))
			.trim()
			.split(/\r?\n/)
			.filter(Boolean)
			.map((line) => JSON.parse(line));
		expect(unknowns.some((item) => item.reason_code === "SCHEMA_BINDING_NOT_EVALUABLE")).toBe(false);
	});

	it("does not relabel followColumn parser unknowns as missing schema", () => {
		const f = fixture();
		writeFileSync(f.sql, "CREATE TABLE demo.target AS SELECT A.*, B.* FROM (SELECT id FROM demo.source) A FULL OUTER JOIN (SELECT id FROM demo.missing) B ON A.id = B.id;", "utf8");
		processProfile(f.profile, f.output, "test-source");
		const bundle = join(f.root, "machine-facts", "registry", "tasks", "test-task", "bundle");
		const unknowns = readJsonlText(join(bundle, "unknowns.jsonl"))
			.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));

		expect(unknowns.filter((item) => item.reason_code === "SCHEMA_BINDING_NOT_EVALUABLE" && item.message.includes("followColumn 无来源"))).toHaveLength(0);
		expect(unknowns.filter((item) => item.reason_code === "PHYSICAL_FIELD_UNRESOLVED" && item.message.includes("followColumn 无来源"))).toHaveLength(0);
		expect(unknowns.some((item) => item.reason_code === "SCHEMA_BINDING_NOT_EVALUABLE" && item.message.includes("demo.missing"))).toBe(true);
	});

	it("passes nested schema namespaces to derived-table star resolution", () => {
		const f = fixture();
		writeFileSync(f.sql, "CREATE TABLE demo.target AS SELECT A.id FROM (SELECT id FROM demo.source) A;", "utf8");
		processProfile(f.profile, f.output, "test-source");
		const bundle = join(f.root, "machine-facts", "registry", "tasks", "test-task", "bundle");
		const unknowns = readJsonlText(join(bundle, "unknowns.jsonl"))
			.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));

		expect(unknowns.filter((item) => item.reason_code === "PHYSICAL_FIELD_UNRESOLVED")).toHaveLength(0);
		expect(unknowns.filter((item) => item.reason_code === "PLAN_FACT_UNRESOLVED")).toHaveLength(0);
	});

	it("does not mark a non-query-only unknown as a partial parse", () => {
		const f = fixture();
		writeFileSync(f.sql, "CREATE TABLE demo.target (id STRING);", "utf8");
		processProfile(f.profile, f.output, "test-source");
		const bundle = join(f.root, "machine-facts", "registry", "tasks", "test-task", "bundle");
		const statements = readJsonlText(join(bundle, "statements.jsonl"))
			.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
		const unknowns = readJsonlText(join(bundle, "unknowns.jsonl"))
			.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));

		expect(statements).toHaveLength(1);
		expect(statements[0].parse_status).toBe("SUCCESS");
		expect(unknowns).toHaveLength(1);
		expect(unknowns[0]).toMatchObject({ outcome_class: "NOT_APPLICABLE", reason_code: "NON_QUERY_OUTPUT_NOT_APPLICABLE" });
	});

	it("skips DROP TABLE statements without emitting facts or unknowns", () => {
		const f = fixture();
		writeFileSync(f.sql, "DROP TABLE IF EXISTS demo.scratch;", "utf8");
		processProfile(f.profile, f.output, "test-source");
		const bundle = join(f.root, "machine-facts", "registry", "tasks", "test-task", "bundle");
		const statements = readJsonlText(join(bundle, "statements.jsonl"))
			.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
		const unknowns = readJsonlText(join(bundle, "unknowns.jsonl"))
			.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));

		expect(statements).toHaveLength(0);
		expect(unknowns).toHaveLength(0);
	});

	it("records syntax-only candidates when a single source schema is absent", () => {
		const f = fixture();
		const schemaPath = join(f.root, "schema.json");
		const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
		schema.records = schema.records.filter((record: { qualified_name?: string }) => record.qualified_name !== "demo.source");
		writeFileSync(schemaPath, JSON.stringify(schema), "utf8");

		processProfile(f.profile, f.output, "test-source");
		const bundle = join(f.root, "machine-facts", "registry", "tasks", "test-task", "bundle");
		const expressions = readJsonlText(join(bundle, "field-expression-nodes.jsonl"))
			.trim()
			.split(/\r?\n/)
			.filter(Boolean)
			.map((line) => JSON.parse(line));
		const lineage = readJsonlText(join(bundle, "column-lineage-edges.jsonl"))
			.trim()
			.split(/\r?\n/)
			.filter(Boolean)
			.map((line) => JSON.parse(line));
		expect(expressions.some((item) => item.input_dependency_status === "SQL_CANDIDATE")).toBe(true);
		expect(expressions.some((item) => item.candidate_input_fields?.some((field: { binding_status?: string }) => field.binding_status === "UNVERIFIED_SCHEMA"))).toBe(true);
		expect(lineage.some((item) => item.resolution_status === "UNVERIFIED_SCHEMA" && item.method === "SQL_SINGLE_SOURCE_BINDING")).toBe(true);
		const unknowns = readJsonlText(join(bundle, "unknowns.jsonl"))
			.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
		expect(unknowns.some((item) => item.reason_code === "SCHEMA_BINDING_NOT_EVALUABLE")).toBe(false);
	});

	it("keeps missing-schema facts unevaluable for star expansion", () => {
		const f = fixture();
		const schemaPath = join(f.root, "schema.json");
		const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
		schema.records = schema.records.filter((record: { qualified_name?: string }) => record.qualified_name !== "demo.source");
		writeFileSync(schemaPath, JSON.stringify(schema), "utf8");
		writeFileSync(f.sql, "INSERT OVERWRITE TABLE demo.target SELECT * FROM demo.source;\n", "utf8");

		processProfile(f.profile, f.output, "test-source");
		const bundle = join(f.root, "machine-facts", "registry", "tasks", "test-task", "bundle");
		const unknowns = readJsonlText(join(bundle, "unknowns.jsonl"))
			.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
		expect(unknowns.some((item) => item.outcome_class === "NOT_EVALUABLE" && item.reason_code === "SCHEMA_BINDING_NOT_EVALUABLE")).toBe(true);
	});

	it("treats scheduler date placeholders as reversible parser values", () => {
		const f = fixture();
		writeFileSync(
			f.sql,
			"SELECT '${yyyy-MM-dd}' AS busi_date, id FROM demo.trd_${yyyyMM}_h UNION ALL SELECT '${yyyy-MM-dd}' AS busi_date, id FROM demo.trd_${yyyyMM,-1M}_h;\n",
			"utf8",
		);

		processProfile(f.profile, f.output, "test-source");
		const bundle = join(f.root, "machine-facts", "registry", "tasks", "test-task", "bundle");
		const statements = readJsonlText(join(bundle, "statements.jsonl"))
			.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
		const relations = readJsonlText(join(bundle, "relation-nodes.jsonl"))
			.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
		const unknowns = readJsonlText(join(bundle, "unknowns.jsonl"))
			.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));

		const nonEmptyStatements = statements.filter((item) => String(item.raw_sql).trim().length > 0);
		expect(nonEmptyStatements.length).toBeGreaterThan(0);
		expect(nonEmptyStatements.every((item) => item.parse_status === "SUCCESS")).toBe(true);
		expect(statements.map((item) => item.raw_sql).join("\n")).toContain("${yyyyMM,-1M}");
		expect(relations.some((item) => item.relation?.table === "demo.trd_${yyyyMM}_h")).toBe(true);
		expect(relations.some((item) => item.relation?.table === "demo.trd_${yyyyMM,-1M}_h")).toBe(true);
		expect(relations.some((item) => item.relation?.binding === "trd_${yyyyMM}_h")).toBe(true);
		expect(relations.some((item) => item.relation?.binding === "trd_${yyyyMM,-1M}_h")).toBe(true);
		expect(unknowns.some((item) => item.reason_code === "SYNTAX_DIAGNOSTIC")).toBe(false);
	});

	it("carries Plan Facts raw/display, roles, clauses, occurrences, window frame, and Top-N into Machine Facts", () => {
		const f = fixture();
		writeFileSync(
			f.sql,
			"SELECT COALESCE(\n  t.a,\n  t.b\n) AS result, SUM(t.a) OVER (PARTITION BY t.k ORDER BY t.ts DESC ROWS BETWEEN 2 PRECEDING AND CURRENT ROW) AS total FROM demo.source t WHERE t.a > 0 ORDER BY t.ts DESC LIMIT 2;\nSELECT t.k, COUNT(*) AS n FROM demo.source t WHERE t.a > 0 GROUP BY t.k HAVING COUNT(*) > 1 QUALIFY t.k > 0;\n",
			"utf8",
		);
		const schemaPath = join(f.root, "schema.json");
		const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
		schema.records[0].columns = [
			{ name: "id", partition: false },
			{ name: "a", partition: false },
			{ name: "b", partition: false },
			{ name: "k", partition: false },
			{ name: "ts", partition: false },
		];
		writeFileSync(schemaPath, JSON.stringify(schema), "utf8");

		processProfile(f.profile, f.output, "test-source");
		const bundle = join(f.root, "machine-facts", "registry", "tasks", "test-task", "bundle");
		const jsonl = (name: string): any[] => readJsonlRecords(join(bundle, name));
		const expressions = jsonl("field-expression-nodes.jsonl");
		const relations = jsonl("relation-nodes.jsonl");
		const reads = jsonl("dataset-io.jsonl").filter((record) => record.direction === "READ");
		const unknowns = jsonl("unknowns.jsonl");
		const coalesce = expressions.find((record) => record.expression_text.includes("COALESCE"));
		const window = expressions.find((record) => record.window_spec);

		expect(coalesce).toMatchObject({
			display_text: "COALESCE( t.a, t.b ) AS result",
			expression_roles: expect.arrayContaining([
				expect.objectContaining({ operator: "COALESCE", role: "COALESCE_ARGUMENT" }),
			]),
		});
		expect(coalesce.expression_text).toContain("\n");
		expect(window.window_spec.frame).toMatchObject({ status: "UNKNOWN", source_span: expect.any(Object) });
		expect(relations.filter((record) => record.relation_type === "filter").map((record) => record.relation.clause)).toEqual(["where", "where", "having", "qualify"]);
		expect(relations.some((record) => record.relation_type === "top_n" && record.relation.limit.fetch === undefined && record.relation.limit.kind === "LIMIT")).toBe(true);
		expect(reads[0]?.read_occurrences).toEqual(expect.arrayContaining([
			expect.objectContaining({ occurrence_id: expect.stringContaining("relation"), relation_id: expect.stringContaining("relation"), source_span: expect.any(Object) }),
		]));
		expect(unknowns.some((record) => record.reason_code === "PLAN_FACT_UNRESOLVED" && record.source_locator?.start !== undefined)).toBe(true);
	});

});
