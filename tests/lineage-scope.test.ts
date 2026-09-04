import { describe, expect, it } from "vitest";

import {
  isCheckdbflagTask,
  isNoSqlTaskCategory,
  isNonHiveProducerBoundary,
  isOutOfScopePhysicalRead,
  isReferenceConfigTable,
  isSameTaskScratchProducerBridge,
  isSameTaskScratchTable,
  isTaskLocalTempTable,
} from "../scripts/reconcile/shared/lineage-scope.ts";

describe("lineage-scope", () => {
  it("treats checkdbflag as a no-SQL scheduler task from category, checker. name, or pack locator", () => {
    expect(isNoSqlTaskCategory("checkdbflag")).toBe(true);
    expect(isCheckdbflagTask({ taskCategory: "checkdbflag" })).toBe(true);
    expect(isCheckdbflagTask({ taskName: "checker.POS_OTC_POSITION_DAILY_ETL" })).toBe(true);
    expect(
      isCheckdbflagTask({ locators: ["tasks/checkdbflag/149695/task.json"] }),
    ).toBe(true);
    expect(isCheckdbflagTask({ taskName: "POS_OTC_POSITION_DAILY_ETL" })).toBe(false);
  });

  it("treats ref_cd_cvt_map as a reference/config terminal", () => {
    expect(isReferenceConfigTable("pdata_n.ref_cd_cvt_map")).toBe(true);
    expect(
      isOutOfScopePhysicalRead({ platform: "hive", qualifiedName: "pdata_n.ref_cd_cvt_map" }),
    ).toBe(true);
  });

  it("treats task-local temp tables as out of scope", () => {
    expect(isTaskLocalTempTable("temp.t03_agt_rela_h_mid_tit165")).toBe(true);
    expect(
      isOutOfScopePhysicalRead({ platform: "hive", qualifiedName: "temp.t03_agt_rela_h_mid_tit165" }),
    ).toBe(true);
  });

  it("treats same-task scratch suffix tables like field-lineage task-local materialization", () => {
    expect(isSameTaskScratchTable("dm_rsk_n.otc_opt_inr_comp_pal_sum_temp")).toBe(true);
    expect(
      isSameTaskScratchProducerBridge("181058", "181058", "dm_rsk_n.otc_opt_inr_comp_pal_sum_temp"),
    ).toBe(true);
    expect(
      isSameTaskScratchProducerBridge("181058", "124566", "dm_rsk_n.otc_opt_inr_comp_pal_sum_temp"),
    ).toBe(false);
  });

  it("stops Hive producer tracing at a known non-Hive platform", () => {
    expect(isNonHiveProducerBoundary("oracle")).toBe(true);
    expect(isNonHiveProducerBoundary("Hive")).toBe(false);
    expect(isNonHiveProducerBoundary(null)).toBe(false);
  });
});
