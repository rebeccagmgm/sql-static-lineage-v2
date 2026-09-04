# Operator and type coverage baseline

Recorded from the current Plan Facts contract/tests and a bounded, read-only Task 209119 Machine Facts snapshot. This is an inventory, not proof that the future Calcite projection supports every observed construct.

## Current Native structural coverage

The Plan Facts contract exposes `read`, `project`, `filter`, `join`, `aggregate`, `expand`, `setop`, `top_n`, and explicit `other` relations. Existing regression fixtures exercise:

- CASE, IF and COALESCE operand roles.
- WHERE, HAVING and QUALIFY distinction plus predicate trees.
- Stable read occurrence identities and duplicate table reads.
- INNER/OUTER/CROSS and other join facts.
- GROUP BY and aggregate measure facts.
- UNION/INTERSECT/EXCEPT facts and nested set operations.
- Window VALUE/PARTITION/ORDER roles with explicit unknown frame semantics.
- ORDER/OFFSET/LIMIT/FETCH Top-N facts.
- Lateral-derived fields and explicit unsupported/unknown boundaries.

These are Native extraction facts. They do not imply that a typed Calcite `RexNode` can be built.

## Bounded Task 209119 snapshot

Source: the existing fingerprinted Machine Facts registry bundle for Task 209119. No published artifact or Input Pack file was changed.

| Relation type | Count |
| --- | ---: |
| `read` | 37 |
| `project` | 33 |
| `filter` | 28 |
| `join` | 30 |
| `setop` | 3 |
| **Total** | **131** |

Additional root-task facts:

- Field expression nodes: 382.
- Schema references: 15.
- The root-task relation snapshot contains no standalone aggregate relation; aggregate value must therefore be evaluated on representative fixtures or upstream tasks, not inferred from this root snapshot.
- The root task strongly exercises the first value-gate batch: scans, projections, filters and joins dominate the graph.

## Type-system boundary

The 209119 `schema-refs.jsonl` snapshot preserves physical table identities, column names, partitions, DDL hashes and source evidence, but its projected `physical_columns` do not carry concrete SQL types or nullability. The field-expression registry also preserves source expression text and physical input identity but is not a complete typed expression AST.

Consequences for the Calcite bridge:

1. Machine Facts alone cannot safely provide every Calcite row type.
2. The projector must obtain types from existing Input Pack DDL/schema evidence with exact provenance, or return `UNSUPPORTED/NOT_EVALUATED`.
3. It must not use `ANY`, infer a type from a column name, or reparse `expression_text` as a hidden fallback.
4. Type coverage and typed-expression coverage must be reported separately from relation-node coverage during the 209119 gate.

## Initial value-gate expectation

The core bridge is worth expanding only if it converts a meaningful portion of the 37 reads, 33 projects, 28 filters and 30 joins with exact occurrence/evidence mapping and produces additional metadata. A high relation count with missing types or unmappable observations is not a successful gate.

## First real DDL projection probe

The first 209119 Hive schema reference, `dm_rsk_n.otc_opt_sub_trd_info`, was projected directly from its fingerprinted Input Pack `ddl.sql` without modifying the DDL or canonical facts:

- Projected tables: 1.
- DDL columns: 137.
- Concrete Calcite-facing types: 137.
- Projection issues: 0.
- Result: `SUCCESS`.

The DDL omits per-column `NULL` clauses, as ordinary Hive DDL commonly does. The projector treats omission as `nullable=true` only when the caller identifies the trusted DDL dialect as Hive; the same omission under generic/ANSI input remains `SCHEMA_NULLABILITY_MISSING`. This is a dialect rule with DDL evidence, not a column-name or expression-text guess.
