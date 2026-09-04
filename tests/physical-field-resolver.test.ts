import { describe, expect, it } from "vitest";

import {
  type PhysicalTableCatalog,
  type PhysicalTableCatalogEntry,
} from "../scripts/machine-facts/input-pack-machine-facts.ts";
import { resolvePhysicalInputField } from "../scripts/reconcile/consumer/field-lineage/physical-field-resolver.ts";

function table(
  qualifiedName: string,
  columns: readonly string[],
): PhysicalTableCatalogEntry {
  return {
    platform: "horae",
    dataSource: "kxc_hive_pro",
    stableTableId: `${qualifiedName}__warehouse`,
    qualifiedName,
    guid: null,
    partitionFields: null,
    columns,
    tablePath: `${qualifiedName}.json`,
    ddlPath: `${qualifiedName}.sql`,
    tableContentHash: "table-hash",
    ddlSha256: "ddl-hash",
  };
}

function catalog(
  entries: readonly PhysicalTableCatalogEntry[],
): PhysicalTableCatalog {
  const byQualifiedName = new Map<
    string,
    readonly PhysicalTableCatalogEntry[]
  >();
  const byNameTail = new Map<
    string,
    readonly PhysicalTableCatalogEntry[]
  >();
  for (const entry of entries) {
    byQualifiedName.set(entry.qualifiedName, [
      ...(byQualifiedName.get(entry.qualifiedName) ?? []),
      entry,
    ]);
    const tail = entry.qualifiedName.split(".").at(-1)!;
    byNameTail.set(tail, [...(byNameTail.get(tail) ?? []), entry]);
  }
  return {
    entries,
    issues: [],
    byPhysicalKey: new Map(),
    byQualifiedName,
    byNameTail,
  };
}

const fallbackTable = table("pdata_n.target", ["out_col"]);

describe("physical field resolver", () => {
  it("uses the Task default Hive database before considering same-name tables", () => {
    const result = resolvePhysicalInputField(
      {
        catalog: catalog([
          table("pdata_n.t03_agt_rela_h", ["rela_agt_id"]),
          table("archive.t03_agt_rela_h", ["rela_agt_id"]),
        ]),
        taskId: "105388",
        defaultSchema: {
          schema: "pdata_n",
          evidenceSources: ["TASK_NAME"],
        },
        fallbackTable,
        schemaRefs: [],
      },
      { table: "t03_agt_rela_h", column: "rela_agt_id" },
    );

    expect(result).toMatchObject({
      status: "RESOLVED",
      field: {
        qualifiedName: "pdata_n.t03_agt_rela_h",
        column: "rela_agt_id",
      },
    });
  });

  it("keeps an unqualified same-name table ambiguous without default-schema evidence", () => {
    const result = resolvePhysicalInputField(
      {
        catalog: catalog([
          table("pdata_n.mid", ["id"]),
          table("archive.mid", ["id"]),
        ]),
        taskId: "100",
        defaultSchema: null,
        fallbackTable,
        schemaRefs: [],
      },
      { table: "mid", column: "id" },
    );

    expect(result).toMatchObject({
      status: "UNRESOLVED",
      reason: "TABLE_IDENTITY_AMBIGUOUS",
    });
  });

  it("distinguishes missing table evidence from a field missing in known schema", () => {
    const knownCatalog = catalog([table("pdata_n.mid", ["id"])]);
    const context = {
      catalog: knownCatalog,
      taskId: "100",
      defaultSchema: null,
      fallbackTable,
      schemaRefs: [],
    } as const;

    expect(
      resolvePhysicalInputField(context, { table: "missing", column: "id" }),
    ).toMatchObject({ status: "UNRESOLVED", reason: "TABLE_PACK_MISSING" });
    expect(
      resolvePhysicalInputField(context, {
        table: "pdata_n.mid",
        column: "missing_col",
      }),
    ).toMatchObject({ status: "UNRESOLVED", reason: "FIELD_NOT_IN_SCHEMA" });
  });

  it("resolves a task-local CTAS only from unique schema-backed task evidence", () => {
    const result = resolvePhysicalInputField(
      {
        catalog: catalog([]),
        taskId: "100",
        defaultSchema: {
          schema: "pdata_n",
          evidenceSources: ["TASK_NAME"],
        },
        fallbackTable,
        schemaRefs: [
          {
            qualified_name: "pdata_n.stage_mid",
            physical_columns: ["id", "amount"],
            source: "input-pack-task-local-ctas:100:statement-1",
          },
        ],
      },
      { table: "stage_mid", column: "amount" },
    );

    expect(result).toMatchObject({
      status: "RESOLVED",
      field: {
        stableTableId: "task-local:100:pdata_n.stage_mid",
        qualifiedName: "pdata_n.stage_mid",
        column: "amount",
        identityStatus: "TASK_LOCAL_SCHEMA_BACKED",
      },
    });
  });

  it("does not collapse duplicate task-local schema evidence into a false identity", () => {
    const schemaRef = {
      qualified_name: "pdata_n.stage_mid",
      physical_columns: ["amount"],
      source: "input-pack-task-local-ctas:100:statement-1",
    };
    const result = resolvePhysicalInputField(
      {
        catalog: catalog([]),
        taskId: "100",
        defaultSchema: {
          schema: "pdata_n",
          evidenceSources: ["TASK_NAME"],
        },
        fallbackTable,
        schemaRefs: [schemaRef, { ...schemaRef }],
      },
      { table: "stage_mid", column: "amount" },
    );

    expect(result).toMatchObject({
      status: "UNRESOLVED",
      reason: "TABLE_IDENTITY_AMBIGUOUS",
    });
  });
});
