## Purpose

Provide write-occurrence-scoped operator lineage whose semantic dependencies cannot cross-contaminate sibling writes and whose supported behavior is verified from real SQL rather than only from hand-built intermediate facts.

## ADDED Requirements

### Requirement: The selected write occurrence determines one semantic scope
The system SHALL resolve each requested target write from canonical Machine Facts into exactly one write observation, SQL source, statement occurrence, root relation occurrence, and target output binding set. It MUST NOT infer that scope from target table or field names alone.

#### Scenario: One write is selected from multiple writes to the same target
- **WHEN** one task writes the same physical target and field from multiple statements and the caller selects one `write_observation_id`
- **THEN** the system uses only the statement, root relation, expressions, and output bindings proven for that write observation

#### Scenario: The selected write cannot be mapped uniquely
- **WHEN** canonical write evidence is missing, contradictory, or maps the selected observation to multiple statement or root relation occurrences
- **THEN** the system emits a blocking scope gap and produces no confirmed dependency for the ambiguous scope

### Requirement: Semantic records preserve occurrence scope end to end
Every semantic dependency definition, application, and traversable edge SHALL carry enough canonical scope identity to bind it to the selected write, statement, owning relation, and owning expression when applicable. Gaps and proof paths MUST retain or reference the same scope, and validators MUST reject discontinuous or cross-scope records.

#### Scenario: A dependency is emitted for an output expression
- **WHEN** a supported operator dependency is normalized for a selected target output
- **THEN** its definition, application, edges, proof references, and resulting path are traceable to the selected write observation and the exact statement/relation/expression occurrence that produced it

#### Scenario: An edge belongs to a sibling write
- **WHEN** an edge or proof reference resolves to a statement, relation, expression, or write observation outside the selected semantic scope
- **THEN** artifact validation fails or the affected result becomes an explicit blocking gap; the edge MUST NOT contribute to a confirmed path

### Requirement: Multiple writes remain causally isolated
The system SHALL normalize and traverse each selected target write independently even when sibling writes share task ID, physical target, target field name, source fields, or operator variants.

#### Scenario: Sibling writes use different predicates and sources
- **WHEN** two statements write the same target field but one depends on source A and filter P while the other depends on source B and filter Q
- **THEN** the causal slice for the first write contains only A/P dependencies and the slice for the second contains only B/Q dependencies

#### Scenario: A caller requests more than one write observation
- **WHEN** the caller explicitly requests multiple target writes
- **THEN** the system retains separate per-write semantic scopes and assessments instead of merging their roots or dependencies by target field name

### Requirement: Operator lineage has a real SQL end-to-end gold contract
The test system SHALL build selected fixtures through the production SQL parser, scope analysis, Plan Facts adapter, semantic normalizer, and occurrence-scoping logic. Gold expectations MUST compare stable semantic meaning, including write scope, target field, subject occurrence, operator, effect, role, certainty, proof identity, and explicit gaps.

#### Scenario: A supported SQL construct is in the gold corpus
- **WHEN** a frozen SQL and schema fixture contains an in-scope operator dependency
- **THEN** the gold assertion verifies the exact occurrence-scoped dependency after real parsing and Plan Facts construction, without substituting hand-built Plan Facts

#### Scenario: An unsupported or incomplete SQL construct is in the gold corpus
- **WHEN** real parsing reaches a construct whose necessary operator or scope evidence is unavailable
- **THEN** the gold assertion requires a source-located explicit gap and fails if the dependency is silently omitted

#### Scenario: Gold output is replayed
- **WHEN** the same frozen SQL, schema, requested write, and tool versions are evaluated repeatedly
- **THEN** the stable gold projection is byte-identical after excluding explicitly non-semantic runtime metadata

### Requirement: Hardening preserves existing evidence authorities and consumers
The hardening SHALL remain a read-only consumer of existing SQL, Plan Facts, Machine Facts, producer, and field-lineage evidence. It MUST NOT change legacy field-lineage semantics, infer runtime data effects, enable Calcite in the default path, or claim support for a new operator variant solely because this change adds a gold harness.

#### Scenario: Legacy field lineage is regenerated
- **WHEN** the hardening is enabled or its tests run
- **THEN** existing field-lineage stable projections remain unchanged and do not acquire causal-slice-only fields

#### Scenario: The current support matrix is frozen
- **WHEN** a gold fixture reaches an operator cell not supported before this change
- **THEN** the fixture records the existing explicit gap behavior rather than expanding the support matrix inside this change
