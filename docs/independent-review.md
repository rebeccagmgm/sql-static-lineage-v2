# Independent Scope / Architecture / Code Review

## Review scope

Review target: this new `sql-static-lineage-l1` directory after migration and focused regression replay. This is an engineering review of the directory and bounded Consumer; it does not grant Contract 2.0 readiness, Canonical promotion, runtime proof, business acceptance or scale authorization.

## Findings and dispositions

| Finding                                                                  | Disposition                                                                                                     |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Old workspace/schema path assumptions would resolve outside the new root | Fixed by making Publisher paths relative to the standalone root                                                 |
| Legacy schema refresh could call external `opencli/szdata`               | Removed from this local-only L1 package                                                                         |
| Historical 118141/86840 tests depended on discarded fixtures             | Removed; 86840 now has an evidence-free Gold entry instead of a fabricated fixture                              |
| Old Publisher would calculate and persist complex Hop facts              | Removed from the migrated Publisher; legacy Hop files are empty compatibility outputs and their gates are false |
| Consumer could read stale or legacy facts as current L1                  | Current Bundle loader and Task Inspection retain `STALE` / `LEGACY_NOT_L1` fail-closed states                   |
| Package contained release/platform dependencies unrelated to L1          | Reduced package scripts and dependencies to parser runtime, TypeScript, Vitest, tsx and Prettier                |
| Consumer might be mistaken for business closure                          | JSON/HTML explicitly exposes static-only, runtime, business-row and scheduler boundaries                        |

## Evidence checked

- `npm test`: 3 files, 55 tests passed after the Hop and external-refresh boundary fixes.
- `npm run format:check`: passes for the package, README, scope/acceptance/migration/review docs and Gold entry.
- JSON parsing: package, lockfile and current Machine Facts schemas parse successfully; the lockfile's empty root package key is normal npm v3 structure.
- No `node_modules`, `dist`, output, staging, Machine Facts corpus, fixture or cache remains in the target directory.
- No `src/` import points into project scripts; no external command/network connector remains in the migrated L1 scripts.
- Existing f335 surrogate review for Task Inspection is `ACCEPT` for the bounded Reader slice only. No 86840 card is generated here because the required Contract 2.0 input closure is absent.

## Disposition

`ACCEPT` for the requested directory organization, scope/architecture baseline and bounded code migration.

`REWORK` remains the status of the algorithmic L1 Gate: Contract 2.0, exact Schema consultation closure and the real 86840 Gold replay are not implemented or accepted. This distinction is intentional.

## Smallest next action

Freeze the final 86840 SQL plus complete Schema/View dependency closure with hashes, then implement and validate one Contract 2.0 Core Bundle before producing its Reader card. Do not copy old generated facts or promote the old 1.3.0 bundle.
