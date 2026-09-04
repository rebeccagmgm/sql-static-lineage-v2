import type {
  ColumnRef,
  ExprSpec,
  PlanFacts,
  PlanRelation,
  SourceSpan,
} from "../../../scripts/plans/plan-contract.ts";

const span: SourceSpan = { start: 0, end: 20 };

export function column(
  table: string,
  name: string,
  clause: ColumnRef["clause"] = "projection",
): ColumnRef {
  return {
    name,
    clause,
    physical: [{ table, column: name }],
    resolution: "PHYSICAL",
  };
}

export function expression(
  output: string,
  exprKind: string,
  inputColumns: readonly ColumnRef[] = [],
  extra: Partial<ExprSpec> = {},
): ExprSpec {
  return {
    output,
    expr_kind: exprKind,
    expr_text: exprKind,
    display_text: exprKind,
    span,
    input_columns: [...inputColumns],
    expression_facts: {
      operators: [],
      literals: [],
      functions: [],
      predicates: [],
      comparisons: [],
    },
    ...extra,
  };
}

function relation(input: Record<string, unknown>, id: string): PlanRelation {
  return {
    id,
    span,
    provenance: "extracted",
    output_columns: null,
    ...input,
  } as PlanRelation;
}

export function read(id: string, table: string, binding = table): PlanRelation {
  return relation({ type: "read", table, binding, columns: null }, id);
}

export function plan(
  relations: readonly PlanRelation[],
  roots: readonly string[],
): PlanFacts {
  return {
    meta: {
      contract_version: "1.4.0",
      adapter_version: "fixture",
      parser: { engine: "fixture", version: "1" },
      dialect: "databricks",
      statement_index: 0,
      generated_at: "2026-08-27T00:00:00.000Z",
    },
    relations: [...relations],
    roots: [...roots],
    physical_inputs: ["trade", "dim"],
    unknowns: [],
    lineage_hops: { roots: [], nodes: [], edges: [] },
  };
}

