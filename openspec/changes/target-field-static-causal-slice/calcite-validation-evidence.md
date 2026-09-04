# Calcite offline validation evidence

Date: 2026-08-27

## Runtime and production boundary

- The sidecar is pinned to Apache Calcite `1.42.0` in `tools/calcite-oracle/pom.xml`.
- It is invoked independently through `tools/calcite-oracle/test-runtime.ps1` or
  the shaded Java jar. The Node production entry point does not start the
  sidecar and the sidecar does not read or write canonical field-lineage
  artifacts.
- The owned runtime check passed with Java/Javac 8.0.472 and the locally cached
  Calcite 1.42.0 dependency:

  ```text
  npm run test:calcite-oracle
  Calcite oracle runtime checks passed
  ```

- The TypeScript reconciler passed 6/6 tests. The target-field causal-slice
  suite passed 16/16 files and 113/113 tests.

## 209119 shadow A/B decision

Decision: **NO_GO / NOT_EVALUATED**.

The probe used the actual 209119 SQL snapshot and the 15 actual Machine Facts
schema references. Template date parameters were materialized only in the
temporary Calcite request so the parser could reach the relevant syntax; the
canonical SQL and Native artifact were not changed. The schema references do
not carry complete SQL types, so the probe used `VARCHAR` as a temporary type
default. This probe is diagnostic evidence, not a canonical semantic result.

Calcite returned:

```json
{
  "status": "FAILED",
  "error": {
    "code": "PLANNER_FAILURE",
    "message": "Incorrect syntax near the keyword 'CONDITION' at line 22, column 63."
  }
}
```

The successful sidecar protocol exposes metadata observations
(`expressionLineage`, `predicates`, `uniqueKeys`, functional dependencies,
table occurrences, and row-count/cardinality), but does not expose the
first-class Native-facing `semanticObservations` required by the mapping
layer. The 209119 response was a planner failure and therefore contained no
observations at all. Consequently no occurrence mapping or field mapping was
attempted, and no Calcite result can be attached to 209119.

The machine-readable record is
`tests/fixtures/target-field-causal-slice/calcite-differential/209119-no-go.json`.
It is deliberately decision-free: it contains no mapping report, assessments,
positive/negative proof, or rerun set.

## Evidence fingerprints

| Evidence                             | SHA-256                                                            |
| ------------------------------------ | ------------------------------------------------------------------ |
| 209119 SQL snapshot                  | `8dd4b5630e6e7eac3aeb67cf1a853a882ef24ad7fa5be40c9d6f678867f2049d` |
| 209119 task-scoped input fingerprint | `ec4e5337c676f6675244f668603d9e66d24e4a16b4fe5153c120779a25f76bf5` |
| Native target-field artifact         | `eaacf4fa15f5ce6e9d15a1c3e739043ab3483d3ebc62645311f57da24f9dc430` |
| Machine Facts schema bundle          | `67ea63f9c2f626889f9309124cb0bead17abb72d480baa924330c42528a6edd9` |

The absence of a valid Calcite occurrence/field mapping means this run cannot
corroborate Native semantic dependencies and cannot produce a Calcite-backed
`CONFIRMED_RELATED`, `PROVEN_UNRELATED`, or rerun decision. A future rerun may
become eligible after the dialect/parser boundary and exact semantic
observation adapter are addressed, but it must use the same source and Native
fingerprint checks.
