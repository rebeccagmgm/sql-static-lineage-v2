import { describe, expect, it } from "vitest";

import {
  canonicalRelationIdentity,
  planSlotSqlSourceId,
  sameRelationIdentity,
} from "../../scripts/machine-facts/relation-identity.ts";

describe("relation identity (field-lineage occurrence rules)", () => {
  it("equates query# occurrence tokens with global machine-facts relation ids", () => {
    expect(
      sameRelationIdentity(
        "query#0:root.t.setop.b0.read.d_pos_position_daily",
        "task:106590:statement:0:relation:root.t.setop.b0.read.d_pos_position_daily",
      ),
    ).toBe(true);
    expect(
      canonicalRelationIdentity(
        "task:181058:statement:0:relation:root.casttable.evt.t.read.toe",
      ),
    ).toBe("root.casttable.evt.t.read.toe");
  });

  it("equates create# occurrence tokens the same way as query#", () => {
    expect(
      sameRelationIdentity(
        "create#1:root.a.read.d_trd_otc_trade",
        "task:105387:statement:1:relation:root.a.read.d_trd_otc_trade",
      ),
    ).toBe(true);
    expect(canonicalRelationIdentity("create#1:root.a.read.d_trd_otc_trade")).toBe(
      "root.a.read.d_trd_otc_trade",
    );
  });

  it("ignores the synthetic (child) frame the plan adapter inserts for CTE bodies", () => {
    expect(
      sameRelationIdentity(
        "query#0:root.t.setop.b0.read.d_pos_position_daily",
        "task:106590:statement:0:relation:root.(child).t.setop.b0.read.d_pos_position_daily",
      ),
    ).toBe(true);
    expect(
      canonicalRelationIdentity("root.(child-2).t.setop.b1.a.read.d_pos_position_daily"),
    ).toBe("root.t.setop.b1.a.read.d_pos_position_daily");
  });

  it("keeps UNION branches distinct across the synthetic frame", () => {
    expect(
      sameRelationIdentity(
        "query#0:root.t.setop.b0.read.d_pos_position_daily",
        "task:106590:statement:0:relation:root.(child).t.setop.b1.read.d_pos_position_daily",
      ),
    ).toBe(false);
  });

  it("keeps UNION branches distinct", () => {
    expect(
      sameRelationIdentity(
        "root.t.setop.b0.read.d_mkt_ins_op_eod_metric",
        "root.t.setop.b1.a.read.d_mkt_ins_op_eod_metric",
      ),
    ).toBe(false);
  });

  it("does not treat query# tokens as SQL slot ids", () => {
    expect(planSlotSqlSourceId("query#0:root.t.setop.b0.read.x")).toBeNull();
    expect(planSlotSqlSourceId("query#0")).toBeNull();
    expect(planSlotSqlSourceId("task:106590:slot:query:statement:0")).toBe(
      "task:106590:slot:query",
    );
  });
});
