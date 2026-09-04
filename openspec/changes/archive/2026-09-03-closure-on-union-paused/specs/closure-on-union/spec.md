## Purpose

Provides a fail-closed, opt-in bridge from WP-8.1 continuation-index evidence
to target-table causal closure without changing legacy outputs or partition
matching semantics.

## ADDED Requirements

### Requirement: legacy mode remains compatible

The CLI MUST default to `--candidate-source legacy`. Legacy mode MUST preserve
the existing candidate projection, bridge attachment, serialized artifact
shape, and content hash, and MUST NOT require or read a continuation index.

#### Scenario: default invocation uses legacy behavior

- **WHEN** the target-table closure CLI is run without `--candidate-source`
- **THEN** it follows the existing legacy path and produces the same artifact
  content hash as before the change

### Requirement: union-v2 reads the versioned continuation index

Union-v2 MUST require `--continuation-index` and MUST parse an index whose
`schemaVersion` is `1.0.0` and `artifactType` is
`UNION_CONTINUATION_INDEX`. Reads MUST be looked up by exact
`(consumerTaskId, readOccurrenceId)`; a missing entry MUST remain an UNKNOWN
branch with gap `CONTINUATION_READ_NOT_FOUND`.

#### Scenario: an indexed read is found by occurrence identity

- **WHEN** a union-v2 branch has the same consumer task and read occurrence id
  as an index entry
- **THEN** the adapter returns that entry's candidates and preserves its
  partition status, evidence layer, and L1 eligibility

#### Scenario: an indexed read is absent

- **WHEN** a union-v2 multi-hop producer branch has no exact index entry
- **THEN** the branch is not fanned out from other reads and carries an
  UNKNOWN continuation gap `CONTINUATION_READ_NOT_FOUND`

### Requirement: union-v2 attaches write observations precisely

Union-v2 MUST use exact continuation-INDEX candidates for the physical
producer universe. For a cross-Task candidate, the producer Task MUST also be
present in the raw multi-hop schedule relation for that consumer; this is a
consumer-side whitelist and is not producer evidence. Same-Task candidates do
not require a schedule edge. For each retained candidate it MUST bind
`writeScope` using that candidate's exact `writeObservationId`.
`DISJOINT` candidates MUST be pruned, and `SCHEDULE_ONLY` edges MUST NOT
produce producer branches. Alignment ambiguity MUST preserve each distinct
write observation as UNKNOWN and MUST NOT create or use a shared producer
index `:0` identity.

#### Scenario: schedule relation narrows INDEX candidates

- **WHEN** an INDEX read has candidates from several Tasks but raw
  `scheduleEdges` contains only a subset of those producer Tasks
- **THEN** only the intersection is eligible for `PHYSICAL_PRODUCER`; the
  other INDEX candidates are not emitted as producer branches

#### Scenario: schedule relation is unavailable

- **WHEN** the raw schedule relation is missing or cannot be parsed for a
  cross-Task INDEX candidate
- **THEN** no physical producer branch is emitted and the read remains an
  UNKNOWN boundary with a schedule-relation gap

#### Scenario: a disjoint write is pruned

- **WHEN** an index candidate for a multi-hop producer bridge has
  `partitionMatchStatus=DISJOINT`
- **THEN** no closure producer branch is emitted for that candidate and
  `disjointPruned` is incremented

#### Scenario: multi-write alignment stays distinct

- **WHEN** an index entry contains `write-observation:105387:3` and
  `write-observation:105387:6` with `WRITE_OBSERVATION_ALIGNMENT_AMBIGUOUS`
- **THEN** both write observations remain distinct UNKNOWN candidates with
  exact scope attempts, and no `write-observation:105387:0` candidate is made

### Requirement: continuation status controls closure certainty

