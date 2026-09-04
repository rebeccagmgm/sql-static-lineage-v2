## 1. Contract and producer

- [x] 1.1 Add typed `PACK_DECLARED_QUERY_OUTPUT`/legacy-alias kinds and `source_sql_sha256` fields to Machine Facts write/binding contexts and contracts.
- [x] 1.2 Emit the canonical Pack-declared write from the existing unique-producer branch, using Input Pack provenance hash and retaining raw SQL/span identity.
- [x] 1.3 Keep target, producer-boundary, Schema and partition gates fail-closed with typed gaps; do not alter SQL or introduce synthetic SQL.

## 2. Validation and compatibility

- [x] 2.1 Validate Pack-declared source hashes and write/binding identity in bundle validation and record schemas.
- [x] 2.2 Update field-lineage and other platform-target predicates to accept the new kind and the legacy alias without changing legacy bundle bytes.
- [x] 2.3 Add an explicit INSERT regression proving `source_as_boundary.proven=false` does not block a valid SQL write binding (S10).

## 3. Real-pack acceptance

- [x] 3.1 Add the isolated real-Pack test for 132028, 155939 and 176827 with deterministic rerun/hash checks and `WP6_REAL_PACK_REQUIRED` fail-closed behavior.
- [x] 3.2 Run focused Machine Facts/real-Pack tests, typecheck and `git diff --check`; record any missing external data root separately.

## Verification note

- `npm run test:machine-facts`, `npm run test:field-lineage`, `npm run test:input-pack`, and `npm run test:pack-declared-write-observation` passed.
- Real-pack acceptance regenerated 132028 and 176827 successfully; 155939 failed closed with `TASK_TARGET_PHYSICAL_IDENTITY_UNRESOLVED`, as required by the target-identity gate.
- `npm run build` passed. `npm run typecheck` still reports the pre-existing union narrowing errors in `tests/hive-ddl-from-log-cache.test.ts`; repository-wide `npm run format:check` and `git diff --check` also retain pre-existing dirty-file findings. The scoped diff for this change is clean, and the new test passes Prettier check.
