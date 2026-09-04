# Task-local projection 1.2.0

## Requirement: versioned compatibility

The projection producer MUST emit schema version `1.2.0`. The validator MUST continue to
accept a structurally valid `1.1.0` artifact so historical cache envelopes remain readable.

## Requirement: evidence-bounded identity

For every physical dataset observation the projection MUST expose `identityStatus`,
`qualificationStatus` (when applicable), and an identity reason code when identity is not
confirmed. A bare table name MUST NOT be confirmed from catalog-tail or task-name matching
alone.

## Requirement: occurrence nodes

Every read occurrence MUST be represented by a `READ_OCCURRENCE` node. Partition predicates
MUST remain attached to that occurrence's dataset edge and MUST NOT be merged across read
occurrences.

## Requirement: local materialization

Only a `RESOLVED` `task-local-materializations.jsonl` record MAY fold a temp field into its
same-task physical input. `AMBIGUOUS`, `UNRESOLVED`, and name-only temp observations MUST
remain explicit boundaries.

## Requirement: self-read

A read occurrence whose physical identity equals this task's final write identity MUST be
marked `SELF_READ`; the projection MUST NOT add an upstream task node for it.

## Requirement: closure summary

The projection MUST expose task-local `finalWrites`, `externalReads`, and `localFieldPaths`
summaries. These summaries MUST be derived only from the current task's Pack/Facts.
