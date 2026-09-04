import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	loadSchemaFromTablesRoot,
	parseDdlSchema,
} from "../scripts/plans/ddl-schema.ts";
import { writeTableInput, type TableEvidence } from "../scripts/input/shared/input-pack.ts";

describe("DDL schema reader", () => {
	it("reads Hive columns and appends partition columns", () => {
		const result = parseDdlSchema(
			"create table demo.orders (id bigint, amount decimal(18,2), note string comment 'a,b') partitioned by (busi_date string comment '业务日期') stored as orc",
		);

		expect(result.columns.map((column) => column.name)).toEqual(["id", "amount", "note", "busi_date"]);
		expect(result.partition_columns).toEqual(["busi_date"]);
		expect(result.warnings).toEqual([]);
	});

	it("ignores table constraints and indexes", () => {
		const result = parseDdlSchema(
			'CREATE TABLE "DEMO"."ORDERS" ("ID" NUMBER(10,0), "NAME" VARCHAR2(50), PRIMARY KEY ("ID"), CONSTRAINT "UQ_NAME" UNIQUE ("NAME")); CREATE INDEX "IDX_NAME" ON "DEMO"."ORDERS" ("NAME")',
		);

		expect(result.columns.map((column) => column.name)).toEqual(["ID", "NAME"]);
		expect(result.partition_columns).toEqual([]);
	});

	it("keeps an explicit unknown result when there is no column list", () => {
		const result = parseDdlSchema("CREATE TABLE demo.orders LIKE demo.base");

		expect(result.columns).toEqual([]);
		expect(result.warnings).toContain("table column list not found");
	});

	it("derives output columns from a view defining SELECT", () => {
		const result = parseDdlSchema(`
			SELECT 'OPTION' DATA_TYPE,
			       OT.INTERNAL_TRADE_ID AS CONTRACT_CODE,
			       MAX(OD.INITIAL_NOTIONAL) INITIAL_NOTIONAL
		FROM REF_OTC_OPTION_DEAL OD
		UNION ALL
		SELECT MAX(DATA_TYPE), CONTRACT_CODE, MAX(INITIAL_NOTIONAL)
		FROM demo.trs
		`);

		expect(result.columns.map((column) => column.name)).toEqual([
			"DATA_TYPE",
			"CONTRACT_CODE",
			"INITIAL_NOTIONAL",
		]);
		expect(result.warnings).toEqual([]);
	});

	it("uses a unique qualified table as evidence for an unqualified reference", () => {
		const dataRoot = mkdtempSync(join(tmpdir(), "ddl-schema-"));
		try {
			const evidence: TableEvidence = {
				platform: "hive",
				dataSource: "gfhive",
				qualifiedName: "PDATA_N.T03_AGT_RELA_H",
				objectType: "TABLE",
				ddl: "CREATE TABLE PDATA_N.T03_AGT_RELA_H (agt_id string, src_tbl string)",
				evidenceProvider: "test",
			};
			writeTableInput(dataRoot, evidence);

			const result = loadSchemaFromTablesRoot(
				join(dataRoot, "tables"),
				["T03_AGT_RELA_H"],
			);

			expect(result.missing).toEqual([]);
			expect(result.issues).toEqual([]);
			expect(result.loaded.map((item) => item.qualified_name)).toEqual([
				"PDATA_N.T03_AGT_RELA_H",
			]);
			expect(result.schema.columnsFor(["T03_AGT_RELA_H"], "databricks")).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ name: "agt_id" }),
				]),
			);
		} finally {
			rmSync(dataRoot, { recursive: true, force: true });
		}
	});

	it("prefers the unique non-test schema over a test suffix candidate", () => {
		const dataRoot = mkdtempSync(join(tmpdir(), "ddl-schema-"));
		try {
			for (const [qualifiedName, column] of [
				["dm_otc_test.T98_OTC_DERI_COMP_SALE_INFO", "test_only"],
				["PDATA_N.T98_OTC_DERI_COMP_SALE_INFO", "production_field"],
			] as const) {
				writeTableInput(dataRoot, {
					platform: "hive",
					dataSource: "gfhive",
					qualifiedName,
					objectType: "TABLE",
					ddl: `CREATE TABLE ${qualifiedName} (${column} string)`,
					evidenceProvider: "test",
				});
			}

			const result = loadSchemaFromTablesRoot(
				join(dataRoot, "tables"),
				["T98_OTC_DERI_COMP_SALE_INFO"],
			);

			expect(result.missing).toEqual([]);
			expect(result.issues).toEqual([]);
			expect(result.loaded.map((item) => item.qualified_name)).toEqual([
				"PDATA_N.T98_OTC_DERI_COMP_SALE_INFO",
			]);
			expect(result.schema.columnsFor(["T98_OTC_DERI_COMP_SALE_INFO"], "databricks")).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ name: "production_field" }),
				]),
			);
		} finally {
			rmSync(dataRoot, { recursive: true, force: true });
		}
	});
});
