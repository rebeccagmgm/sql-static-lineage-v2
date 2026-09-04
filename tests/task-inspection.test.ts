import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { canonicalJson, canonicalJsonl, sha256 } from "../scripts/machine-facts/machine-facts-contract.ts";
import { loadCurrentTaskBundle } from "../scripts/query/current-task-bundle.ts";
import {
	inspectTask,
	renderTaskInspectionHtml,
	writeTaskInspection,
	type QuestionSpec,
} from "../scripts/query/task-inspection.ts";

const roots: string[] = [];

const question = (taskId: string, outputFieldSeed: readonly string[] = ["target_id"]): QuestionSpec => ({
	question_id: "task-output-origin-v1",
	question_type: "TASK_OUTPUT_ORIGIN",
	task_id: taskId,
	output_field_seed: outputFieldSeed,
	requested_sections: ["io", "output_formula", "rowset_controls", "capabilities", "gaps"],
	stop_condition: "停止于静态证据闭合或明确记录缺失能力，不推断运行值或业务口径。",
});

function writeJson(path: string, value: unknown): void {
	writeFileSync(path, canonicalJson(value), "utf8");
}

function writeJsonl(path: string, records: readonly unknown[]): void {
	writeFileSync(path, canonicalJsonl(records), "utf8");
}

function refreshAttestation(factsRoot: string, taskId: string): void {
	const bundle = join(factsRoot, "registry", "tasks", taskId, "bundle");
	const manifestPath = join(bundle, "manifest.json");
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { outputs: Array<Record<string, unknown>> };
	manifest.outputs = manifest.outputs.map((output) => ({
		...output,
		content_sha256: sha256(readFileSync(join(bundle, String(output.path)))),
		...(String(output.path).endsWith(".jsonl")
			? {
					row_count: readFileSync(join(bundle, String(output.path)), "utf8").trim()
						? readFileSync(join(bundle, String(output.path)), "utf8")
								.trim()
								.split(/\r?\n/).length
						: 0,
				}
			: {}),
	}));
	writeJson(manifestPath, manifest);
	const manifestHash = sha256(readFileSync(manifestPath));
	const statusPath = join(factsRoot, "registry", "tasks", taskId, "analysis-status.json");
	const status = JSON.parse(readFileSync(statusPath, "utf8"));
	status.current_manifest_sha256 = manifestHash;
	writeJson(statusPath, status);
	const indexPath = join(factsRoot, "indexes", "task-fact-index.jsonl");
	const rows = readFileSync(indexPath, "utf8")
		.trim()
		.split(/\r?\n/)
		.filter(Boolean)
		.map((line) => JSON.parse(line));
	writeJsonl(
		indexPath,
		rows.map((row) => (row.task_id === taskId ? { ...row, manifest_sha256: manifestHash } : row)),
	);
}