An indexed candidate with `l1Eligible=true`, source
`IN_UNION_FINAL_WRITE`, and partition status `CONFIRMED` MAY propagate as L1
only when exact write scope binding succeeds. `ASSUMED` candidates MUST be at
most CONDITIONAL/L2; UNKNOWN, non-L1, and `PRODUCER_INDEX_ONLY` candidates MUST
not become L1 confirmed. The branch MUST expose the continuation fields
`source`, `partitionMatchStatus`, `evidenceLayer`, `l1Eligible`, and
`indexEntryRef`.

#### Scenario: L1 requires scope binding

- **WHEN** an index candidate is L1 eligible but its exact write scope cannot
  be resolved
- **THEN** the candidate remains visible, receives
  `PRODUCER_WRITE_SCOPE_UNRESOLVED`, and does not increment
  `bridgeStats.resolved`

#### Scenario: an assumed candidate is not promoted to L1

- **WHEN** a retained candidate has partition status `ASSUMED`
- **THEN** its closure certainty is at most CONDITIONAL and its continuation
  evidence layer remains L2

### Requirement: bridge and continuation counts are evidence-bounded

Union-v2 MUST emit `continuationStats` with counters `l1`, `l2Assumed`,
`l2Unknown`, `piOnly`, `disjointPruned`, `ambiguousReads`, and
`unmatchedReads`; it MAY additionally emit `selfReadBoundaries` for same-task
reads that are intentionally absent from INDEX externalReads. `bridgeStats.resolved` MUST count only L1-eligible candidates
whose exact scope binding succeeds. `bridgeStats.ambiguous` MUST count read
occurrences retaining at least two write observations after DISJOINT pruning;
it MUST NOT be implemented as `resolved += writes.length`.

#### Scenario: same-task reads remain local boundaries

- **WHEN** a multi-hop physical branch has a same-task write for the same
  physical table and its read occurrence is absent from INDEX externalReads
- **THEN** union-v2 emits an UNKNOWN `UNBOUND_READ` boundary with
  `SELF_READ_NOT_EXTERNAL`, increments `selfReadBoundaries`, and does not
  increment `unmatchedReads` or synthesize a producer

#### Scenario: ambiguous reads are counted once per read

- **WHEN** one read occurrence retains two or more write observations after
  pruning
- **THEN** `ambiguousReads` and `bridgeStats.ambiguous` each increase by one,
  independent of the number of retained writes

#### Scenario: L1 and scope resolution are counted per eligible candidate

- **WHEN** exactly one retained candidate is L1 eligible and its exact scope
  binds successfully
- **THEN** `l1` and `bridgeStats.resolved` each increase by one, while no
  other candidate is counted as resolved implicitly

### Requirement: Gate B-UNION exports an evidence-bounded L1 set

The union-v2 consumer MUST be able to export a separate, machine-readable
Gate B-UNION L1 set from a validated closure artifact and its exact
`UNION_CONTINUATION_INDEX`. Each member MUST retain the consumer task,
producer task, exact write observation, read-occurrence chain, exact write
scope, continuation status, and evidence references. The set MUST include the
closure and INDEX content hashes and MUST reject a legacy closure, a closure
whose root task does not match its target write, or a member that is not
`IN_UNION_FINAL_WRITE` + `CONFIRMED` + `L1` + `l1Eligible=true`.

#### Scenario: an L1 set is exported from a union-v2 closure

- **WHEN** a schema-valid union-v2 closure and matching continuation INDEX are
  supplied to the Gate B-UNION export command
- **THEN** it writes a deterministic L1 member set with a schema version,
  content hash, input artifact references, and no `ASSUMED`, `UNKNOWN`,
  `SCHEDULE_ONLY`, or legacy-only value-evidence member

#### Scenario: the 209119 Gate B-UNION input is unavailable

- **WHEN** the required 209119 union-v2 closure or continuation INDEX is
  absent
- **THEN** the verification records an explicit input blocker and does not
  claim a Gate B-UNION pass or emit an empty substitute set
