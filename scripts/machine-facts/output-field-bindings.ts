import {
	datasetId,
	fieldId,
	normalizeName,
	type FieldExpressionRecord,
	type OutputFieldBindingRecord,
	isPlatformTargetQueryOutputKind,
	type OutputEvidenceKind,
	type SchemaReferenceRecord,
	type StatementRecord,
	type UnknownOutcomeRecord,
} from "./machine-facts-contract.ts";

type Token = {
	readonly kind: "word" | "symbol" | "string";
	readonly value: string;
};

type ParsedInsert = {
	readonly target: string;
	readonly targetColumns: readonly string[];
	readonly staticPartitionColumns: readonly string[];
	readonly dynamicPartitionColumns: readonly string[];
};

type ParsedCreate = {
	readonly statementId: string;
	readonly target: string;
	readonly columns: readonly string[];
	readonly partitionColumns: readonly string[];
	readonly hasAsQuery: boolean;
};

export interface WriteOutputContext {
	readonly writeObservationId: string;
	readonly statementId: string;
	readonly statementType: string;
	readonly writeKind: string;
	readonly rawSql: string;
	readonly target: string;
	readonly queryProducerStatementId: string | null;
	readonly queryBoundaryProven: boolean;
	readonly producerEnumerationStatus: "COMPLETE" | "NOT_EVALUABLE" | "NOT_APPLICABLE";
	readonly expressions: readonly FieldExpressionRecord[];
	readonly evidenceKind?: OutputEvidenceKind;
	readonly sourceSqlSha256?: string;
	readonly partitionStatus?: "NOT_PARTITIONED" | "COMPLETE" | "INCOMPLETE" | "UNKNOWN" | "CONFLICT";
	readonly partitionColumns?: readonly string[];
	readonly evidenceRefs?: readonly string[];
}

export interface OutputBindingResult {
	readonly bindings: readonly OutputFieldBindingRecord[];
	readonly unknowns: readonly UnknownOutcomeRecord[];
}

export interface OutputBindingInput {
	readonly taskId: string;
	readonly logicalSourceId: string;
	readonly statements: readonly StatementRecord[];
	readonly writes: readonly WriteOutputContext[];
	readonly schemaRefs: readonly SchemaReferenceRecord[];
	readonly declaredWrites: readonly string[];
}

function tokensOf(sql: string): Token[] {
	const tokens: Token[] = [];
	let index = 0;
	while (index < sql.length) {
		const char = sql[index]!;
		const next = sql[index + 1];
		if (/\s/.test(char)) {
			index += 1;
			continue;
		}
		if (char === "-" && next === "-") {
			index += 2;
			while (index < sql.length && sql[index] !== "\n") index += 1;
			continue;
		}
		if (char === "/" && next === "*") {
			index += 2;
			while (index < sql.length && !(sql[index] === "*" && sql[index + 1] === "/")) index += 1;
			index = Math.min(sql.length, index + 2);
			continue;
		}
		if (char === "'") {
			let value = "";
			index += 1;
			while (index < sql.length) {
				if (sql[index] === "'" && sql[index + 1] === "'") {
					value += "'";
					index += 2;
					continue;
				}
				if (sql[index] === "'") {
					index += 1;
					break;
				}
				value += sql[index];
				index += 1;
			}
			tokens.push({ kind: "string", value });
			continue;
		}
		if (char === "`" || char === '"' || char === "[") {
			const close = char === "[" ? "]" : char;
			let value = "";
			index += 1;
			while (index < sql.length) {
				if (sql[index] === close && sql[index + 1] === close && close !== "]") {
					value += close;
					index += 2;
					continue;
				}
				if (sql[index] === close) {
					index += 1;
					break;
				}
				value += sql[index];
				index += 1;
			}
			tokens.push({ kind: "word", value });
			continue;
		}
		if (/[A-Za-z0-9_$-]/.test(char)) {
			let value = char;
			index += 1;
			while (index < sql.length && /[A-Za-z0-9_$-]/.test(sql[index]!)) {
				value += sql[index];
				index += 1;
			}
			tokens.push({ kind: "word", value });
			continue;
		}
		if ("().,=".includes(char)) tokens.push({ kind: "symbol", value: char });
		index += 1;
	}
	return tokens;
}

