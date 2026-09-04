import { describe, expect, it } from "vitest";

import { partitionPredicatesByReadOccurrence } from "../../../scripts/project-graph/task-local/partition-predicates.ts";

describe("partitionPredicatesByReadOccurrence", () => {
  it("keeps EQ/IN literals per read occurrence and does not merge sibling scopes", () => {
    const byOccurrence = partitionPredicatesByReadOccurrence({
      taskId: "119044",
      relationRecords: [
        {
          task_id: "119044",
          relation_id: "task:119044:statement:0:relation:root.b.filter",
          relation_type: "filter",
          relation: {
            type: "filter",
            id: "task:119044:statement:0:relation:root.b.filter",
            predicate_tree: {
              kind: "AND",
              children: [
                {
                  kind: "ATOM",
                  operator: "EQ",
                  operands: [
                    {
                      kind: "COLUMN",
                      column: { name: "SRC_TBL" },
                      expression: "SRC_TBL",
                    },
                    {
                      kind: "LITERAL",
                      expression: "'ODATA_N_TIT.D_REF_OTC_OPTION_DEAL'",
                      observedValue: "ODATA_N_TIT.D_REF_OTC_OPTION_DEAL",
                    },
                  ],
                },
              ],
            },
          },
        },
        {
          task_id: "119044",
          relation_id: "task:119044:statement:0:relation:root.c.filter",
          relation_type: "filter",
          relation: {
            type: "filter",
            id: "task:119044:statement:0:relation:root.c.filter",
            predicate_tree: {
              kind: "ATOM",
              operator: "EQ",
              operands: [
                {
                  kind: "COLUMN",
                  column: { name: "SRC_TBL" },
                  expression: "SRC_TBL",
                },
                {
                  kind: "LITERAL",
                  expression: "'ODATA_N_TIT.D_TRD_OTC_TRADE'",
                  observedValue: "ODATA_N_TIT.D_TRD_OTC_TRADE",
                },
              ],
            },
          },
        },
        {
          task_id: "119044",
          relation_id: "task:119044:statement:0:relation:root.k.filter",
          relation_type: "filter",
          relation: {
            type: "filter",
            id: "task:119044:statement:0:relation:root.k.filter",
            predicate_tree: {
              kind: "ATOM",
              operator: "IN",
              operands: [
                {
                  kind: "COLUMN",
                  column: { name: "SRC_TBL" },
                  expression: "SRC_TBL",
                },
                {
                  kind: "LITERAL",
                  expression: "'ODATA_N_TIT.D_REF_BOOK'",
                  observedValue: "ODATA_N_TIT.D_REF_BOOK",
                },
              ],
            },
          },
        },
      ],
      relationEdgeRecords: [
        {
          task_id: "119044",
          from_relation_id: "task:119044:statement:0:relation:root.b.read.t03_agt_stat_h",
          to_relation_id: "task:119044:statement:0:relation:root.b.filter",
        },
        {
          task_id: "119044",
          from_relation_id: "task:119044:statement:0:relation:root.c.read.t03_agt_stati_info_h",
          to_relation_id: "task:119044:statement:0:relation:root.c.filter",
        },
        {
          task_id: "119044",
          from_relation_id: "task:119044:statement:0:relation:root.k.read.t03_agt_stati_info_h",
          to_relation_id: "task:119044:statement:0:relation:root.k.filter",
        },
      ],
    });

    expect(byOccurrence.get("task:119044:statement:0:relation:root.b.read.t03_agt_stat_h")).toEqual({
      status: "LITERAL",
      predicates: [{ column: "SRC_TBL", values: ["ODATA_N_TIT.D_REF_OTC_OPTION_DEAL"] }],
    });
    expect(byOccurrence.get("task:119044:statement:0:relation:root.c.read.t03_agt_stati_info_h")).toEqual({
      status: "LITERAL",
      predicates: [{ column: "SRC_TBL", values: ["ODATA_N_TIT.D_TRD_OTC_TRADE"] }],
    });
    expect(byOccurrence.get("task:119044:statement:0:relation:root.k.read.t03_agt_stati_info_h")).toEqual({
      status: "LITERAL",
      predicates: [{ column: "SRC_TBL", values: ["ODATA_N_TIT.D_REF_BOOK"] }],
    });
  });

  it("marks NON_LITERAL_PRESENT when filter atoms are not all literal EQ/IN", () => {
    const byOccurrence = partitionPredicatesByReadOccurrence({
      taskId: "1",
      relationRecords: [
        {
          task_id: "1",
          relation_id: "filter:1",
          relation_type: "filter",
          relation: {
            type: "filter",
            predicate_tree: {
              kind: "AND",
              children: [
                {
                  kind: "ATOM",
                  operator: "LTE",
                  operands: [
                    { kind: "COLUMN", column: { name: "STRT_DATE" } },
                    {
                      kind: "LITERAL",
                      expression: "'2026-06-11'",
                      observedValue: "2026-06-11",
                    },
                  ],
                },
                {
                  kind: "ATOM",
                  operator: "EQ",
                  operands: [
                    { kind: "COLUMN", column: { name: "SRC_TBL" } },
                    {
                      kind: "LITERAL",
                      expression: "'ODATA_N_TIT.D_TRD_OTC_TRADE'",
                      observedValue: "ODATA_N_TIT.D_TRD_OTC_TRADE",
                    },
                  ],
                },
              ],
            },
          },
        },
      ],
      relationEdgeRecords: [
        { task_id: "1", from_relation_id: "read:1", to_relation_id: "filter:1" },
      ],
    });
    expect(byOccurrence.get("read:1")).toEqual({
      status: "NON_LITERAL_PRESENT",
      predicates: [{ column: "SRC_TBL", values: ["ODATA_N_TIT.D_TRD_OTC_TRADE"] }],
    });
  });

  it("returns NONE when the read has no wrapping filter", () => {
    const byOccurrence = partitionPredicatesByReadOccurrence({
      taskId: "1",
      relationRecords: [],
      relationEdgeRecords: [],
    });
    expect(byOccurrence.get("read:missing")).toBeUndefined();
  });
});
