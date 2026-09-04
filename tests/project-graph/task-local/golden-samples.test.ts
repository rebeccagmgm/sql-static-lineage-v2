import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { jsonlStoreExists } from "../../../scripts/machine-facts/jsonl-store.ts";

import {
  validateTaskLocalProjection,
  type TaskLocalProjection,
} from "../../../scripts/project-graph/task-local/contract.ts";
import { projectTaskLocal } from "../../../scripts/project-graph/task-local/project-task-local.ts";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const DEFAULT_DATA_ROOT = resolve(REPO_ROOT, "../sql-static-lineage-data");
const DEFAULT_FACTS_ROOT = join(DEFAULT_DATA_ROOT, "field-facts");

function goldenRoots(): { dataRoot: string; factsRoot: string } | null {
  const dataRoot = resolve(
    process.env.TASK_LOCAL_GOLDEN_DATA_ROOT?.trim() || DEFAULT_DATA_ROOT,
  );
  const factsRoot = resolve(
    process.env.TASK_LOCAL_GOLDEN_FACTS_ROOT?.trim() || DEFAULT_FACTS_ROOT,
  );
  const required = ["176827", "119044", "105387"].map((taskId) =>
    join(factsRoot, "registry", "tasks", taskId, "bundle", "dataset-io.jsonl"),
  );
  if (!existsSync(dataRoot) || !existsSync(factsRoot)) return null;
  if (!required.every((path) => jsonlStoreExists(path))) return null;
  return { dataRoot, factsRoot };
}

const roots = goldenRoots();
const requireGolden =
  process.env.TASK_LOCAL_GOLDEN_REQUIRED === "1"
  || process.env.TASK_LOCAL_GOLDEN_REQUIRED === "true";
if (requireGolden && !roots) {
  throw new Error(
    "TASK_LOCAL_GOLDEN_REQUIRED is set but golden Facts are missing. "
    + "Set TASK_LOCAL_GOLDEN_DATA_ROOT / TASK_LOCAL_GOLDEN_FACTS_ROOT "
    + "or place sibling sql-static-lineage-data/field-facts with 176827/119044/105387 bundles.",
  );
}
/** Without sibling Facts (or TASK_LOCAL_GOLDEN_*), TL-6/TL-7 goldens skip. CI with data must set TASK_LOCAL_GOLDEN_REQUIRED=1. */
const describeGolden = roots ? describe : describe.skip;

function nodeQualifiedName(
  projection: TaskLocalProjection,
  nodeId: string,
): string {
  return String(
    projection.nodes.find((node) => node.nodeId === nodeId)?.properties.qualifiedName ?? "",
  );
}

function uniqueReadTables(projection: TaskLocalProjection): string[] {
  return [
    ...new Set(
      projection.edges
        .filter(
          (edge) =>
            edge.edgeType === "READS"
            && projection.nodes.find((node) => node.nodeId === edge.fromNodeId)?.nodeType
              === "READ_OCCURRENCE",
        )
        .map((edge) => nodeQualifiedName(projection, edge.toNodeId)),
    ),
  ].sort();
}

function readDatasetEdges(projection: TaskLocalProjection) {
  return projection.edges.filter(
    (edge) =>
      edge.edgeType === "READS"
      && projection.nodes.find((node) => node.nodeId === edge.fromNodeId)?.nodeType
        === "READ_OCCURRENCE",
  );
}

function fieldDirectColumnsByTable(
  projection: TaskLocalProjection,
): Record<string, string[]> {
  const byTable = new Map<string, Set<string>>();
  for (const edge of projection.edges) {
    if (edge.edgeType !== "FIELD_DIRECT") continue;
    const node = projection.nodes.find((item) => item.nodeId === edge.fromNodeId);
    if (!node || node.nodeType !== "PHYSICAL_FIELD") continue;
    const table = String(node.properties.qualifiedName ?? "");
    const column = String(node.properties.column ?? "");
    if (!table || !column) continue;
    const columns = byTable.get(table) ?? new Set<string>();
    columns.add(column);
    byTable.set(table, columns);
  }
  return Object.fromEntries(
    [...byTable.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([table, columns]) => [table, [...columns].sort()]),
  );
}

