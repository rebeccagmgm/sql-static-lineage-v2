import type {
  OperatorSupportQuery,
  OperatorVariant,
} from "../../../scripts/reconcile/consumer/target-field-causal-slice/operator-support-matrix.ts";
import type {
  EffectKind,
  LocalEdgeKind,
  OperatorKind,
  SubjectKind,
} from "../../../scripts/reconcile/consumer/target-field-causal-slice/semantic-dependency-contract.ts";

export interface SemanticSupportFixture extends OperatorSupportQuery {
  readonly name: string;
  readonly expectedStatus: "SUPPORTED";
}

export interface OperatorSemanticSqlFixture {
  readonly name: string;
  readonly sql: string;
  readonly covers: readonly OperatorVariant[];
}

function fixture(
  name: string,
  operatorKind: OperatorKind,
  operatorVariant: OperatorVariant,
  operatorRole: OperatorSupportQuery["operatorRole"],
  subjectKind: SubjectKind,
  effectKind: EffectKind,
  localEdgeKind: LocalEdgeKind,
): SemanticSupportFixture {
  return {
    name,
    operatorKind,
    operatorVariant,
    operatorRole,
    subjectKind,
    effectKind,
    localEdgeKind,
    expectedStatus: "SUPPORTED",
  };
}

export const representativeSemanticSupportFixtures: readonly SemanticSupportFixture[] =
  [
    fixture(
      "case selector",
      "PROJECT",
      "CASE",
      "BRANCH_SELECTOR",
      "PHYSICAL_FIELD",
      "BRANCH_SELECTION",
      "EXPRESSION_CONTROL",
    ),
    fixture(
      "case value",
      "PROJECT",
      "CASE",
      "BRANCH_VALUE",
      "PHYSICAL_FIELD",
      "VALUE_CONTRIBUTION",
      "VALUE_FLOW",
    ),
    fixture(
      "if selector",
      "PROJECT",
      "IF",
      "BRANCH_SELECTOR",
      "PHYSICAL_FIELD",
      "BRANCH_SELECTION",
      "EXPRESSION_CONTROL",
    ),
    fixture(
      "coalesce value",
      "PROJECT",
      "COALESCE",
      "BRANCH_VALUE",
      "PHYSICAL_FIELD",
      "VALUE_CONTRIBUTION",
      "VALUE_FLOW",
    ),
    fixture(
      "where filter",
      "FILTER",
      "WHERE",
      "PREDICATE",
      "PHYSICAL_FIELD",
      "ROW_MEMBERSHIP",
      "ROWSET_CONTROL",
    ),
    fixture(
      "left join condition",
      "JOIN",
      "LEFT",
      "JOIN_CONDITION",
      "PHYSICAL_FIELD",
      "ROW_MEMBERSHIP",
      "ROWSET_CONTROL",
    ),
    fixture(
      "cross join cardinality",
      "RELATION",
      "CROSS_JOIN",
      "CARDINALITY",
      "RELATION_OCCURRENCE",
      "MULTIPLICITY",
      "RELATION_CONTEXT",
    ),
    fixture(
      "group by",
      "AGGREGATE",
      "GROUP_BY",
      "GROUP_KEY",
      "PHYSICAL_FIELD",
      "GROUPING",
      "ROWSET_CONTROL",
    ),
    fixture(
      "count star",
      "AGGREGATE",
      "COUNT_STAR",
      "RELATION",
      "RELATION_OCCURRENCE",
      "RELATION_EXISTENCE",
      "RELATION_CONTEXT",
    ),
    fixture(
      "distinct",
      "DISTINCT",
      "DISTINCT_KEY",
      "VALUE",
      "PHYSICAL_FIELD",
      "SET_MEMBERSHIP",
      "ROWSET_CONTROL",
    ),
    fixture(
      "union all",
      "SETOP",
      "UNION_ALL",
      "SET_MEMBER",
      "PHYSICAL_FIELD",
      "MULTIPLICITY",
      "ROWSET_CONTROL",
    ),
    fixture(
      "window partition",
      "WINDOW",
      "WINDOW_PARTITION_BY",
      "PARTITION_KEY",
      "PHYSICAL_FIELD",
      "GROUPING",
      "WINDOW_CONTEXT",
    ),
    fixture(
      "window frame",
      "WINDOW",
      "WINDOW_FRAME",
      "FRAME_BOUND",
      "PHYSICAL_FIELD",
      "WINDOW_CONTEXT",
      "WINDOW_CONTEXT",
    ),
    fixture(
      "top n limit",
      "TOP_N",
      "LIMIT",
      "RANK_LIMIT",
      "PHYSICAL_FIELD",
      "ROW_MEMBERSHIP",
      "ROWSET_CONTROL",
    ),
    fixture(
      "exists",
      "SUBQUERY",
      "EXISTS",
      "RELATION",
      "RELATION_OCCURRENCE",
      "RELATION_EXISTENCE",
      "RELATION_CONTEXT",
    ),
    fixture(
      "literal from relation",
      "RELATION",
      "LITERAL_FROM_RELATION",
      "RELATION",
      "RELATION_OCCURRENCE",
      "RELATION_EXISTENCE",
      "RELATION_CONTEXT",
    ),
  ];

