import { describe, expect, it } from "vitest";

import { extractSqlReadTableNames } from "../scripts/input/shared/sql-table-references.ts";

describe("SQL Input Pack table discovery", () => {
  it("discovers physical source tables instead of treating a datasource label as a table", () => {
    expect(
      extractSqlReadTableNames(`
        SELECT ENTITY_ID
        FROM TITANS_DM.ADM_AUDIT_LOG
        WHERE ENTITY_TYPE = 'FROM fake.example'
        -- JOIN commented.example
      `),
    ).toEqual(["TITANS_DM.ADM_AUDIT_LOG"]);
  });

  it("does not request CTE names as physical tables", () => {
    expect(
      extractSqlReadTableNames(
        "WITH source_rows AS (SELECT id FROM raw.source_table) SELECT id FROM source_rows JOIN raw.other_table ON source_rows.id = raw.other_table.id",
      ),
    ).toEqual(["raw.other_table", "raw.source_table"]);
  });
});