function createL1Facts(options: { kind: "insert" | "ctas" | "unprovable"; independentSelect?: boolean }): {
	root: string;
	taskId: string;
} {
	const root = mkdtempSync(join("C:\\Users\\13246\\AppData\\Local\\Temp", "task-inspection-canary-"));
	roots.push(root);
	const factsRoot = join(root, "machine-facts");
	const taskId = `canary-${options.kind}`;
	const bundle = join(factsRoot, "registry", "tasks", taskId, "bundle");
	mkdirSync(bundle, { recursive: true });
	const primarySql =
		options.kind === "ctas"
			? "CREATE TABLE demo.target AS SELECT id FROM demo.source;"
			: "INSERT OVERWRITE TABLE demo.target SELECT id FROM demo.source;";
	const sql = options.independentSelect ? `${primarySql}\nSELECT id FROM demo.other;` : primarySql;
	const sqlHash = sha256(sql);
	const schema = JSON.stringify({ records: [{ qualified_name: "demo.source" }, { qualified_name: "demo.target" }] });
	const schemaHash = sha256(schema);
	mkdirSync(join(factsRoot, "snapshots", "sql"), { recursive: true });
	mkdirSync(join(factsRoot, "snapshots", "schema"), { recursive: true });
	writeFileSync(join(factsRoot, "snapshots", "sql", `${sqlHash}.sql`), sql, "utf8");
	writeFileSync(join(factsRoot, "snapshots", "schema", `${schemaHash}.json`), schema, "utf8");
	const statement = {
		statement_id: `task:${taskId}:statement:0`,
		task_id: taskId,
		statement_index: 0,
		statement_type: options.kind === "ctas" ? "CREATE_TABLE_AS" : "INSERT",
		span: { start: 0, end: primarySql.length },
		raw_sql: primarySql,
		parse_status: "SUCCESS",
	};
	const expression = {
		expression_id: `task:${taskId}:expression:0`,
		task_id: taskId,
		statement_id: statement.statement_id,
		relation_id: `task:${taskId}:relation:project`,
		role: "PROJECT_EXPRESSION",
		ordinal: 0,
		output_name: "target_id",
		expression_text: "id as target_id",
		source_span: { start: sql.indexOf("id"), end: sql.indexOf("id") + 2 },
		input_dependency_status: options.kind === "unprovable" ? "UNRESOLVED" : "PHYSICAL",
		input_fields:
			options.kind === "unprovable"
				? []
				: [
						{
							logical_source_id: "test",
							field_id: "field:test:demo.source.id",
							table: "demo.source",
							column: "id",
						},
					],
		unresolved_input_columns: options.kind === "unprovable" ? [{ name: "id", resolution: "UNRESOLVED" }] : [],
	};
	const files: Record<string, unknown[]> = {
		"statements.jsonl": options.independentSelect
			? [
					statement,
					{
						...statement,
						statement_id: `task:${taskId}:statement:1`,
						statement_index: 1,
						statement_type: "SELECT",
						raw_sql: "SELECT id FROM demo.other;",
						span: { start: primarySql.length + 1, end: sql.length },
					},
				]
			: [statement],
		"dataset-io.jsonl": [
			{
				task_id: taskId,
				direction: "READ",
				dataset_id: "dataset:test:demo.source",
				physical_dataset: "demo.source",
				provenance: "SQL_PLAN",
				resolution_status: "RESOLVED",
				statement_id: statement.statement_id,
			},
			{
				task_id: taskId,
				direction: "WRITE",
				dataset_id: "dataset:test:demo.target",
				physical_dataset: "demo.target",
				provenance: "SQL_PARSE",
				resolution_status: "RESOLVED",
				statement_id: statement.statement_id,
				write_observation_id: `write:${taskId}:0`,
				write_kind: options.kind === "ctas" ? "CTAS" : "INSERT",
				write_statement_id: statement.statement_id,
				query_producer_statement_id: statement.statement_id,
				target_dataset_id: "dataset:test:demo.target",
			},
		],
		"relation-nodes.jsonl": [
			{
				relation_id: `task:${taskId}:relation:read`,
				task_id: taskId,
				statement_id: statement.statement_id,
				relation_type: "read",
				source_span: { start: 0, end: primarySql.length },
				relation: { type: "read", table: "demo.source" },
				provenance: "SQL_PLAN",
			},
			{
				relation_id: `task:${taskId}:relation:project`,
				task_id: taskId,
				statement_id: statement.statement_id,
				relation_type: "project",
				source_span: { start: 0, end: primarySql.length },
				relation: { type: "project", source: `task:${taskId}:relation:read` },
				provenance: "SQL_PLAN",
			},
			{
				relation_id: `task:${taskId}:relation:filter`,
				task_id: taskId,
				statement_id: statement.statement_id,
				relation_type: "filter",
				source_span: { start: 0, end: primarySql.length },
				relation: {
					type: "filter",
					source: `task:${taskId}:relation:project`,
					predicate_display: "id is not null",
				},
				provenance: "SQL_PLAN",
			},
		],
		"relation-edges.jsonl": [],
		"field-expression-nodes.jsonl": [expression],
		"column-lineage-edges.jsonl":
			options.kind === "unprovable"
				? []
				: [
						{
							edge_id: `edge:${taskId}:0`,
							task_id: taskId,
							statement_id: statement.statement_id,
							from_field_id: "field:test:demo.source.id",
							to_expression_id: expression.expression_id,
							method: "PHYSICAL",
							resolution_provenance: "SQL_PLAN",
						},
					],
		"output-field-bindings.jsonl":
			options.kind === "unprovable"
				? []
				: [
						{
							binding_id: `binding:${taskId}:0`,
							task_id: taskId,
							write_observation_id: `write:${taskId}:0`,
							write_kind: options.kind === "ctas" ? "CTAS" : "INSERT",
							write_statement_id: statement.statement_id,
							query_producer_statement_id: options.independentSelect
								? statement.statement_id
								: statement.statement_id,
							statement_id: statement.statement_id,
							expression_id: expression.expression_id,
							target_dataset_id: "dataset:test:demo.target",
							target_field_id: "field:test:demo.target.target_id",
							target_dataset: "demo.target",
							target_field: "target_id",
							source_ordinal: 0,
							target_ordinal: 0,
							binding_method:
								options.kind === "ctas" ? "SQL_CREATE_POSITIONAL" : "EXPLICIT_TARGET_COLUMN_LIST",
							binding_status: "RESOLVED",
							target_schema_status: "MATCH",
							static_partition_columns: [],
							evidence_refs: [statement.statement_id],
						},
					],
		"unknowns.jsonl":
			options.kind === "unprovable"
				? [
						{
							unknown_id: `unknown:${taskId}:0`,
							task_id: taskId,
							outcome_class: "NOT_EVALUABLE",
							reason_code: "PRODUCER_OUTPUT_ENUMERATION_NOT_EVALUABLE",
							message: "CTAS/Star producer output cannot be enumerated",
							statement_id: statement.statement_id,
							subject: `write:${taskId}:0`,
						},
					]
				: [],
		"schema-refs.jsonl": [],
		"task-local-materializations.jsonl": [],
	};
	for (const [file, records] of Object.entries(files)) writeJsonl(join(bundle, file), records);
	const capabilitySummary = {
		schema_version: "machine-facts-capability-summary-v1",
		capabilities: {
			TASK_IO: {
				applicability: "APPLICABLE",
				subject_count: 2,
				resolved_count: 2,
				degraded_count: 0,
				blocked_count: 0,
				coverage: "READY",
			},
			RELATION_STRUCTURE: {
				applicability: "APPLICABLE",
				subject_count: 2,
				resolved_count: 2,
				degraded_count: 0,
				blocked_count: 0,
				coverage: "READY",
			},
			BASE_ORIGIN: {
				applicability: "APPLICABLE",
				subject_count: 1,
				resolved_count: options.kind === "unprovable" ? 0 : 1,
				degraded_count: options.kind === "unprovable" ? 0 : 0,
				blocked_count: options.kind === "unprovable" ? 1 : 0,
				coverage: options.kind === "unprovable" ? "NOT_EVALUABLE" : "READY",
			},
			OUTPUT_BINDING: {
				applicability: "APPLICABLE",
				subject_count: 1,
				resolved_count: options.kind === "unprovable" ? 0 : 1,
				degraded_count: 0,
				blocked_count: options.kind === "unprovable" ? 1 : 0,
				coverage: options.kind === "unprovable" ? "NOT_EVALUABLE" : "READY",
			},
		},
	};
	writeJson(join(bundle, "capability-summary.json"), capabilitySummary);
	const outputRecords = [...Object.keys(files).sort(), "capability-summary.json"].map((file) => ({
		path: file,
		schema_version: "l1-test",
		row_count: file.endsWith(".jsonl") ? files[file]!.length : 1,
		content_sha256: sha256(readFileSync(join(bundle, file))),
	}));
	const manifest = {
		schema_version: "2.0.0",
		task_id: taskId,
		logical_source_id: "test",
		status: "SUCCESS",
		inputs: {
			sql_sha256: sqlHash,
			sql_snapshot: `snapshots/sql/${sqlHash}.sql`,
			schema_bundle_sha256: schemaHash,
			schema_snapshot: `snapshots/schema/${schemaHash}.json`,
			analysis_config_sha256: "a".repeat(64),
		},
		method: {
			dialect: "databricks",
			parser: { engine: "test", version: "1" },
			adapter: { name: "machine-facts-writer", version: "2.0.0" },
			plan_adapter: { name: "plan-adapter", version: "test" },
		},
		outputs: outputRecords,
		counts: {},
		gates: {},
		boundaries: {
			business_logic_correctness: "NOT_EVALUATED",
			runtime_execution: "NOT_EVALUATED",
			business_rows_read: false,
			external_model_calls: 0,
			cross_task_field_stitching: "NOT_GENERATED",
		},
	};
	writeJson(join(bundle, "source-artifact.json"), {
		task_id: taskId,
		logical_source_id: "test",
		sql_sha256: sqlHash,
		sql_snapshot: `snapshots/sql/${sqlHash}.sql`,
	});
	writeJson(join(bundle, "manifest.json"), manifest);
	const manifestHash = sha256(readFileSync(join(bundle, "manifest.json")));
	writeJson(join(factsRoot, "registry", "tasks", taskId, "analysis-status.json"), {
		schema_version: "1.0.0",
		task_id: taskId,
		logical_source_id: "test",
		state: "SUCCESS",
		requested: { ...manifest.inputs, dialect: "databricks" },
		current_manifest_sha256: manifestHash,
	});
	mkdirSync(join(factsRoot, "indexes"), { recursive: true });
	writeJsonl(join(factsRoot, "indexes", "task-fact-index.jsonl"), [
		{
			task_id: taskId,
			logical_source_id: "test",
			sql_sha256: sqlHash,
			manifest_sha256: manifestHash,
			bundle_path: `registry/tasks/${taskId}/bundle`,
			status: "SUCCESS",
		},
	]);
	return { root: factsRoot, taskId };
}

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Task Inspection Consumer", () => {
	it("renders a resolved INSERT with full formula, source and evidence references", () => {
		const facts = createL1Facts({ kind: "insert" });
		const card = inspectTask({ factsRoot: facts.root, taskId: facts.taskId, questionSpec: question(facts.taskId) });
		expect(card.task.bundle_state).toBe("CURRENT_L1");
		expect(card.answer.status).toBe("READY");
		expect(card.output_fields[0].expression).toBe("id as target_id");
		expect(card.output_fields[0].source_fields[0].field_id).toBe("field:test:demo.source.id");
		expect(
			card.output_fields[0].evidence_refs.some((ref: string) => ref.includes("output-field-bindings.jsonl#L1")),
		).toBe(true);
		expect(card.question_spec_sha256).toHaveLength(64);
	});

	it("keeps resolvable CTAS bound to its same Write and does not pair an independent SELECT", () => {
		const facts = createL1Facts({ kind: "ctas", independentSelect: true });
		const card = inspectTask({ factsRoot: facts.root, taskId: facts.taskId, questionSpec: question(facts.taskId) });
		expect(card.answer.status).toBe("READY");
		expect(card.output_fields).toHaveLength(1);
		expect(card.output_fields[0].binding.query_producer_statement_id).toBe("task:canary-ctas:statement:0");
		expect(card.evidence.statement_refs).toHaveLength(2);
	});

	it("fails closed for an unprovable CTAS/Star without inventing output binding", () => {
		const facts = createL1Facts({ kind: "unprovable" });
		const card = inspectTask({ factsRoot: facts.root, taskId: facts.taskId, questionSpec: question(facts.taskId) });
		expect(card.answer.status).toBe("NOT_EVALUABLE");
		expect(card.output_fields).toHaveLength(0);
		expect(card.gaps.grouped.OUTPUT_BINDING[0].reason_code).toBe("PRODUCER_OUTPUT_ENUMERATION_NOT_EVALUABLE");
	});

	it("returns STALE and no stale facts when the Current Index no longer attests the Manifest", () => {
		const facts = createL1Facts({ kind: "insert" });
		const manifestPath = join(facts.root, "registry", "tasks", facts.taskId, "bundle", "manifest.json");
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
		manifest.method.adapter.version = "changed";
		writeJson(manifestPath, manifest);
		const load = loadCurrentTaskBundle(facts.root, facts.taskId);
		expect(load.state).toBe("STALE");
		const card = inspectTask({ factsRoot: facts.root, taskId: facts.taskId, questionSpec: question(facts.taskId) });
		expect(card.answer.status).toBe("STALE");
		expect(card.io.reads).toHaveLength(0);
		expect(card.next_verification.evidence_type).toBe("CURRENT_INDEX_AND_MANIFEST_HASH");
	});

	it("fails closed for duplicate Index rows and an L1 output omitted from Manifest", () => {
		const duplicate = createL1Facts({ kind: "insert" });
		const indexPath = join(duplicate.root, "indexes", "task-fact-index.jsonl");
		const row = JSON.parse(readFileSync(indexPath, "utf8"));
		writeJsonl(indexPath, [row, row]);
		expect(loadCurrentTaskBundle(duplicate.root, duplicate.taskId).state).toBe("INVALID");

		const omitted = createL1Facts({ kind: "insert" });
		const manifestPath = join(omitted.root, "registry", "tasks", omitted.taskId, "bundle", "manifest.json");
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
		manifest.outputs = manifest.outputs.filter((output: { path: string }) => output.path !== "statements.jsonl");
		writeJson(manifestPath, manifest);
		refreshAttestation(omitted.root, omitted.taskId);
		const load = loadCurrentTaskBundle(omitted.root, omitted.taskId);
		expect(load.state).toBe("INVALID");
		expect(load.issues).toContain("L1_REQUIRED_OUTPUT_NOT_DECLARED:statements.jsonl");
	});

	it("rejects a binding whose producer statement is not the Write producer", () => {
		const facts = createL1Facts({ kind: "ctas", independentSelect: true });
		const bindingPath = join(
			facts.root,
			"registry",
			"tasks",
			facts.taskId,
			"bundle",
			"output-field-bindings.jsonl",
		);
		const bindings = readFileSync(bindingPath, "utf8")
			.trim()
			.split(/\r?\n/)
			.map((line) => ({ ...JSON.parse(line), query_producer_statement_id: `task:${facts.taskId}:statement:1` }));
		writeJsonl(bindingPath, bindings);
		refreshAttestation(facts.root, facts.taskId);
		const card = inspectTask({ factsRoot: facts.root, taskId: facts.taskId, questionSpec: question(facts.taskId) });
		expect(card.answer.status).toBe("NOT_EVALUABLE");
		expect(card.output_fields[0].status).toBe("NOT_EVALUABLE");
		expect(card.gaps.grouped.OUTPUT_BINDING[0].reason_code).toBe("OUTPUT_BINDING_IDENTITY_NOT_CLOSED");
	});

	it("downgrades a resolved field when a blocking gap covers the same task", () => {
		const facts = createL1Facts({ kind: "insert" });
		const unknownPath = join(facts.root, "registry", "tasks", facts.taskId, "bundle", "unknowns.jsonl");
		writeJsonl(unknownPath, [
			{
				unknown_id: `unknown:${facts.taskId}:structure`,
				task_id: facts.taskId,
				outcome_class: "UNKNOWN",
				reason_code: "STRUCTURE_DIAGNOSTIC",
				message: "structure diagnostic",
				statement_id: `task:${facts.taskId}:statement:0`,
			},
			{
				unknown_id: `unknown:${facts.taskId}:schema`,
				task_id: facts.taskId,
				outcome_class: "NOT_EVALUABLE",
				reason_code: "TARGET_SCHEMA_NOT_EVALUABLE",
				message: "target schema is not proven",
				statement_id: `task:${facts.taskId}:statement:0`,
				subject: `write:${facts.taskId}:0`,
			},
		]);
		refreshAttestation(facts.root, facts.taskId);
		const card = inspectTask({ factsRoot: facts.root, taskId: facts.taskId, questionSpec: question(facts.taskId) });
		expect(card.output_fields[0].status).toBe("READY");
		expect(card.answer.status).toBe("PARTIAL");
		expect(card.gaps.grouped.OUTPUT_BINDING[0].reason_code).toBe("TARGET_SCHEMA_NOT_EVALUABLE");
		expect(card.gaps.grouped.OUTPUT_BINDING[0].evidence_refs[0]).toContain("unknowns.jsonl#L2");
	});

	it("does not allow derived output to be written into Canonical Facts", () => {
		const facts = createL1Facts({ kind: "insert" });
		expect(() =>
			writeTaskInspection({
				factsRoot: facts.root,
				taskId: facts.taskId,
				questionSpec: question(facts.taskId),
				outputDir: join(facts.root, "derived", "task-inspection"),
			}),
		).toThrow("DERIVED_OUTPUT_MUST_NOT_BE_UNDER_FACTS_ROOT");
	});

	it("rejects unsupported contracts, missing task scope and untraceable spans", () => {
		const unsupported = createL1Facts({ kind: "insert" });
		const unsupportedManifestPath = join(
			unsupported.root,
			"registry",
			"tasks",
			unsupported.taskId,
			"bundle",
			"manifest.json",
		);
		const unsupportedManifest = JSON.parse(readFileSync(unsupportedManifestPath, "utf8"));
		unsupportedManifest.schema_version = "2.1.0";
		writeJson(unsupportedManifestPath, unsupportedManifest);
		refreshAttestation(unsupported.root, unsupported.taskId);
		expect(loadCurrentTaskBundle(unsupported.root, unsupported.taskId).issues).toContain(
			"UNSUPPORTED_CONTRACT_VERSION:2.1.0",
		);

		const missingTaskId = createL1Facts({ kind: "insert" });
		const statementsPath = join(
			missingTaskId.root,
			"registry",
			"tasks",
			missingTaskId.taskId,
			"bundle",
			"statements.jsonl",
		);
		const statement = JSON.parse(readFileSync(statementsPath, "utf8"));
		delete statement.task_id;
		writeJsonl(statementsPath, [statement]);
		refreshAttestation(missingTaskId.root, missingTaskId.taskId);
		expect(loadCurrentTaskBundle(missingTaskId.root, missingTaskId.taskId).issues).toContain(
			"OUTPUT_TASK_ID_MISSING:statements.jsonl",
		);

		const badSpan = createL1Facts({ kind: "insert" });
		const expressionPath = join(
			badSpan.root,
			"registry",
			"tasks",
			badSpan.taskId,
			"bundle",
			"field-expression-nodes.jsonl",
		);
		const expression = JSON.parse(readFileSync(expressionPath, "utf8"));
		expression.source_span = { start: 0, end: 99999 };
		writeJsonl(expressionPath, [expression]);
		refreshAttestation(badSpan.root, badSpan.taskId);
		expect(
			loadCurrentTaskBundle(badSpan.root, badSpan.taskId).issues.some((issue) =>
				issue.startsWith("RECORD_SPAN_UNTRACEABLE:"),
			),
		).toBe(true);
	});

	it("rejects a derived output path that aliases the Canonical root", () => {
		const facts = createL1Facts({ kind: "insert" });
		const alias = `${facts.root}-alias`;
		try {
			symlinkSync(facts.root, alias, "junction");
			expect(() =>
				writeTaskInspection({
					factsRoot: facts.root,
					taskId: facts.taskId,
					questionSpec: question(facts.taskId),
					outputDir: join(alias, "derived"),
				}),
			).toThrow(/DERIVED_OUTPUT_(SYMLINK_PATH|REALPATH_UNDER_FACTS_ROOT)/);
		} finally {
			rmSync(alias, { recursive: true, force: true });
		}
	});

	it("changes reader identity when the Question Spec changes and keeps the static boundary visible", () => {
		const facts = createL1Facts({ kind: "insert" });
		const first = inspectTask({
			factsRoot: facts.root,
			taskId: facts.taskId,
			questionSpec: question(facts.taskId, ["target_id"]),
		});
		const second = inspectTask({
			factsRoot: facts.root,
			taskId: facts.taskId,
			questionSpec: { ...question(facts.taskId, ["other_id"]), stop_condition: "stop" },
		});
		expect(first.question_spec_sha256).not.toBe(second.question_spec_sha256);
		expect(first.boundaries.business_rows_read).toBe(false);
		expect(renderTaskInspectionHtml(first)).toContain("id as target_id");
	});

	it("escapes task, expression and gap content in the static page", () => {
		const facts = createL1Facts({ kind: "insert" });
		const card = inspectTask({ factsRoot: facts.root, taskId: facts.taskId, questionSpec: question(facts.taskId) });
		const html = renderTaskInspectionHtml({
			...card,
			task: { ...card.task, task_id: `\"><script>alert(1)</script>` },
			output_fields: [{ ...card.output_fields[0], expression: `</pre><script>alert(2)</script>` }],
			gaps: { count: 1, grouped: { OUTPUT_BINDING: [{ message: `<img src=x onerror=alert(3)>` }] } },
		});
		expect(html).not.toContain("<script>alert");
		expect(html).toContain("&lt;script&gt;");
		expect(html).toContain("&lt;img src=x onerror=alert(3)&gt;");
	});
});