/** Canonical source text is kept intact; adapters may derive normalized copies. */
export const representativeOperatorSqlCorpus: readonly OperatorSemanticSqlFixture[] =
  [
    {
      name: "case-if-coalesce",
      sql: "SELECT CASE WHEN status = 'A' THEN amount ELSE COALESCE(fallback_amount, 0) END AS amount_out, IF(enabled, score, 0) AS score_out FROM trade",
      covers: ["CASE", "IF", "COALESCE"],
    },
    {
      name: "where-having-qualify",
      sql: "SELECT account_id, SUM(amount) AS total FROM trade WHERE status = 'A' GROUP BY account_id HAVING SUM(amount) > 0 QUALIFY ROW_NUMBER() OVER (PARTITION BY account_id ORDER BY trade_time DESC) = 1",
      covers: ["WHERE", "HAVING", "QUALIFY"],
    },
    ...(["INNER", "LEFT", "RIGHT", "FULL", "SEMI", "ANTI"] as const).map(
      (joinType) => ({
        name: `${joinType.toLowerCase()}-join`,
        sql: `SELECT a.amount FROM a ${joinType} JOIN b ON a.id = b.id`,
        covers: [joinType],
      }),
    ),
    {
      name: "cross-join",
      sql: "SELECT a.amount FROM a CROSS JOIN b",
      covers: ["CROSS", "CROSS_JOIN"],
    },
    {
      name: "aggregate-count-star-distinct",
      sql: "SELECT DISTINCT account_id, COUNT(*) AS cnt, SUM(amount) AS total FROM trade GROUP BY account_id",
      covers: ["GROUP_BY", "AGGREGATE_INPUT", "COUNT_STAR", "DISTINCT_KEY"],
    },
    {
      name: "set-operations",
      sql: "SELECT id FROM a UNION SELECT id FROM b UNION ALL SELECT id FROM c INTERSECT SELECT id FROM d EXCEPT SELECT id FROM e",
      covers: ["UNION", "UNION_ALL", "INTERSECT", "EXCEPT"],
    },
    {
      name: "window-context-and-frame",
      sql: "SELECT SUM(amount) OVER (PARTITION BY account_id ORDER BY trade_time ROWS BETWEEN 3 PRECEDING AND CURRENT ROW) AS rolling_amount FROM trade",
      covers: [
        "WINDOW_VALUE",
        "WINDOW_PARTITION_BY",
        "WINDOW_ORDER_BY",
        "WINDOW_FRAME",
      ],
    },
    {
      name: "order-limit",
      sql: "SELECT id FROM trade ORDER BY score DESC LIMIT 10",
      covers: ["LIMIT"],
    },
    {
      name: "top",
      sql: "SELECT TOP 10 id FROM trade ORDER BY score DESC",
      covers: ["TOP"],
    },
    {
      name: "fetch",
      sql: "SELECT id FROM trade ORDER BY score DESC FETCH FIRST 10 ROWS ONLY",
      covers: ["FETCH"],
    },
    {
      name: "subquery-forms",
      sql: "SELECT a.id, (SELECT MAX(b.score) FROM b WHERE b.id = a.id) AS max_score FROM a WHERE EXISTS (SELECT 1 FROM c WHERE c.id = a.id) AND a.id IN (SELECT id FROM d)",
      covers: ["SCALAR", "EXISTS", "IN", "CORRELATED"],
    },
    {
      name: "literal-from-relation",
      sql: "SELECT 1 AS flag FROM trade",
      covers: ["LITERAL_FROM_RELATION"],
    },
  ];
