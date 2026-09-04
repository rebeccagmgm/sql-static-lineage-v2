import {
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	realpathSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { performance } from "node:perf_hooks";

import { Schema, SqlSession, type SchemaMapping } from "sqllens";

import {
	sha256File,
	validateTableDocument,
	validateTaskDocument,
	type SqlSlot,
	type TableEvidence,
	type TableDocument,
	type TaskDocument,
} from "../input/shared/input-pack.ts";
import { buildTaskPartitionEvidence } from "../input/shared/task-partition-evidence.ts";
import { extractSqlWrites } from "../evidence/sql-write-evidence.ts";
import { parseDdlSchema } from "../plans/ddl-schema.ts";
import { buildPlanFacts } from "../plans/plan-adapter.ts";
import { taskSqlDialect } from "../plans/task-sql-dialect.ts";
import { normalizeRepeatedSqlForAnalysis } from "../input/shared/sql-analysis-normalization.ts";
import { extractSqlReadTableNames } from "../input/shared/sql-table-references.ts";
import {
	canonicalJson,
	normalizeName,
	sha256,
	type GenericAnalysisProfile,
	type GenericTaskProfile,
	type InputPackProvenance,
	type PlatformTargetQueryOutput,
	type SqlWritePartitionEvidence,
} from "./machine-facts-contract.ts";
import {
	rebuildIndex,
	runTask,
	updateIndexIncrementally,
	type ProfileRunResult,
	type TaskRunResult,
} from "./machine-facts.ts";
import {
	defaultWriterCatalogPath,
	openWriterCatalog,
	syncWriterCatalogAfterMachineFacts,
} from "../query/writer-catalog.ts";

type JsonRecord = Record<string, unknown>;

export interface PhysicalTableCatalogEntry {
	readonly platform: string;
	readonly dataSource: string;
	readonly stableTableId: string;
	readonly qualifiedName: string;
	readonly guid: string | null;
	readonly partitionFields: readonly string[] | null;
	readonly columns: readonly string[];
	readonly tablePath: string;
	readonly ddlPath: string;
	readonly tableContentHash: string;
	readonly ddlSha256: string;
}

export interface PhysicalTableCatalog {
	readonly entries: readonly PhysicalTableCatalogEntry[];
	readonly issues: readonly string[];
	readonly byPhysicalKey: ReadonlyMap<string, PhysicalTableCatalogEntry>;
	readonly byQualifiedName: ReadonlyMap<string, readonly PhysicalTableCatalogEntry[]>;
	readonly byNameTail: ReadonlyMap<string, readonly PhysicalTableCatalogEntry[]>;
}

export interface PhysicalTableCatalogOptions {
	readonly lazyDdl?: boolean;
}

export interface SelectedLineageSql {
	readonly slot: string;
	readonly path: string;
	readonly locator: string;
	readonly sha256: string;
	readonly content: string;
	readonly analysisContent: string;
	readonly analysisSha256: string;
	readonly evidenceProvider: string;
}

export interface PreparedInputPackTask {
	readonly taskId: string;
	readonly taskName: string | null;
	readonly taskCategory: string;
	readonly taskPath: string;
	readonly task: TaskDocument & JsonRecord;
	readonly target: PhysicalTableCatalogEntry;
	readonly sql: SelectedLineageSql;
	readonly sqlSources: readonly SelectedLineageSql[];
	readonly sqlSegments: readonly { readonly slot: string; readonly start: number; readonly end: number }[];
	readonly dialect: "databricks" | "duckdb";
	readonly logicalSourceId: string;
	readonly schemaBundle: JsonRecord;
	readonly schemaBundleHash: string;
	readonly profileTask: GenericTaskProfile;
	readonly provenance: InputPackProvenance;
	readonly inputHashes: ReadonlyMap<string, string>;
}

export interface PrepareInputPackTaskOptions {
	readonly dataRoot: string;
	readonly taskId: string;
	readonly taskPath?: string;
	readonly tableCatalog?: PhysicalTableCatalog;
	readonly ddlCache?: Map<string, string>;
	readonly beforeFinalVerification?: () => void;
}

export interface RunInputPackMachineFactsOptions {
	readonly dataRoot: string;
	readonly taskIds: readonly string[];
	readonly outputRoot: string;
	readonly tableCatalog?: PhysicalTableCatalog;
	readonly taskPathIndex?: ReadonlyMap<string, readonly string[]>;
	readonly indexMode?: "full" | "incremental";
	readonly beforeFinalVerification?: (taskId: string) => void;
	/** SQLite writer catalog path; defaults to sibling of data root. Pass null to disable. */
	readonly writerCatalogPath?: string | null;
	readonly noWriterCatalog?: boolean;
}

export interface InputPackMachineFactsRunResult {
	readonly output_root: string;
	readonly tasks: readonly TaskRunResult[];
	readonly index: ProfileRunResult["index"];
	readonly timings: {
		readonly index_ms: number;
		readonly index_mode: "full" | "incremental";
	};
	readonly prepared: readonly {
		readonly taskId: string;
		readonly sqlSlot: string;
		readonly target: string;
		readonly taskContentHash: string;
		readonly tableContentHash: string;
	}[];
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function asRecord(value: unknown): JsonRecord | null {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonRecord) : null;
}

function nonEmpty(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed === "" || trimmed === "-" ? null : trimmed;
}

function normalizeToken(value: string): string {
	return value.trim().toLowerCase();
}

export function physicalTableKey(value: Pick<PhysicalTableCatalogEntry, "platform" | "dataSource" | "qualifiedName">): string {
	return `${normalizeToken(value.platform)}|${normalizeToken(value.dataSource)}|${normalizeName(value.qualifiedName)}`;
}

function relativeLocator(dataRoot: string, path: string): string {
	return relative(dataRoot, path).replaceAll("\\", "/");
}

function isWithin(root: string, path: string): boolean {
	const relation = relative(resolve(root), resolve(path));
	return relation === "" || (relation !== ".." && !relation.startsWith(`..${sep}`) && !isAbsolute(relation));
}

function discoverNamedFiles(root: string, name: string): string[] {
	if (!existsSync(root)) return [];
	const result: string[] = [];
	const visit = (directory: string): void => {
		for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => compareText(left.name, right.name))) {
			const path = join(directory, entry.name);
			if (entry.isSymbolicLink()) continue;
			if (entry.isDirectory()) visit(path);
			else if (entry.isFile() && entry.name === name) result.push(path);
		}
	};
	visit(resolve(root));
	return result.sort(compareText);
}