export const semanticNormalizerPlan = plan(
  [
    read("trade", "trade", "t"),
    read("dim", "dim", "d"),
    relation(
      {
        type: "join",
        left: "trade",
        right: "dim",
        join_type: "left",
        condition_expr: "t.id = d.id",
        condition_display: "t.id = d.id",
        condition_columns: [
          column("trade", "id", "join"),
          column("dim", "id", "join"),
        ],
      },
      "join",
    ),
    relation(
      {
        type: "filter",
        source: "join",
        predicate_expr: "status = 'A'",
        predicate_display: "status = 'A'",
        predicate_columns: [column("trade", "status", "where")],
        predicate_tree: {
          kind: "ATOM",
          operator: "EQ",
          operands: [
            {
              kind: "COLUMN",
              expression: "status",
              column: column("trade", "status", "where"),
            },
            { kind: "LITERAL", expression: "'A'", observedValue: "A" },
          ],
          span,
        },
      },
      "where",
    ),
    relation(
      {
        type: "aggregate",
        source: "where",
        group_by: [column("trade", "account_id", "groupBy")],
        group_by_exprs: ["account_id"],
        group_by_exprs_display: ["account_id"],
        measures: [
          expression("total", "function", [column("trade", "amount")], {
            aggregate: true,
            expression_facts: {
              operators: [],
              literals: [],
              functions: ["SUM"],
              predicates: [],
              comparisons: [],
            },
          }),
          expression("cnt", "function", [], {
            aggregate: true,
            expr_text: "COUNT(*)",
            expression_facts: {
              operators: [],
              literals: [],
              functions: ["COUNT"],
              predicates: [],
              comparisons: [],
            },
          }),
        ],
      },
      "aggregate",
    ),
    relation(
      {
        type: "project",
        source: "aggregate",
        expressions: [
          expression("amount_out", "case", [column("trade", "amount")], {
            expression_roles: [
              {
                operator: "CASE",
                role: "BRANCH_SELECTOR",
                effects: ["BRANCH_SELECTION"],
                path: "case.when[0]",
                branch_ordinal: 0,
                ordinal: 0,
                expression_text: "status",
                display_text: "status",
                span,
                input_columns: [column("trade", "status")],
              },
              {
                operator: "CASE",
                role: "RESULT_VALUE",
                effects: ["VALUE_CONTRIBUTION"],
                path: "case.then[0]",
                branch_ordinal: 0,
                ordinal: 1,
                expression_text: "amount",
                display_text: "amount",
                span,
                input_columns: [column("trade", "amount")],
              },
            ],
          }),
          expression("score_out", "if", [], {
            expression_roles: [
              {
                operator: "IF",
                role: "BRANCH_SELECTOR",
                effects: ["BRANCH_SELECTION"],
                path: "if.condition",
                ordinal: 0,
                expression_text: "enabled",
                display_text: "enabled",
                span,
                input_columns: [column("trade", "enabled")],
              },
              {
                operator: "IF",
                role: "RESULT_VALUE",
                effects: ["VALUE_CONTRIBUTION"],
                path: "if.then",
                branch_ordinal: 0,
                ordinal: 1,
                expression_text: "score",
                display_text: "score",
                span,
                input_columns: [column("trade", "score")],
              },
            ],
          }),
          expression("fallback_out", "coalesce", [], {
            expression_roles: [
              {
                operator: "COALESCE",
                role: "COALESCE_ARGUMENT",
                effects: ["BRANCH_SELECTION", "VALUE_CONTRIBUTION"],
                path: "coalesce[0]",
                ordinal: 0,
                expression_text: "fallback_amount",
                display_text: "fallback_amount",
                span,
                input_columns: [column("trade", "fallback_amount")],
              },
            ],
          }),
          expression("rolling", "function", [column("trade", "amount")], {
            window: true,
            window_spec: {
              source_span: span,
              expression_text: "OVER (...)",
              display_text: "OVER (...)",
              input_bindings: [
                {
                  role: "VALUE",
                  ordinal: 0,
                  expression_text: "amount",
                  display_text: "amount",
                  span,
                  input_columns: [column("trade", "amount")],
                },
                {
                  role: "WINDOW_PARTITION",
                  ordinal: 0,
                  expression_text: "account_id",
                  display_text: "account_id",
                  span,
                  input_columns: [column("trade", "account_id")],
                },
                {
                  role: "WINDOW_ORDER",
                  ordinal: 0,
                  expression_text: "trade_time",
                  display_text: "trade_time",
                  span,
                  input_columns: [column("trade", "trade_time")],
                  direction: "DESC",
                  nulls: "UNSPECIFIED",
                },
              ],
              frame: {
                status: "UNKNOWN",
                expression_text: null,
                display_text: null,
                span: null,
                input_columns: [],
                reason: "frame projection unavailable",
              },
            },
          }),
        ],
      },
      "project",
    ),
    relation(
      {
        type: "top_n",
        source: "project",
        order_by: [
          {
            role: "ORDER",
            ordinal: 0,
            expression_text: "score_out",
            display_text: "score_out",
            span,
            input_columns: [column("trade", "score", "orderBy")],
            direction: "DESC",
          },
        ],
        limit: {
          kind: "LIMIT",
          fetch: {
            role: "LIMIT",
            ordinal: 0,
            expression_text: "10",
            display_text: "10",
            span,
            input_columns: [],
          },
        },
        span_status: "EXTRACTED",
      },
      "top",
    ),
    relation(
      {
        type: "setop",
        setop: "union",
        all: true,
        branches: ["union_left", "union_right"],
      },
      "union_all",
    ),
    relation(
      {
        type: "project",
        source: "trade",
        expressions: [expression("id", "column", [column("trade", "id")])],
      },
      "union_left",
    ),
    relation(
      {
        type: "project",
        source: "dim",
        expressions: [expression("id", "column", [column("dim", "id")])],
      },
      "union_right",
    ),
  ],
  ["top", "union_all"],
);

export const crossJoinPlan = plan(
  [
    read("left", "left_table", "l"),
    read("right", "right_table", "r"),
    relation(
      {
        type: "join",
        left: "left",
        right: "right",
        join_type: "cross",
        condition_expr: null,
        condition_display: null,
        condition_columns: [],
      },
      "cross",
    ),
    relation(
      {
        type: "project",
        source: "cross",
        expressions: [expression("flag", "literal")],
      },
      "literal",
    ),
  ],
  ["literal"],
);

export const existsPlan = plan(
  [
    read("outer", "outer_table", "o"),
    read("inner", "inner_table", "i"),
    relation(
      {
        type: "filter",
        source: "outer",
        predicate_expr: "EXISTS (...)",
        predicate_display: "EXISTS (...)",
        predicate_columns: [],
        predicate_facts: {
          operators: ["EXISTS"],
          literals: [],
          functions: ["EXISTS"],
          predicates: [],
          comparisons: [],
        },
        predicate_tree: {
          kind: "ATOM",
          operator: "OTHER",
          operands: [],
          span,
        },
        contains_subquery: true,
        subquery_relation_ids: ["inner"],
      },
      "exists",
    ),
  ],
  ["exists"],
);
