export interface SemanticGoldCase {
  readonly fixtureId: string;
  readonly partition: "development" | "holdout";
  readonly taskId: string;
  readonly sqlPath: string;
  readonly targetTable: string;
  readonly targetField: string;
  readonly expectedWriteCount: number;
  readonly expectedGoldPath: string;
  readonly expectedWrites: readonly {
    readonly writeObservationId: string;
    readonly requiredValueSubject?: string;
    readonly requiredWhereSubject?: string;
    readonly forbiddenSubjects: readonly string[];
  }[];
  readonly expectedGapReasons: readonly string[];
}

export const semanticGoldCases: readonly SemanticGoldCase[] = [
  {
    fixtureId: "sibling-writes",
    partition: "development",
    taskId: "semantic-gold-sibling-writes",
    sqlPath:
      "tests/fixtures/target-field-causal-slice/semantic-gold/development-sibling-writes.sql",
    targetTable: "mart.target",
    targetField: "amount",
    expectedWriteCount: 2,
    expectedGoldPath:
      "tests/fixtures/target-field-causal-slice/semantic-gold/development-sibling-writes.gold.json",
    expectedWrites: [
      {
        writeObservationId:
          "write-observation:semantic-gold-sibling-writes:0",
        requiredValueSubject:
          "hive|semantic-gold|semantic-gold-source-a|mart.source_a|amount",
        requiredWhereSubject:
          "hive|semantic-gold|semantic-gold-source-a|mart.source_a|keep_a",
        forbiddenSubjects: [
          "hive|semantic-gold|semantic-gold-source-b|mart.source_b|amount",
          "hive|semantic-gold|semantic-gold-source-b|mart.source_b|keep_b",
        ],
      },
      {
        writeObservationId:
          "write-observation:semantic-gold-sibling-writes:1",
        requiredValueSubject:
          "hive|semantic-gold|semantic-gold-source-b|mart.source_b|amount",
        requiredWhereSubject:
          "hive|semantic-gold|semantic-gold-source-b|mart.source_b|keep_b",
        forbiddenSubjects: [
          "hive|semantic-gold|semantic-gold-source-a|mart.source_a|amount",
          "hive|semantic-gold|semantic-gold-source-a|mart.source_a|keep_a",
        ],
      },
    ],
    expectedGapReasons: [],
  },
  {
    fixtureId: "unmodeled-parameter",
    partition: "holdout",
    taskId: "semantic-gold-unmodeled-parameter",
    sqlPath:
      "tests/fixtures/target-field-causal-slice/semantic-gold/holdout-unmodeled-parameter.sql",
    targetTable: "mart.target",
    targetField: "amount",
    expectedWriteCount: 1,
    expectedGoldPath:
      "tests/fixtures/target-field-causal-slice/semantic-gold/holdout-unmodeled-parameter.gold.json",
    expectedWrites: [
      {
        writeObservationId:
          "write-observation:semantic-gold-unmodeled-parameter:0",
        forbiddenSubjects: [],
      },
    ],
    expectedGapReasons: ["UNKNOWN_OPERATOR_OR_ROLE"],
  },
] as const;