export function indexTaskInputPacks(dataRootInput: string): ReadonlyMap<string, readonly string[]> {
	const grouped = new Map<string, string[]>();
	for (const taskPath of discoverNamedFiles(join(resolve(dataRootInput), "tasks"), "task.json")) {
		const taskId = basename(dirname(taskPath));
		const paths = grouped.get(taskId) ?? [];
		paths.push(taskPath);
		grouped.set(taskId, paths);
	}
	return new Map([...grouped.entries()].map(([taskId, paths]) => [taskId, [...paths].sort(compareText)]));
}

function verifiedFile(path: string, expectedHash: string, reason: string): Buffer {
	if (!existsSync(path) || !lstatSync(path).isFile()) throw new Error(`${reason}_MISSING:${path}`);
	const bytes = readFileSync(path);
	const actual = sha256(bytes);
	if (actual !== expectedHash) throw new Error(`${reason}_HASH_MISMATCH:${path}:expected=${expectedHash}:actual=${actual}`);
	return bytes;
}

function targetRecord(task: TaskDocument & JsonRecord): { platform: string; dataSource: string; qualifiedName: string } {
	const target = asRecord(task.target);
	const platform = nonEmpty(target?.platform);
	const dataSource = nonEmpty(target?.dataSource);
	const qualifiedName = nonEmpty(target?.qualifiedName);
	if (!platform || !dataSource || !qualifiedName) throw new Error(`TASK_TARGET_PHYSICAL_IDENTITY_UNRESOLVED:${task.taskId}`);
	return { platform, dataSource, qualifiedName: normalizeName(qualifiedName) };
}