function word(token: Token | undefined, value: string): boolean {
	return token?.kind === "word" && token.value.toLowerCase() === value.toLowerCase();
}

function identifierAt(tokens: readonly Token[], start: number): { value: string; next: number } | null {
	if (tokens[start]?.kind !== "word") return null;
	const parts = [tokens[start]!.value];
	let index = start + 1;
	while (tokens[index]?.value === "." && tokens[index + 1]?.kind === "word") {
		parts.push(tokens[index + 1]!.value);
		index += 2;
	}
	return { value: normalizeName(parts.join(".")), next: index };
}

function parenthesizedSegments(tokens: readonly Token[], openIndex: number): { segments: Token[][]; next: number } | null {
	if (tokens[openIndex]?.value !== "(") return null;
	const segments: Token[][] = [[]];
	let depth = 1;
	for (let index = openIndex + 1; index < tokens.length; index += 1) {
		const token = tokens[index]!;
		if (token.value === "(") depth += 1;
		if (token.value === ")") {
			depth -= 1;
			if (depth === 0) return { segments: segments.filter((segment) => segment.length > 0), next: index + 1 };
		}
		if (token.value === "," && depth === 1) segments.push([]);
		else segments[segments.length - 1]!.push(token);
	}
	return null;
}

function columnNames(segments: readonly Token[][]): string[] {
	const constraints = new Set(["constraint", "primary", "unique", "foreign", "check"]);
	return segments.flatMap((segment) => {
		const first = segment.find((token) => token.kind === "word");
		if (!first || constraints.has(first.value.toLowerCase())) return [];
		return [normalizeName(first.value)];
	});
}

function parseInsert(sql: string): ParsedInsert | null {
	const tokens = tokensOf(sql);
	let index = tokens.findIndex((token) => word(token, "insert"));
	if (index < 0) return null;
	index += 1;
	if (word(tokens[index], "overwrite") || word(tokens[index], "into")) index += 1;
	if (word(tokens[index], "table")) index += 1;
	const target = identifierAt(tokens, index);
	if (!target) return null;
	index = target.next;

	let targetColumns: string[] = [];
	if (tokens[index]?.value === "(") {
		const list = parenthesizedSegments(tokens, index);
		if (!list) return null;
		targetColumns = columnNames(list.segments);
		index = list.next;
	}

	const staticPartitionColumns: string[] = [];
	const dynamicPartitionColumns: string[] = [];
	for (; index < tokens.length && !word(tokens[index], "select"); index += 1) {
		if (!word(tokens[index], "partition") || tokens[index + 1]?.value !== "(") continue;
		const list = parenthesizedSegments(tokens, index + 1);
		if (!list) return null;
		for (const segment of list.segments) {
			const name = columnNames([segment])[0];
			if (!name) continue;
			if (segment.some((token) => token.value === "=")) staticPartitionColumns.push(name);
			else dynamicPartitionColumns.push(name);
		}
		index = list.next - 1;
	}
	return { target: target.value, targetColumns, staticPartitionColumns, dynamicPartitionColumns };
}

function parseCreate(statement: StatementRecord): ParsedCreate | null {
	if (statement.statement_type !== "CREATE_TABLE") return null;
	const tokens = tokensOf(statement.raw_sql);
	let index = tokens.findIndex((token) => word(token, "create"));
	if (index < 0) return null;
	index += 1;
	if (word(tokens[index], "or") && word(tokens[index + 1], "replace")) index += 2;
	if (!word(tokens[index], "table")) return null;
	index += 1;
	if (word(tokens[index], "if") && word(tokens[index + 1], "not") && word(tokens[index + 2], "exists")) index += 3;
	const target = identifierAt(tokens, index);
	if (!target) return null;
	let cursor = target.next;
	let columns: string[] = [];
	if (tokens[cursor]?.value === "(") {
		const list = parenthesizedSegments(tokens, cursor);
		if (!list) return null;
		columns = columnNames(list.segments);
		cursor = list.next;
	}
	const partitionColumns: string[] = [];
	for (let index = cursor; index < tokens.length - 2; index += 1) {
		if (!word(tokens[index], "partitioned") || !word(tokens[index + 1], "by") || tokens[index + 2]?.value !== "(") continue;
		const partitions = parenthesizedSegments(tokens, index + 2);
		if (partitions) partitionColumns.push(...columnNames(partitions.segments));
		break;
	}
	const hasAsQuery = tokens.some((token, index) => word(token, "as") && (word(tokens[index + 1], "select") || word(tokens[index + 1], "with")));
	return { statementId: statement.statement_id, target: target.value, columns, partitionColumns, hasAsQuery };
}

