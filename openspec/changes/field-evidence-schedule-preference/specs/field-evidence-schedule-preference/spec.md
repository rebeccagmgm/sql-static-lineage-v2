# field-evidence-schedule-preference Specification

Horae schedule recommendation on Impact Query frontier candidates (Phase 2.5). Consumes schedule evidence read-only; does not modify `UNION_CONTINUATION_INDEX`, `TASK_LOCAL_PROJECTION`, or Phase 2 CONFIRMED rules.

## ADDED Requirements

### Requirement: Horae schedule relation on frontier candidates

For each `frontier[].candidates[]` entry, the system SHALL emit:

- `scheduleRelation`: `"DIRECT_PARENT" | "NOT_IN_HORAE_UPSTREAM" | "HORAE_UNAVAILABLE"`
- `schedulePreferred`: boolean

Horae upstream SHALL be resolved relative to the **consumer** task id at the frontier hop from `horae-relation-up-depth-1.json` or equivalent `scheduleEdges`.

#### Scenario: Unique Horae parent among candidates

- **WHEN** Horae cache is available for the consumer and exactly one candidate `taskId` is in the depth-1 upstream list
- **THEN** that candidate has `scheduleRelation = DIRECT_PARENT`, `schedulePreferred = true`, and appears first in `candidates[]`

#### Scenario: Multiple Horae parents among candidates

- **WHEN** two or more candidates are in the Horae upstream list
- **THEN** all candidates have `schedulePreferred = false` and the result `gaps[]` includes `SCHEDULE_PARENT_AMBIGUOUS`

#### Scenario: Horae cache unavailable

- **WHEN** `horae-relation-up-depth-1.json` is missing or invalid for the consumer
- **THEN** every candidate has `scheduleRelation = HORAE_UNAVAILABLE` and `schedulePreferred = false`

### Requirement: Schedule preference does not upgrade lineage

The system SHALL NOT change `l1Eligible`, `evidenceStatus`, default recursion, or INDEX resolution based on Horae schedule data.

#### Scenario: Multi-writer frontier unchanged

- **WHEN** INDEX returns multiple candidates or `l1Eligible === false`
- **THEN** `resolveReadField` still returns `MULTI_WRITER_CANDIDATE_FRONTIER` and default `impactQuery` does not recurse — regardless of `schedulePreferred`

#### Scenario: Unique l1Eligible CONFIRMED path

- **WHEN** INDEX returns exactly one `l1Eligible` candidate with producer binding
- **THEN** `impactQuery` emits CONFIRMED depth-1 values identically with or without schedule lookup

### Requirement: FIELD_IMPACT_RESULT 1.1.0 frontier shape

`FIELD_IMPACT_RESULT.schemaVersion` SHALL be `1.1.0`. Every frontier candidate SHALL include `schedulePreferred` and `scheduleRelation`.

#### Scenario: Contract validation

- **WHEN** `validateFieldImpactResult` is called on a 1.1.0 result with frontier candidates
- **THEN** validation succeeds when required sections are present

#### Scenario: Golden Case D schedule recommendation

- **WHEN** Horae cache is available for the Case D consumer task and `impactQuery` returns `MULTI_WRITER_CANDIDATE_FRONTIER`
- **THEN** exactly one frontier candidate has `schedulePreferred = true`, ranks first, and has `scheduleRelation = DIRECT_PARENT`

#### Scenario: Golden required without Horae cache

- **WHEN** `FIELD_EVIDENCE_GOLDEN_REQUIRED=1` and Horae cache is unavailable for Case D
- **THEN** the golden test fails closed
