# Repository workflow

This repository is commonly used from linked Git worktrees. A worktree does
not share ignored directories such as `node_modules` with its siblings.

Before running project checks, use the npm scripts below. Their `pre*` hooks
automatically install the locked dependencies when the current worktree is
new or incomplete:

- `npm test`
- `npm run typecheck`
- `npm run build`
- `npm run format:check`
- `npm run inspect`

For dependency-only setup, run `npm run prepare:deps`. Do not use `npx` for
project validation, because it can resolve a package outside the lockfile or
hide that the current worktree has not been initialized.

## Task-local projection goldens

`npm run test:task-local-projection` skips TL-6/TL-7 real-Facts goldens unless
sibling `sql-static-lineage-data/field-facts` (or `TASK_LOCAL_GOLDEN_*` roots)
is present. On CI jobs that mount that data pack, set:

```bash
TASK_LOCAL_GOLDEN_REQUIRED=1
```

so missing Facts fail closed instead of silently skipping. Schedule neighbors
on TASK nodes are `scheduleReference` only — not data lineage.