function tableTail(value: string): string {
	return normalizeName(value).split(".").at(-1) ?? normalizeName(value);
}

function targetMatches(candidate: string, target: string): boolean {
	const left = normalizeName(candidate);
	const right = normalizeName(target);
	return left === right || tableTail(left) === tableTail(right);
}

function schemaForTarget(
	target: string,
	schemaRefs: readonly SchemaReferenceRecord[],
	declaredWrites: readonly string[],
): SchemaReferenceRecord | null {
	const usable = schemaRefs.filter((record) => record.status === "SUCCESS" && record.qualified_name);
	const exact = usable.filter((record) => normalizeName(record.qualified_name!) === normalizeName(target));
	if (exact.length === 1) return exact[0]!;
	const byTail = usable.filter((record) => tableTail(record.qualified_name!) === tableTail(target));
	if (byTail.length === 1) return byTail[0]!;
	const declared = declaredWrites.filter((write) => targetMatches(write, target));
	if (declared.length === 1) {
		const selected = usable.filter((record) => normalizeName(record.qualified_name!) === normalizeName(declared[0]!));
		if (selected.length === 1) return selected[0]!;
	}
	return null;
}

function resolvedDataset(target: string, schemaRef: SchemaReferenceRecord | null, declaredWrites: readonly string[]): string {
	if (schemaRef?.qualified_name) return normalizeName(schemaRef.qualified_name);
	const declared = declaredWrites.filter((write) => targetMatches(write, target));
	return declared.length === 1 ? normalizeName(declared[0]!) : normalizeName(target);
}

function nonPartitionColumns(schemaRef: SchemaReferenceRecord | null): string[] {
	if (!schemaRef) return [];
	const partitions = new Set(schemaRef.partition_columns.map(normalizeName));
	return schemaRef.physical_columns
		.map((column) => normalizeName(String(column)))
		.filter((column) => column && !partitions.has(column));
}

function sameColumns(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((column, index) => normalizeName(column) === normalizeName(right[index] ?? ""));
}

function prefixColumns(prefix: readonly string[], full: readonly string[]): boolean {
	return prefix.length < full.length && prefix.every((column, index) => normalizeName(column) === normalizeName(full[index] ?? ""));
}

function gap(
	input: OutputBindingInput,
	write: WriteOutputContext,
	outcome: "UNKNOWN" | "NOT_EVALUABLE",
	reason: string,
	message: string,
	subject: string,
	extra: Record<string, unknown> = {},
): UnknownOutcomeRecord {
	return {
		unknown_id: `unknown:output-binding:${input.taskId}:${write.statementId}:${reason.toLowerCase()}`,
		task_id: input.taskId,
		write_observation_id: write.writeObservationId,
		write_kind: write.writeKind,
		write_statement_id: write.statementId,
		query_producer_statement_id: write.queryProducerStatementId,
		statement_id: write.statementId,
		outcome_class: outcome,
		reason_code: reason,
		gap_domain: "OUTPUT_BINDING",
		message,
		subject,
		...extra,
	};
}