function foreignTaskNodeIds(projection: TaskLocalProjection): string[] {
  return projection.nodes
    .map((node) => node.nodeId)
    .filter((nodeId) => nodeId.startsWith("task:") && nodeId !== `task:${projection.taskId}`);
}

function controlEdges(projection: TaskLocalProjection) {
  return projection.edges.filter((edge) => edge.edgeType === "DATASET_CONTROL");
}

function projectGolden(taskId: string): TaskLocalProjection {
  const projection = projectTaskLocal({
    dataRoot: roots!.dataRoot,
    factsRoot: roots!.factsRoot,
    taskId,
    generatedAt: "2026-09-02T00:00:00.000Z",
  });
  validateTaskLocalProjection(projection);
  return projection;
}

describeGolden("TL-6 golden samples (existing Facts)", () => {
  it("176827: platform target, 11 READS, no foreign tasks, controls not column-multiplied", () => {
    const projection = projectGolden("176827");
    expect(projection.coverageStatus).toBe("PROJECTED");

    const targetWrites = projection.nodes.filter((node) => node.nodeType === "TARGET_WRITE");
    expect(targetWrites).toHaveLength(1);
    expect(targetWrites[0]?.properties).toMatchObject({
      writeObservationId: "write-observation:176827:platform-target:0",
      qualifiedName: "dm_rsk_n.otc_opt_greek_val_det_h",
    });

    const writeNodeId = targetWrites[0]!.nodeId;
    const datasetNodeId = projection.edges.find(
      (edge) =>
        edge.edgeType === "WRITES"
        && edge.fromNodeId === writeNodeId
        && projection.nodes.find((node) => node.nodeId === edge.toNodeId)?.nodeType
          === "PHYSICAL_DATASET",
    )?.toNodeId;
    expect(nodeQualifiedName(projection, datasetNodeId ?? "")).toBe(
      "dm_rsk_n.otc_opt_greek_val_det_h",
    );

    const reads = uniqueReadTables(projection);
    expect(reads).toEqual([
      "pdata_n.ref_cd_cvt_map",
      "pdata_n.t03_otc_deri_book_adtnl_info",
      "pdata_n.t03_otc_opt_comp_sub_trd_barr_line_info",
      "pdata_n.t03_otc_opt_comp_sub_trd_info",
      "pdata_n.t98_sb_otc_opt_comp_info",
      "pdata_n.t98_sb_otc_opt_sub_trd_prcg_indx",
      "pdata_n.t98_sb_tit_day_hold_indx",
      "pdata_nds.pos_eod_position_view",
      "pdata_news_n.t02_oth_corre_fctr",
      "pdata_news_n.t02_pub_covt_const",
      "pdata_news_n.t02_tit_scr_base_info",
    ]);
    expect(reads.some((name) => /(?:^|\.)(?:t03_agt_|t01_pty_|d_ref_)/.test(name))).toBe(false);
    expect(foreignTaskNodeIds(projection)).toEqual([]);

    const outputColumns = new Set(
      projection.edges
        .filter((edge) => edge.edgeType === "FIELD_DIRECT")
        .map((edge) => String(edge.properties.outputColumn ?? "")),
    );
    const controls = controlEdges(projection);
    expect(controls.length).toBeGreaterThan(0);
    expect(controls.length).toBeLessThan(outputColumns.size * 3);
    expect(controls.every((edge) => edge.properties.grain !== "UNKNOWN")).toBe(true);

    const fdByTable = fieldDirectColumnsByTable(projection);
    expect(fdByTable["pdata_news_n.t02_pub_covt_const"]).toBeUndefined();
    expect(Object.values(fdByTable).every((columns) => columns.length < outputColumns.size)).toBe(
      true,
    );
  }, 60_000);

  it("119044: value edges stay table-local; controls follow JOIN/FILTER not 79 outputs", () => {
    const projection = projectGolden("119044");
    expect(projection.coverageStatus).toBe("PROJECTED");

    const targetWrites = projection.nodes.filter((node) => node.nodeType === "TARGET_WRITE");
    expect(targetWrites).toHaveLength(1);
    expect(targetWrites[0]?.properties).toMatchObject({
      writeObservationId: "write-observation:119044:0",
      qualifiedName: "pdata_n.t98_sb_otc_opt_comp_info",
    });

    const reads = uniqueReadTables(projection);
    expect(reads).toHaveLength(14);
    expect(reads).not.toContain("dm_rsk_n.otc_opt_greek_val_det_h");
    expect(reads.some((name) => /d_ref_/.test(name))).toBe(false);
    expect(foreignTaskNodeIds(projection)).toEqual([]);

    const fdByTable = fieldDirectColumnsByTable(projection);
    expect(fdByTable["pdata_n.t03_otc_opt_comp_info"]).toHaveLength(26);
    expect(fdByTable["pdata_n.t01_pty_name"]).toHaveLength(3);
    expect(fdByTable["pdata_n.t03_agt_stati_info_h"]).toEqual(["stati_cont_desc"]);
    expect(fdByTable["pdata_n.t03_agt_rela_h"]).toEqual(["rela_agt_id", "rela_agt_modifr"]);
    for (const table of [
      "pdata_n.ref_dw_cd_val",
      "pdata_n.t03_agt_stat_h",
      "pdata_n.t03_agt_clas_h",
      "pdata_n.t01_pty_rat",
      "pdata_n.t01_pty_clas_h",
      "pdata_n.t01_pty_cutp",
      "pdata_n.t03_agt_name_h",
    ]) {
      expect(fdByTable[table]).toHaveLength(1);
    }
    expect(
      Object.values(fdByTable).every((columns) => columns.length < 79),
    ).toBe(true);

    const controls = controlEdges(projection);
    const joinControls = controls.filter((edge) => edge.properties.subtype === "JOIN");
    const filterControls = controls.filter((edge) => edge.properties.subtype === "FILTER");
    expect(joinControls.length).toBeGreaterThanOrEqual(15);
    expect(filterControls.length).toBeGreaterThanOrEqual(15);
    expect(joinControls.every((edge) => edge.properties.grain === "EXPAND_RISK")).toBe(true);
    expect(filterControls.every((edge) => edge.properties.grain === "REDUCE")).toBe(true);
    // Must track relation×control-columns, not multiply by the 79 output columns.
    expect(controls.length).toBeLessThan(79 * 2);
    expect(controls.length).toBe(95);
  }, 60_000);

  it("105387: zipper refs stay on DATASET_CONTROL; Stati_Cont_Desc value path excludes refs", () => {
    const projection = projectGolden("105387");
    expect(projection.coverageStatus).toBe("PROJECTED");
    expect(foreignTaskNodeIds(projection)).toEqual([]);

    const writeNames = [
      ...new Set(
        projection.nodes
          .filter((node) => node.nodeType === "TARGET_WRITE")
          .map((node) => String(node.properties.qualifiedName ?? "")),
      ),
    ].sort();
    expect(writeNames).toEqual([
      "pdata_n.t03_agt_stati_info_h",
      "temp.t03_agt_stati_info_h_mid_tit165",
      "temp.t03_agt_stati_info_h_temp_tit165",
    ]);

    const zipperRefs = [
      "odata_n_tit.d_ref_fast_trs",
      "odata_n_tit.d_ref_fx_forward",
      "odata_n_tit.d_ref_otc_option_deal",
      "odata_n_tit.d_ref_trs",
    ];
    const fdByTable = fieldDirectColumnsByTable(projection);
    for (const ref of zipperRefs) {
      expect(fdByTable[ref]).toBeUndefined();
    }

    const statiSources = projection.edges
      .filter(
        (edge) =>
          edge.edgeType === "FIELD_DIRECT"
          && String(edge.properties.outputColumn ?? "").toLowerCase().startsWith("stati_cont"),
      )
      .map((edge) => nodeQualifiedName(projection, edge.fromNodeId));
    expect(statiSources.some((name) => zipperRefs.includes(name))).toBe(false);
    expect(
      statiSources.some((name) => name === "odata_n_tit.d_trd_otc_trade"),
    ).toBe(true);

    const joinRefTables = new Set(
      controlEdges(projection)
        .filter((edge) => edge.properties.subtype === "JOIN")
        .map((edge) => nodeQualifiedName(projection, edge.fromNodeId))
        .filter((name) => zipperRefs.includes(name)),
    );
    expect([...joinRefTables].sort()).toEqual(zipperRefs);
    expect(
      controlEdges(projection)
        .filter(
          (edge) =>
            edge.properties.subtype === "JOIN"
            && zipperRefs.includes(nodeQualifiedName(projection, edge.fromNodeId)),
        )
        .every((edge) => edge.properties.grain === "EXPAND_RISK"),
    ).toBe(true);
  }, 60_000);

  it("TL-7: partitionPredicates stay on READ occurrence and keep SRC_TBL values unmerged", () => {
    const normalize = (value: string): string => value.trim().toLowerCase();
    const srcValues = (
      projection: TaskLocalProjection,
      table: string,
    ): string[][] =>
      readDatasetEdges(projection)
        .filter((edge) => nodeQualifiedName(projection, edge.toNodeId) === table)
        .map((edge) => {
          const predicates = Array.isArray(edge.properties.partitionPredicates)
            ? edge.properties.partitionPredicates
            : [];
          const src = predicates.find(
            (item) =>
              typeof item === "object"
              && item !== null
              && normalize(String((item as { column?: unknown }).column ?? "")) === "src_tbl",
          ) as { values?: unknown } | undefined;
          const values = Array.isArray(src?.values) ? src.values.map(String) : [];
          return values.map(normalize).sort();
        });

    const p119044 = projectGolden("119044");
    const statSrc = srcValues(p119044, "pdata_n.t03_agt_stat_h");
    expect(statSrc).toEqual([[normalize("ODATA_N_TIT.D_REF_OTC_OPTION_DEAL")]]);

    const statiSrc = srcValues(p119044, "pdata_n.t03_agt_stati_info_h");
    expect(statiSrc).toHaveLength(2);
    expect(statiSrc).toContainEqual([normalize("ODATA_N_TIT.D_TRD_OTC_TRADE")]);
    expect(statiSrc).toContainEqual([normalize("ODATA_N_TIT.D_REF_BOOK")]);
    expect(statiSrc.some((values) => values.length > 1)).toBe(false);

    const p105387 = projectGolden("105387");
    const zipperHistorySrc = readDatasetEdges(p105387)
      .filter((edge) => {
        const name = nodeQualifiedName(p105387, edge.toNodeId);
        return name === "t03_agt_stati_info_h" || name.endsWith(".t03_agt_stati_info_h");
      })
      .map((edge) => {
        const predicates = Array.isArray(edge.properties.partitionPredicates)
          ? edge.properties.partitionPredicates
          : [];
        const src = predicates.find(
          (item) =>
            typeof item === "object"
            && item !== null
            && normalize(String((item as { column?: unknown }).column ?? "")) === "src_tbl",
        ) as { values?: unknown } | undefined;
        return Array.isArray(src?.values) ? src.values.map((value) => normalize(String(value))) : [];
      });
    expect(
      zipperHistorySrc.some((values) =>
        values.includes(normalize("ODATA_N_TIT.D_TRD_OTC_TRADE")),
      ),
    ).toBe(true);

    const p176827 = projectGolden("176827");
    expect(
      readDatasetEdges(p176827)
        .every((edge) => Array.isArray(edge.properties.partitionPredicates)),
    ).toBe(true);
    expect(
      readDatasetEdges(p176827)
        .every((edge) =>
          ["NONE", "LITERAL", "NON_LITERAL_PRESENT"].includes(
            String(edge.properties.partitionPredicateStatus ?? ""),
          ),
        ),
    ).toBe(true);
  }, 60_000);

  it("WP-3.1: PROJECTED keeps scheduleReference; 105387 controls stay on owning writes", () => {
    const scheduleCacheRoot =
      process.env.TASK_LOCAL_GOLDEN_SCHEDULE_CACHE?.trim()
      || resolve(REPO_ROOT, "../sql-static-lineage-cache");
    const hasSchedule = existsSync(scheduleCacheRoot);

    const p176827 = projectTaskLocal({
      dataRoot: roots!.dataRoot,
      factsRoot: roots!.factsRoot,
      taskId: "176827",
      ...(hasSchedule ? { scheduleCacheRoot } : {}),
      generatedAt: "2026-09-02T00:00:00.000Z",
    });
    validateTaskLocalProjection(p176827);
    if (hasSchedule) {
      const scheduleReference = p176827.nodes.find((node) => node.nodeType === "TASK")
        ?.properties.scheduleReference as { role?: string; upstreamTaskIds?: string[] } | undefined;
      expect(scheduleReference?.role).toBe("SCHEDULE_REFERENCE_ONLY");
      expect(Array.isArray(scheduleReference?.upstreamTaskIds)).toBe(true);
      expect((scheduleReference?.upstreamTaskIds?.length ?? 0) > 0).toBe(true);
    }

    const p105387 = projectGolden("105387");
    const controlsByWrite = new Map<string, number>();
    for (const edge of p105387.edges.filter((item) => item.edgeType === "DATASET_CONTROL")) {
      const writeId = String(edge.properties.writeObservationId ?? "");
      controlsByWrite.set(writeId, (controlsByWrite.get(writeId) ?? 0) + 1);
    }
    expect(controlsByWrite.size).toBeGreaterThan(1);
    expect(controlsByWrite.has("write-observation:105387:1")).toBe(true);
    expect(controlsByWrite.has("write-observation:105387:6")).toBe(true);
    const total = [...controlsByWrite.values()].reduce((sum, count) => sum + count, 0);
    expect(Math.max(...controlsByWrite.values())).toBeLessThan(total);
  }, 60_000);

  it("WP-7: real Facts keep occurrence identity, local materializations and closure summaries", () => {
    const p103928 = projectGolden("103928");
    expect(p103928.schemaVersion).toBe("1.3.0");
    const p103928Occurrences = p103928.nodes.filter(
      (node) => node.nodeType === "READ_OCCURRENCE",
    );
    expect(p103928Occurrences.length).toBeGreaterThan(0);
    expect(
      p103928Occurrences.some((node) => node.properties.readDisposition === "SELF_READ"),
    ).toBe(true);
    expect(p103928.localClosure?.finalWrites.length).toBeGreaterThan(0);
    expect(p103928.localClosure?.localFieldPaths.length).toBeGreaterThan(0);
    expect(
      p103928.edges.some(
        (edge) => edge.edgeType === "FIELD_DIRECT" && edge.properties.materializationFolded === true,
      ),
    ).toBe(true);

    const p105380 = projectGolden("105380");
    const unresolvedTemp = p105380.nodes.find(
      (node) =>
        node.nodeType === "READ_OCCURRENCE"
        && String(node.properties.physicalDataset).includes("t01_pty_clas_h_mid_tit341"),
    );
    expect(unresolvedTemp?.properties.materializationBoundaryReason).toBe(
      "MATERIALIZATION_NOT_RESOLVED",
    );
    expect(unresolvedTemp?.properties.readDisposition).toBe("EXTERNAL_READ");

    const p158641 = projectGolden("158641");
    const tempWriteDataset = p158641.nodes.find(
      (node) =>
        node.nodeType === "PHYSICAL_DATASET"
        && node.properties.qualifiedName === "temp_n.odata_n_tit_d_mkt_option_eod_pt_metric_cur",
    );
    expect(tempWriteDataset?.properties.identityStatus).toBe("CANDIDATE_DATASET");
    expect(tempWriteDataset?.properties.identityReasonCode).toBe("TEMP_MATERIALIZATION_MISSING");

    const p181058 = projectGolden("181058");
    expect(p181058.localClosure?.localFieldPaths.length).toBeGreaterThan(0);
    expect(
      p181058.edges.some(
        (edge) => edge.edgeType === "FIELD_DIRECT" && edge.properties.materializationFolded === true,
      ),
    ).toBe(true);
  }, 180_000);
});