function fieldProducingSql(sql: string): boolean {
	const normalized = sql.replace(/--[^\r\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ");
	return (
		/^\s*(?:select|with)\b/i.test(normalized) ||
		/\binsert\s+(?:overwrite|into)\b[\s\S]*\bselect\b/i.test(normalized) ||
		/\bcreate\s+(?:or\s+replace\s+)?table\b[\s\S]*\bas\s+(?:select|with)\b/i.test(normalized)
	);
}

export function selectLineageSql(
	dataRoot: string,
	taskPath: string,
	task: TaskDocument & JsonRecord,
): { selected: SelectedLineageSql; sources: readonly SelectedLineageSql[]; hashes: ReadonlyMap<string, string> } {
	const taskDirectory = dirname(taskPath);
	const sqlEntries = Array.isArray(task.sqlFiles) ? task.sqlFiles.map(asRecord).filter((item): item is JsonRecord => item !== null) : [];
	const loaded: SelectedLineageSql[] = [];
	const hashes = new Map<string, string>([[taskPath, sha256File(taskPath)]]);
	for (const entry of sqlEntries) {
		const slot = nonEmpty(entry.slot);
		const relativePath = nonEmpty(entry.path);
		const expectedHash = nonEmpty(entry.sha256);
		const evidenceProvider = nonEmpty(entry.evidenceProvider);
		if (!slot || !relativePath || !expectedHash || !evidenceProvider) throw new Error(`TASK_SQL_INDEX_INVALID:${task.taskId}`);
		const path = resolve(taskDirectory, relativePath);
		if (!isWithin(taskDirectory, path)) throw new Error(`TASK_SQL_PATH_UNSAFE:${relativePath}`);
		const bytes = verifiedFile(path, expectedHash, "TASK_SQL");
		hashes.set(path, expectedHash);
		const content = bytes.toString("utf8");
		const analysisContent = normalizeRepeatedSqlForAnalysis(content);
		loaded.push({
			slot,
			path,
			locator: relativeLocator(dataRoot, path),
			sha256: expectedHash,
			content,
			analysisContent,
			analysisSha256: sha256(Buffer.from(analysisContent, "utf8")),
			evidenceProvider,
		});
	}
	const query = loaded.filter((item) => item.slot === "query");
	if (query.length === 1) return { selected: query[0]!, sources: loaded, hashes };
	const candidates = loaded.filter((item) => fieldProducingSql(item.content));
	if (candidates.length !== 1)
		throw new Error(`SQL_SLOT_SELECTION_AMBIGUOUS:${task.taskId}:candidates=${candidates.map((item) => item.slot).sort(compareText).join(",") || "NONE"}`);
	return { selected: candidates[0]!, sources: loaded, hashes };
}

export function loadPhysicalTableCatalog(
	dataRootInput: string,
	options: PhysicalTableCatalogOptions = {},
): PhysicalTableCatalog {
	const dataRoot = resolve(dataRootInput);
	const entries: PhysicalTableCatalogEntry[] = [];
	const issues: string[] = [];
	for (const tablePath of discoverNamedFiles(join(dataRoot, "tables"), "table.json")) {
		try {
			const raw: unknown = JSON.parse(readFileSync(tablePath, "utf8"));
			validateTableDocument(raw);
			const document = raw as TableDocument & JsonRecord;
			const ddlFile = asRecord(document.ddlFile);
			const ddlRelative = nonEmpty(ddlFile?.path);
			const ddlHash = nonEmpty(ddlFile?.sha256);
			if (!ddlRelative || !ddlHash) throw new Error("DDL_INDEX_INVALID");
			const ddlPath = resolve(dirname(tablePath), ddlRelative);
			if (!isWithin(dirname(tablePath), ddlPath)) throw new Error("DDL_PATH_UNSAFE");
			let loadedColumns: readonly string[] | undefined;
			let attemptedColumns = false;
			const getColumns = (): readonly string[] => {
				if (attemptedColumns) return loadedColumns ?? [];
				attemptedColumns = true;
				try {
					const ddl = verifiedFile(ddlPath, ddlHash, "DDL").toString("utf8");
					const parsed = parseDdlSchema(ddl);
					const columns = parsed.columns.map((column) => normalizeName(column.name));
					if (columns.length === 0) throw new Error(`DDL_COLUMNS_UNAVAILABLE:${parsed.warnings.join(",")}`);
					loadedColumns = columns;
				} catch (error) {
					if (!options.lazyDdl) throw error;
					issues.push(`${relativeLocator(dataRoot, tablePath)}:${error instanceof Error ? error.message : String(error)}`);
					loadedColumns = [];
				}
				return loadedColumns;
			};
			const columns = options.lazyDdl ? undefined : getColumns();
			if (!options.lazyDdl && columns?.length === 0) throw new Error(`DDL_COLUMNS_UNAVAILABLE:${ddlPath}`);
			entries.push({
				platform: String(document.platform),
				dataSource: String(document.dataSource),
				stableTableId: String(document.stableTableId),
				qualifiedName: normalizeName(String(document.qualifiedName)),
				guid: nonEmpty(document.guid),
				partitionFields: Array.isArray(document.partitionFields)
					? document.partitionFields.map((field) => normalizeName(String(field)))
					: null,
				get columns() {
					return columns ?? getColumns();
				},
				tablePath,
				ddlPath,
				tableContentHash: String(document.contentHash),
				ddlSha256: ddlHash,
			});
		} catch (error) {
			issues.push(`${relativeLocator(dataRoot, tablePath)}:${error instanceof Error ? error.message : String(error)}`);
		}
	}
	entries.sort((left, right) => compareText(physicalTableKey(left), physicalTableKey(right)));
	const grouped = new Map<string, PhysicalTableCatalogEntry[]>();
	for (const entry of entries) {
		const names = grouped.get(normalizeName(entry.qualifiedName)) ?? [];
		names.push(entry);
		grouped.set(normalizeName(entry.qualifiedName), names);
	}
	const tailGrouped = new Map<string, PhysicalTableCatalogEntry[]>();
	for (const entry of entries) {
		const tail = normalizeName(entry.qualifiedName.split(".").at(-1) ?? entry.qualifiedName);
		const names = tailGrouped.get(tail) ?? [];
		names.push(entry);
		tailGrouped.set(tail, names);
	}
	const byPhysicalKey = new Map<string, PhysicalTableCatalogEntry>();
	for (const entry of entries) {
		const key = physicalTableKey(entry);
		if (byPhysicalKey.has(key)) issues.push(`DUPLICATE_PHYSICAL_TABLE:${key}`);
		else byPhysicalKey.set(key, entry);
	}
	return {
		entries,
		issues: issues.sort(compareText),
		byPhysicalKey,
		byQualifiedName: new Map([...grouped.entries()].map(([key, values]) => [key, [...values].sort((a, b) => compareText(physicalTableKey(a), physicalTableKey(b)))])),
		byNameTail: new Map([...tailGrouped.entries()].map(([key, values]) => [key, [...values].sort((a, b) => compareText(physicalTableKey(a), physicalTableKey(b)))])),
	};
}

function partitionStatus(
	task: TaskDocument & JsonRecord,
	target: PhysicalTableCatalogEntry,
): Pick<PlatformTargetQueryOutput, "partition_status" | "partition_columns"> {
	const columns = target.partitionFields;
	if (columns === null) return { partition_status: "UNKNOWN", partition_columns: [] };
	if (columns.length === 0) return { partition_status: "NOT_PARTITIONED", partition_columns: [] };
	if (task.partition === null) return { partition_status: "CONFLICT", partition_columns: columns };
	if (task.partition === undefined) return { partition_status: "UNKNOWN", partition_columns: columns };
	const variants = Array.isArray(task.partition) ? task.partition : [task.partition];
	const complete = variants.length > 0 && variants.every((variant) => {
		const record = asRecord(variant);
		return record !== null && columns.every((column) => nonEmpty(record[column]) !== null);
	});
	return { partition_status: complete ? "COMPLETE" : "INCOMPLETE", partition_columns: columns };
}

function sameTableReference(left: string, right: string): boolean {
	const normalize = (value: string): string => normalizeName(value);
	const normalizedLeft = normalize(left);
	const normalizedRight = normalize(right);
	return (
		normalizedLeft === normalizedRight ||
		normalizedLeft.split(".").at(-1) === normalizedRight.split(".").at(-1)
	);
}

function sqlWritePartitionEvidence(
	dataRoot: string,
	task: TaskDocument & JsonRecord,
	taskTarget: PhysicalTableCatalogEntry,
	catalog: PhysicalTableCatalog,
	schemaEntries: readonly PhysicalTableCatalogEntry[],
	sources: readonly SelectedLineageSql[],
	ddlCache?: Map<string, string>,
): readonly SqlWritePartitionEvidence[] {
	const tables: TableEvidence[] = schemaEntries.map((entry) => ({
		platform: entry.platform,
		dataSource: entry.dataSource,
		qualifiedName: entry.qualifiedName,
		objectType: "TABLE",
		partitionFields: entry.partitionFields,
		ddl: (() => {
			const cached = ddlCache?.get(entry.ddlPath);
			if (cached !== undefined) return cached;
			const ddl = verifiedFile(entry.ddlPath, entry.ddlSha256, "DDL").toString("utf8");
			ddlCache?.set(entry.ddlPath, ddl);
			return ddl;
		})(),
		evidenceProvider: `input-pack:${entry.tableContentHash}`,
	}));
	const sql = Object.fromEntries(sources.map((source) => [source.slot, source.content])) as Partial<Record<SqlSlot, string>>;
	const evidence = buildTaskPartitionEvidence({
		taskTarget: taskTarget.qualifiedName,
		tables,
		sql,
		sparkIndexMode: String(task.taskCategory).toLowerCase() === "sparkindex",
	});
	return evidence.targets
		.filter((target) => target.writes.length > 0)
		.flatMap((target) => {
			const tableEntry = uniquePhysicalTableForReference(catalog, target.target);
			return target.writes.map((write) => {
				const source = write.sqlSlot === null
					? undefined
					: sources.find((candidate) => candidate.slot === write.sqlSlot);
				const sqlWrite = source === undefined
					? undefined
					: extractSqlWrites(source.content).find(
							(candidate) =>
								sameTableReference(candidate.qualifiedName, target.target) &&
								candidate.statementOrdinal === write.statementOrdinal,
						);
				const evidenceRefs = [
					...write.evidence.map((item) => `${item.source}:${item.locator}`),
					...(tableEntry
						? [
							`TABLE_PACK:${relativeLocator(dataRoot, tableEntry.tablePath)}`,
							`DDL:${relativeLocator(dataRoot, tableEntry.ddlPath)}`,
						]
						: []),
				];
				return {
					target: normalizeName(target.target),
					...(write.sqlSlot === null ? {} : { sql_slot: write.sqlSlot }),
					statement_ordinal: write.statementOrdinal === null ? undefined : write.statementOrdinal - 1,
					...(sqlWrite === undefined
						? {}
						: {
								statement_start: sqlWrite.statementSpan.start,
								statement_end: sqlWrite.statementSpan.end,
							}),
					status: tableEntry === undefined ? "UNKNOWN" : write.status,
					partition_columns: tableEntry === undefined ? [] : target.fields,
					evidence_refs: [...new Set(evidenceRefs)].sort(compareText),
				};
			});
		});
}

function schemaBundle(
	catalog: PhysicalTableCatalog,
	logicalSourceId: string,
	entries: readonly PhysicalTableCatalogEntry[] = catalog.entries,
): JsonRecord {
	const tailCounts = new Map<string, number>();
	for (const entry of catalog.entries) {
		const tail = entry.qualifiedName.split(".").at(-1)!;
		tailCounts.set(tail, (tailCounts.get(tail) ?? 0) + 1);
	}
	return {
		schema_version: "machine-facts-schema-bundle-v1",
		logical_source_id: logicalSourceId,
		records: entries.map((entry) => ({
			qualified_name: entry.qualifiedName,
			guid: entry.guid,
			status: "SUCCESS",
			source: `input-pack:${entry.tableContentHash}`,
			metadata_qualified_name: entry.qualifiedName,
			ddl_sha256: entry.ddlSha256,
			table_status: "AVAILABLE",
			required_for_star: false,
			columns: entry.columns.map((name) => ({ name, partition: entry.partitionFields?.includes(name) === true })),
			aliases: tailCounts.get(entry.qualifiedName.split(".").at(-1)!) === 1
				? [entry.qualifiedName.split(".").at(-1)!]
				: [],
		})),
	};
}

function addSchemaMapping(mapping: SchemaMapping, qualifiedName: string, columns: readonly string[]): void {
	const parts = normalizeName(qualifiedName).split(".").filter(Boolean);
	if (parts.length === 0) return;
	let current = mapping;
	for (const part of parts.slice(0, -1)) {
		const existing = current[part];
		if (!existing || typeof existing !== "object" || Array.isArray(existing)) current[part] = {};
		current = current[part] as SchemaMapping;
	}
	current[parts.at(-1)!] = Object.fromEntries(columns.map((column) => [normalizeName(column), "unknown"]));
}

function taskLocalWriteTarget(sql: string): string | null {
	const create = /\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?([A-Za-z0-9_$`".\[\]-]+)[\s\S]*?\bas\s+(?:select|with)\b/i.exec(sql);
	const insert = /\binsert\s+(?:overwrite|into)\s+(?:table\s+)?([A-Za-z0-9_$`".\[\]-]+)/i.exec(sql);
	const raw = create?.[1] ?? insert?.[1];
	if (!raw) return null;
	return normalizeName(raw.replaceAll("`", "").replaceAll('"', "").replaceAll("[", "").replaceAll("]", ""));
}

function hasUniquePhysicalTable(
	catalog: PhysicalTableCatalog,
	target: string,
): boolean {
	const normalized = normalizeName(target);
	if ((catalog.byQualifiedName.get(normalized) ?? []).length === 1) return true;
	const tail = normalized.split(".").at(-1) ?? normalized;
	return catalog.entries.filter(
		(entry) =>
			normalizeName(entry.qualifiedName.split(".").at(-1) ?? entry.qualifiedName) ===
			tail,
	).length === 1;
}

function uniquePhysicalTableForReference(
	catalog: PhysicalTableCatalog,
	target: string,
): PhysicalTableCatalogEntry | undefined {
	const normalized = normalizeName(target);
	const exact = catalog.byQualifiedName.get(normalized) ?? [];
	if (exact.length === 1) return exact[0];
	const tail = normalized.split(".").at(-1) ?? normalized;
	const matches = catalog.entries.filter(
		(entry) =>
			normalizeName(entry.qualifiedName.split(".").at(-1) ?? entry.qualifiedName) ===
			tail,
	);
	return matches.length === 1 ? matches[0] : undefined;
}

function taskSchemaEntries(
	catalog: PhysicalTableCatalog,
	target: PhysicalTableCatalogEntry,
	sources: readonly SelectedLineageSql[],
	dialect: "databricks" | "duckdb",
): readonly PhysicalTableCatalogEntry[] {
	const references = new Set<string>([target.qualifiedName]);
	for (const source of sources) {
		for (const name of extractSqlReadTableNames(source.analysisContent)) references.add(name);
		for (const write of extractSqlWrites(source.content)) references.add(write.qualifiedName);
		try {
			const session = SqlSession.create(source.analysisContent, dialect);
			for (const [statementIndex, cell] of session.doc.statements.entries()) {
				const plan = buildPlanFacts(cell, source.analysisContent, {
					statement_index: statementIndex,
					dialect,
					include_expression_dependencies: false,
				});
				for (const name of plan.physical_inputs) references.add(name);
			}
		} catch {
			// Keep the conservative text discovery above when a source cannot be parsed.
		}
	}
	const selected = new Set<PhysicalTableCatalogEntry>([target]);
	for (const reference of references) {
		const normalized = normalizeName(reference);
		const exact = catalog.byQualifiedName.get(normalized) ?? [];
		if (exact.length > 0) {
			for (const entry of exact) selected.add(entry);
			continue;
		}
		const tail = normalized.split(".").at(-1) ?? normalized;
		const suffixMatches = catalog.byNameTail.get(tail) ?? [];
		if (suffixMatches.length === 1) selected.add(suffixMatches[0]!);
	}
	return catalog.entries.filter((entry) => selected.has(entry));
}

function deriveTaskLocalSchemas(
	catalog: PhysicalTableCatalog,
	schemaEntries: readonly PhysicalTableCatalogEntry[],
	sources: readonly SelectedLineageSql[],
	taskId: string,
	dialect: "databricks" | "duckdb",
): JsonRecord[] {
	const mapping: SchemaMapping = {};
	for (const entry of schemaEntries) addSchemaMapping(mapping, entry.qualifiedName, entry.columns);
	const records: JsonRecord[] = [];
	for (const source of sources) {
		const split = SqlSession.create(source.analysisContent, dialect, { schema: new Schema(mapping) });
		for (const cell of split.doc.statements) {
			const rawSql = source.analysisContent.slice(cell.span.start, cell.span.end);
			const target = taskLocalWriteTarget(rawSql);
			if (!target || hasUniquePhysicalTable(catalog, target)) continue;
			const session = SqlSession.create(rawSql, dialect, { schema: new Schema(mapping) });
			const statement = session.doc.statements[0];
			if (!statement) continue;
			const plan = buildPlanFacts(statement, rawSql, {
				statement_index: 0,
				dialect,
				schema: new Schema(mapping),
				include_expression_dependencies: true,
			});
			const roots = (plan.relations as unknown as JsonRecord[]).filter((relation) => plan.roots.includes(String(relation.id)));
			const rootColumns = roots.length === 1 && Array.isArray(roots[0]?.output_columns)
				? roots[0]!.output_columns.map((column) => normalizeName(String(column))).filter((column) => column && column !== "*")
				: [];
			if (rootColumns.length === 0 || new Set(rootColumns).size !== rootColumns.length) continue;
			addSchemaMapping(mapping, target, rootColumns);
			if ((catalog.byQualifiedName.get(target) ?? []).length === 1) continue;
			records.push({
				qualified_name: target,
				guid: null,
				status: "SUCCESS",
				source: `input-pack-task-local-write:${taskId}:${source.slot}`,
				metadata_qualified_name: target,
				ddl_sha256: null,
				table_status: "TASK_LOCAL",
				required_for_star: true,
				columns: rootColumns.map((name) => ({ name, partition: false })),
				aliases: [],
			});
		}
	}
	return records;
}

function combinedLineageSql(
	allSources: readonly SelectedLineageSql[],
	selected: SelectedLineageSql,
): { sql: SelectedLineageSql; sources: readonly SelectedLineageSql[]; segments: readonly { slot: string; start: number; end: number }[] } {
	const rank = new Map(["create", "prepare", "query"].map((slot, index) => [slot, index]));
	const candidates = allSources
		.filter((source) => fieldProducingSql(source.analysisContent) || source.slot === selected.slot)
		.sort((left, right) => (rank.get(left.slot) ?? 100) - (rank.get(right.slot) ?? 100) || compareText(left.slot, right.slot));
	const sources = candidates.length > 0 ? candidates : [selected];
	let content = "";
	const segments: { slot: string; start: number; end: number }[] = [];
	for (const source of sources) {
		if (content.length > 0) {
			const trimmedEnd = content.trimEnd().length;
			if (!content.slice(0, trimmedEnd).endsWith(";")) {
				// Keep the derived terminator inside the preceding segment so its parser span
				// remains attributable to the original slot.
				content += ";";
				segments[segments.length - 1]!.end = content.length;
			}
			if (!content.endsWith("\n")) content += "\n";
		}
		const start = content.length;
		content += source.analysisContent;
		segments.push({ slot: source.slot, start, end: content.length });
	}
	const digest = sha256(Buffer.from(content, "utf8"));
	return {
			sql: {
				slot: sources.length === 1 ? sources[0]!.slot : "multi",
				path: selected.path,
				locator: sources.length === 1 ? sources[0]!.locator : `derived:task-sql-slots:${sources.map((source) => source.slot).join(",")}`,
				sha256: digest,
				content,
				analysisContent: content,
				analysisSha256: digest,
				evidenceProvider: [...new Set(sources.map((source) => source.evidenceProvider))].sort(compareText).join(","),
		},
		sources,
		segments,
	};
}

function verifyStableInputs(hashes: ReadonlyMap<string, string>): void {
	for (const [path, expected] of hashes) {
		if (!existsSync(path) || sha256File(path) !== expected) throw new Error(`INPUT_CHANGED_DURING_PREPARATION:${path}`);
	}
}

export function prepareInputPackTask(options: PrepareInputPackTaskOptions): PreparedInputPackTask {
	const dataRoot = resolve(options.dataRoot);
	if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(options.taskId)) throw new Error("TASK_ID_INVALID");
	const taskPaths = options.taskPath === undefined
		? discoverNamedFiles(join(dataRoot, "tasks"), "task.json").filter((path) => basename(dirname(path)) === options.taskId)
		: [resolve(options.taskPath)];
	if (taskPaths.length === 0) throw new Error(`TASK_INPUT_PACK_MISSING:${options.taskId}`);
	if (taskPaths.length !== 1) throw new Error(`TASK_INPUT_PACK_AMBIGUOUS:${options.taskId}`);
	const taskPath = taskPaths[0]!;
	if (basename(dirname(taskPath)) !== options.taskId) throw new Error(`TASK_INPUT_PACK_PATH_MISMATCH:${options.taskId}`);
	if (!isWithin(join(dataRoot, "tasks"), taskPath)) throw new Error(`TASK_INPUT_PACK_PATH_UNSAFE:${options.taskId}`);
	const taskRaw: unknown = JSON.parse(readFileSync(taskPath, "utf8"));
	validateTaskDocument(taskRaw);
	const task = taskRaw as TaskDocument & JsonRecord;
	if (task.taskId !== options.taskId) throw new Error(`TASK_IDENTITY_MISMATCH:${options.taskId}`);
	const selected = selectLineageSql(dataRoot, taskPath, task);
	const combined = combinedLineageSql(selected.sources, selected.selected);
	const catalog = options.tableCatalog ?? loadPhysicalTableCatalog(dataRoot, { lazyDdl: true });
	const targetRef = targetRecord(task);
	const target = catalog.byPhysicalKey.get(physicalTableKey(targetRef));
	if (!target) throw new Error(`TARGET_TABLE_PACK_MISSING:${physicalTableKey(targetRef)}`);
	const logicalSourceId = `${normalizeToken(target.platform)}-${normalizeToken(target.dataSource)}`;
	const dialect = taskSqlDialect(String(task.taskCategory));
	const schemaEntries = taskSchemaEntries(catalog, target, combined.sources, dialect);
	if (target.columns.length === 0) throw new Error(`TARGET_SCHEMA_NOT_PROVABLE:${target.qualifiedName}`);
	const baseBundle = schemaBundle(catalog, logicalSourceId, schemaEntries);
	const bundle = {
		...baseBundle,
		records: [
			...((baseBundle.records as JsonRecord[]) ?? []),
			...deriveTaskLocalSchemas(catalog, schemaEntries, combined.sources, options.taskId, dialect),
		],
	};
	const bundleHash = sha256(canonicalJson(bundle));
	const inputHashes = new Map(selected.hashes);
	for (const entry of schemaEntries) {
		inputHashes.set(entry.tablePath, sha256File(entry.tablePath));
		inputHashes.set(entry.ddlPath, entry.ddlSha256);
	}
	const provenance: InputPackProvenance = {
		schema_version: "machine-facts-input-pack-provenance-v1",
		data_root: realpathSync.native(dataRoot),
		task_locator: relativeLocator(dataRoot, taskPath),
		task_content_hash: String(task.contentHash),
		sql_slot: selected.selected.slot,
		sql_locator: selected.selected.locator,
		sql_sha256: selected.selected.sha256,
		sql_sources: combined.sources.map((source) => ({ slot: source.slot, locator: source.locator, sha256: source.sha256 })),
		analysis_sql_sha256: combined.sql.sha256,
		table_locator: relativeLocator(dataRoot, target.tablePath),
		table_content_hash: target.tableContentHash,
		ddl_locator: relativeLocator(dataRoot, target.ddlPath),
		ddl_sha256: target.ddlSha256,
	};
	const platformOutput = task.targetEvidenceKind === "DIRECT_PLATFORM_TARGET"
		? {
				target: target.qualifiedName,
				...partitionStatus(task, target),
				evidence_refs: [provenance.task_locator, provenance.table_locator, provenance.ddl_locator],
			} satisfies PlatformTargetQueryOutput
		: undefined;
	const explicitWritePartitionEvidence = sqlWritePartitionEvidence(dataRoot, task, target, catalog, schemaEntries, combined.sources, options.ddlCache);
	const profileTask: GenericTaskProfile = {
		task_id: options.taskId,
		sql_snapshot: combined.sql.path,
		writes: target.qualifiedName,
		...(combined.sources.length === 1 ? { sql_slot: combined.sources[0]!.slot } : { sql_segments: combined.segments }),
		input_pack_provenance: provenance,
		write_partition_evidence: {
			status: partitionStatus(task, target).partition_status,
			partition_columns: partitionStatus(task, target).partition_columns,
			evidence_refs: [provenance.task_locator, provenance.table_locator, provenance.ddl_locator],
		},
		...(explicitWritePartitionEvidence.length > 0 ? { sql_write_partition_evidence: explicitWritePartitionEvidence } : {}),
		...(platformOutput ? { platform_target_query_output: platformOutput } : {}),
	};
	options.beforeFinalVerification?.();
	verifyStableInputs(inputHashes);
	return {
		taskId: options.taskId,
		taskName: nonEmpty(task.taskName),
		taskCategory: String(task.taskCategory),
		taskPath,
		task,
		target,
		sql: combined.sql,
		sqlSources: combined.sources,
		sqlSegments: combined.segments,
		dialect,
		logicalSourceId,
		schemaBundle: bundle,
		schemaBundleHash: bundleHash,
		profileTask,
		provenance,
		inputHashes,
	};
}

function frozenSqlPath(outputRoot: string, prepared: PreparedInputPackTask): string {
	const directory = join(outputRoot, "input-pack-sources", prepared.taskId);
	mkdirSync(directory, { recursive: true });
	const path = join(directory, `${prepared.sql.slot}-${prepared.sql.sha256}.sql`);
	if (existsSync(path)) {
		if (sha256File(path) !== prepared.sql.sha256) throw new Error(`INPUT_PACK_SOURCE_HASH_COLLISION:${path}`);
	} else writeFileSync(path, prepared.sql.content, "utf8");
	return path;
}

function freezeRawSqlSources(outputRoot: string, prepared: PreparedInputPackTask): void {
	const directory = join(outputRoot, "input-pack-sources", prepared.taskId);
	mkdirSync(directory, { recursive: true });
	for (const source of prepared.sqlSources) {
		const path = join(directory, `${source.slot}-${source.sha256}.sql`);
		if (existsSync(path)) {
			if (sha256File(path) !== source.sha256) throw new Error(`INPUT_PACK_SOURCE_HASH_COLLISION:${path}`);
		} else writeFileSync(path, source.content, "utf8");
	}
}

export function runInputPackMachineFacts(options: RunInputPackMachineFactsOptions): InputPackMachineFactsRunResult {
	if (options.taskIds.length === 0) throw new Error("TASK_ID_REQUIRED");
	const outputRoot = resolve(options.outputRoot);
	mkdirSync(outputRoot, { recursive: true });
	const catalog = options.tableCatalog ?? loadPhysicalTableCatalog(options.dataRoot, { lazyDdl: true });
	const taskPathIndex = options.taskPathIndex ?? indexTaskInputPacks(options.dataRoot);
	const ddlCache = new Map<string, string>();
	const tasks: TaskRunResult[] = [];
	const preparedByTaskId = new Map<string, {
		taskCategory: string;
		taskContentHash: string;
	}>();
	const preparedSummary: InputPackMachineFactsRunResult["prepared"][number][] = [];
	const writerCatalogEnabled = options.noWriterCatalog !== true && options.writerCatalogPath !== null;
	const writerCatalogPath = writerCatalogEnabled
		? resolve(options.writerCatalogPath ?? defaultWriterCatalogPath(options.dataRoot))
		: null;
	for (const taskId of [...new Set(options.taskIds)].sort(compareText)) {
		const taskPaths = taskPathIndex.get(taskId) ?? [];
		try {
			if (taskPaths.length === 0) throw new Error(`TASK_INPUT_PACK_MISSING:${taskId}`);
			if (taskPaths.length !== 1) throw new Error(`TASK_INPUT_PACK_AMBIGUOUS:${taskId}`);
			const prepared = prepareInputPackTask({
				dataRoot: options.dataRoot,
				taskId,
				taskPath: taskPaths[0],
				tableCatalog: catalog,
				ddlCache,
				beforeFinalVerification: options.beforeFinalVerification ? () => options.beforeFinalVerification!(taskId) : undefined,
			});
			freezeRawSqlSources(outputRoot, prepared);
			const frozenPath = frozenSqlPath(outputRoot, prepared);
			const profileTask: GenericTaskProfile = { ...prepared.profileTask, sql_snapshot: frozenPath };
			const profile: GenericAnalysisProfile = {
				schema_version: "input-pack-machine-facts-v1",
				dialect: prepared.dialect,
				logical_source_id: prepared.logicalSourceId,
				tasks: [profileTask],
			};
			tasks.push(runTask(profileTask, profile, prepared.logicalSourceId, outputRoot, prepared.schemaBundle, prepared.schemaBundleHash));
			preparedByTaskId.set(taskId, {
				taskCategory: prepared.taskCategory,
				taskContentHash: String(prepared.task.contentHash),
			});
			preparedSummary.push({
				taskId,
				sqlSlot: prepared.sql.slot,
				target: prepared.target.qualifiedName,
				taskContentHash: String(prepared.task.contentHash),
				tableContentHash: prepared.target.tableContentHash,
			});
		} catch (error) {
			tasks.push({
				task_id: taskId,
				state: "FAILED",
				status: "FAILED",
				failures: [{
					outcome_class: "FAILURE",
					reason_code: "INPUT_PACK_PREPARATION_FAILED",
					message: error instanceof Error ? error.message : String(error),
				}],
			});
		}
	}
	if (writerCatalogPath) {
		const catalogHandle = openWriterCatalog(writerCatalogPath);
		for (const task of tasks) {
			const prepared = preparedByTaskId.get(task.task_id);
			syncWriterCatalogAfterMachineFacts({
				handle: catalogHandle,
				factsRoot: outputRoot,
				taskId: task.task_id,
				taskCategory: prepared?.taskCategory ?? "",
				taskContentHash: prepared?.taskContentHash ?? "",
				taskResult: task,
			});
		}
	}
	const indexMode = options.indexMode ?? "full";
	const indexStarted = performance.now();
	const index = indexMode === "incremental"
		? updateIndexIncrementally(outputRoot, { taskResults: tasks })
		: rebuildIndex(outputRoot);
	return {
		output_root: outputRoot,
		tasks,
		index,
		timings: { index_ms: performance.now() - indexStarted, index_mode: indexMode },
		prepared: preparedSummary,
	};
}

function option(args: readonly string[], name: string): string | undefined {
	const index = args.indexOf(name);
	return index >= 0 ? args[index + 1] : undefined;
}

function parseCli(args: readonly string[]): RunInputPackMachineFactsOptions {
	const dataRoot = option(args, "--data-root");
	const outputRoot = option(args, "--output");
	const taskIds = args
		.flatMap((value, index) => (value === "--task-id" && args[index + 1] ? args[index + 1]!.split(",") : []))
		.map((value) => value.trim())
		.filter(Boolean);
	if (!dataRoot || !outputRoot || taskIds.length === 0)
		throw new Error("usage: input-pack-machine-facts --data-root <path> --task-id <id[,id]> --output <path> [--writer-catalog <sqlite>] [--no-writer-catalog]");
	return {
		dataRoot,
		outputRoot,
		taskIds,
		...(option(args, "--writer-catalog") === undefined
			? {}
			: { writerCatalogPath: resolve(option(args, "--writer-catalog")!) }),
		...(args.includes("--no-writer-catalog") ? { noWriterCatalog: true } : {}),
	};
}

if (process.argv[1] && basename(process.argv[1]).startsWith("input-pack-machine-facts")) {
	const result = runInputPackMachineFacts(parseCli(process.argv.slice(2)));
	process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