export function deriveOutputFieldBindings(input: OutputBindingInput): OutputBindingResult {
	const creates = input.statements.map(parseCreate).filter((item): item is ParsedCreate => item !== null);
	const bindings: OutputFieldBindingRecord[] = [];
	const unknowns: UnknownOutcomeRecord[] = [];

	for (const write of input.writes) {
		const isInsert = write.statementType === "INSERT_OVERWRITE" || write.statementType === "INSERT_INTO";
		const isCtas = write.writeKind === "CTAS";
		const isPlatformTarget = isPlatformTargetQueryOutputKind(write.evidenceKind);
		if (!isInsert && !isCtas && !isPlatformTarget) continue;
		const parsedInsert = isInsert ? parseInsert(write.rawSql) : null;
		const create = creates.find((candidate) => candidate.statementId === write.statementId) ?? null;
		let expressions = [...write.expressions].sort((left, right) => left.ordinal - right.ordinal);
		let provenDynamicColumns: string[] = [];
		const uncovered = expressions.map((expression) => expression.ordinal);
		if (write.producerEnumerationStatus === "NOT_EVALUABLE" && expressions.length === 0) {
			unknowns.push(gap(input, write, "NOT_EVALUABLE", "PRODUCER_OUTPUT_ENUMERATION_NOT_EVALUABLE", "field-producing Write has no enumerable producer output ordinals", write.target, { uncovered_ordinals: [] }));
			continue;
		}
		if (isCtas && (!write.queryBoundaryProven || !create?.hasAsQuery)) {
			unknowns.push(gap(input, write, "NOT_EVALUABLE", "PRODUCER_OUTPUT_ENUMERATION_NOT_EVALUABLE", "CTAS query producer boundary is not proven", write.target, { uncovered_ordinals: uncovered }));
			continue;
		}
		if (isPlatformTarget && !write.queryBoundaryProven) {
			unknowns.push(gap(input, write, "NOT_EVALUABLE", "PLATFORM_TARGET_QUERY_BOUNDARY_NOT_PROVABLE", "platform target requires exactly one enumerable query producer", write.target, { uncovered_ordinals: uncovered }));
			continue;
		}
		// The Write context carries the physical identity resolved from the task
		// target/Table Pack. Do not replace it with parseInsert's lexical target:
		// a bare INSERT target may have a task-local CREATE schema with the same
		// tail but incomplete columns, while the physical Table Pack is complete.
		const target = write.target;
		const schemaRef = schemaForTarget(target, input.schemaRefs, input.declaredWrites);
		const dataset = resolvedDataset(target, schemaRef, input.declaredWrites);
		if (
			isPlatformTarget &&
			write.partitionStatus !== "NOT_PARTITIONED" &&
			write.partitionStatus !== "COMPLETE"
		) {
			unknowns.push(gap(input, write, "NOT_EVALUABLE", "PLATFORM_TARGET_PARTITION_NOT_PROVABLE", `platform target partition handling is ${write.partitionStatus ?? "UNKNOWN"}`, write.target, { uncovered_ordinals: uncovered }));
			continue;
		}
		if (isInsert && !parsedInsert) {
			unknowns.push(gap(input, write, "NOT_EVALUABLE", "OUTPUT_BINDING_NOT_PROVABLE", "INSERT target could not be parsed", write.target, { uncovered_ordinals: uncovered }));
			continue;
		}
		if (isInsert && parsedInsert!.dynamicPartitionColumns.length > 0) {
			const dynamicColumns = parsedInsert!.dynamicPartitionColumns.map(normalizeName);
			const provenColumns = (write.partitionColumns ?? []).map(normalizeName);
			const partitionProven =
				write.partitionStatus === "COMPLETE" &&
				dynamicColumns.length === provenColumns.length &&
				dynamicColumns.every((column, index) => column === provenColumns[index]);
			if (!partitionProven || expressions.length <= dynamicColumns.length) {
				unknowns.push(gap(
					input,
					write,
					"NOT_EVALUABLE",
					"DYNAMIC_PARTITION_BINDING_NOT_PROVABLE",
					`dynamic partition columns require complete Input Pack ordinal evidence: ${dynamicColumns.join(", ")}`,
					parsedInsert!.target,
					{ uncovered_ordinals: uncovered, input_pack_partition_status: write.partitionStatus ?? "UNKNOWN" },
				));
				continue;
			}
			provenDynamicColumns = dynamicColumns;
		}
		if (expressions.length === 0 || expressions.some((expression, ordinal) => expression.ordinal !== ordinal)) {
			const reason = write.producerEnumerationStatus === "NOT_EVALUABLE" ? "PRODUCER_OUTPUT_ENUMERATION_NOT_EVALUABLE" : isCtas ? "PRODUCER_OUTPUT_ENUMERATION_NOT_EVALUABLE" : "OUTPUT_BINDING_NOT_PROVABLE";
			unknowns.push(gap(input, write, "NOT_EVALUABLE", reason, "root output expressions are missing or not contiguous", write.target, { uncovered_ordinals: uncovered }));
			continue;
		}

		const physicalColumns = nonPartitionColumns(schemaRef);
		if (isPlatformTarget && !schemaRef) {
			unknowns.push(gap(input, write, "NOT_EVALUABLE", "PLATFORM_TARGET_SCHEMA_NOT_PROVABLE", "platform target query output requires target Table Pack Schema evidence", dataset, { uncovered_ordinals: uncovered }));
			continue;
		}
		const createCandidates = creates.filter((candidate) => targetMatches(candidate.target, target));
		const targetCreate = createCandidates.length === 1 ? createCandidates[0]! : create;
		let targetColumns: string[];
		let targetOrdinals: number[];
		let bindingMethod: OutputFieldBindingRecord["binding_method"];
		let evidenceRefs: string[] = [write.statementId, ...(write.evidenceRefs ?? [])];

		const explicitTargetColumns = parsedInsert?.targetColumns ?? [];
		if (explicitTargetColumns.length > 0) {
			targetColumns = [...explicitTargetColumns];
			targetOrdinals = targetColumns.map((_, ordinal) => ordinal);
			bindingMethod = "EXPLICIT_TARGET_COLUMN_LIST";
		} else if (targetCreate && targetCreate.columns.length === expressions.length) {
			targetColumns = [...targetCreate.columns];
			targetOrdinals = targetColumns.map((_, ordinal) => ordinal);
			bindingMethod = "SQL_CREATE_POSITIONAL";
			evidenceRefs.push(targetCreate.statementId);
		} else if (physicalColumns.length + provenDynamicColumns.length === expressions.length) {
			targetColumns = [...physicalColumns, ...provenDynamicColumns];
			const fullSchemaColumns = (schemaRef?.physical_columns ?? []).map((column) => normalizeName(String(column)));
			targetOrdinals = targetColumns.map((column, ordinal) => {
				const schemaOrdinal = fullSchemaColumns.indexOf(normalizeName(column));
				return schemaOrdinal >= 0 ? schemaOrdinal : ordinal;
			});
			bindingMethod = "TARGET_SCHEMA_POSITIONAL";
		} else if (
			isPlatformTarget &&
			schemaRef &&
			schemaRef.physical_columns.length === expressions.length
		) {
			targetColumns = schemaRef.physical_columns.map((column) => normalizeName(String(column)));
			targetOrdinals = targetColumns.map((column, ordinal) => {
				const schemaOrdinal = schemaRef.physical_columns.findIndex(
					(candidate) => normalizeName(String(candidate)) === column,
				);
				return schemaOrdinal >= 0 ? schemaOrdinal : ordinal;
			});
			bindingMethod = "TARGET_SCHEMA_POSITIONAL";
		} else {
			unknowns.push(gap(
				input,
				write,
				"NOT_EVALUABLE",
				isCtas ? "CTAS_OUTPUT_BINDING_NOT_PROVABLE" : "OUTPUT_BINDING_NOT_PROVABLE",
				`${isCtas ? "CTAS" : "SELECT"} output count ${expressions.length} does not match a provable target column count`,
				dataset,
				{ uncovered_ordinals: uncovered, select_output_count: expressions.length, sql_create_column_count: targetCreate?.columns.length ?? null, physical_target_column_count: physicalColumns.length || null },
			));
			continue;
		}
		if (targetColumns.length !== expressions.length) {
			unknowns.push(gap(input, write, "NOT_EVALUABLE", isCtas ? "CTAS_OUTPUT_BINDING_NOT_PROVABLE" : "OUTPUT_BINDING_NOT_PROVABLE", `target column count ${targetColumns.length} does not match SELECT output count ${expressions.length}`, dataset, { uncovered_ordinals: uncovered }));
			continue;
		}
		if (schemaRef) evidenceRefs.push(schemaRef.schema_ref_id);

		let targetSchemaStatus: OutputFieldBindingRecord["target_schema_status"] = schemaRef ? "MATCH" : "NOT_AVAILABLE";
		if (bindingMethod === "EXPLICIT_TARGET_COLUMN_LIST") {
			const referenceColumns = physicalColumns.length > 0 ? physicalColumns : targetCreate?.columns ?? [];
			if (referenceColumns.length > 0) {
				const indexes = targetColumns.map((column) => referenceColumns.findIndex((candidate) => normalizeName(candidate) === normalizeName(column)));
				const uniqueIndexes = new Set(indexes);
				if (indexes.some((ordinal) => ordinal < 0) || uniqueIndexes.size !== indexes.length) {
					unknowns.push(gap(input, write, "NOT_EVALUABLE", "OUTPUT_BINDING_SCHEMA_CONFLICT", "an explicit target column is missing or duplicated in the available target schema", dataset, { uncovered_ordinals: uncovered }));
					continue;
				}
				targetOrdinals = indexes;
				if (!schemaRef && targetCreate) {
					evidenceRefs.push(targetCreate.statementId);
					targetSchemaStatus = "MATCH";
				}
			}
		} else if (
			schemaRef &&
			provenDynamicColumns.length === 0 &&
			bindingMethod !== "TARGET_SCHEMA_POSITIONAL" &&
			!sameColumns(targetColumns, physicalColumns)
		) {
			if (prefixColumns(targetColumns, physicalColumns)) {
				targetSchemaStatus = "DRIFT_EXTRA_TARGET_COLUMNS";
				const extras = physicalColumns.slice(targetColumns.length);
				unknowns.push(gap(
					input,
					write,
					"UNKNOWN",
					"TARGET_SCHEMA_DRIFT",
					`physical target has ${extras.length} trailing column(s) not produced by this INSERT`,
					dataset,
					{ unbound_target_fields: extras.map((column) => fieldId(input.logicalSourceId, dataset, column)) },
				));
			} else {
				unknowns.push(gap(input, write, "NOT_EVALUABLE", "OUTPUT_BINDING_SCHEMA_CONFLICT", "task-local or explicit target columns conflict with the current physical target schema", dataset, { uncovered_ordinals: uncovered }));
				continue;
			}
		}

		for (const [ordinal, expression] of expressions.entries()) {
			const targetField = normalizeName(targetColumns[ordinal]!);
			bindings.push({
				binding_id: `output-binding:${input.taskId}:${write.statementId}:${ordinal}`,
				task_id: input.taskId,
				write_observation_id: write.writeObservationId,
				write_kind: write.writeKind,
				write_statement_id: write.statementId,
				query_producer_statement_id: write.queryProducerStatementId,
				statement_id: write.statementId,
				expression_id: expression.expression_id,
				target_dataset_id: datasetId(input.logicalSourceId, dataset),
				target_field_id: fieldId(input.logicalSourceId, dataset, targetField),
				target_dataset: dataset,
				target_field: targetField,
				source_ordinal: ordinal,
				target_ordinal: targetOrdinals[ordinal]!,
				binding_method: bindingMethod,
				binding_status: "RESOLVED",
				target_schema_status: targetSchemaStatus,
				static_partition_columns: [
					...(parsedInsert?.staticPartitionColumns ?? []),
					...(parsedInsert?.dynamicPartitionColumns ?? []),
					...(!parsedInsert ? (write.partitionColumns ?? []) : []),
				],
				evidence_refs: [...new Set(evidenceRefs)].sort(),
				evidence_kind: isPlatformTarget ? write.evidenceKind : "SQL_EXPLICIT_WRITE",
				...(isPlatformTarget && write.sourceSqlSha256
					? { source_sql_sha256: write.sourceSqlSha256 }
					: {}),
			});
		}
	}

	return { bindings, unknowns };
}
