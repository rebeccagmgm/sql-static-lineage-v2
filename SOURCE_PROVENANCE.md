# Source provenance

This repository has an independent history. It was assembled from two local
source repositories; neither source repository's `.git` directory is copied or
used as this repository's history.

## SQL lineage source

- Repository: `sql-static-lineage`
- Branch at baseline: `fix/wp8-176827-greek-index`
- Commit at baseline: `ef9e322e2dbc4088e712a7a3e9aea459bf661406`
- Source worktree status at baseline: 46 changed or untracked paths
- Status fingerprint (SHA-256 over `git status --porcelain=v1` lines):
  `e0fa9e0e3b6b3219de4a1fdb7b99e78cd7bd5fc34572b743befba6498838fad9`

The initial v2 files were copied from that working tree, so the baseline can
contain useful source changes that were not represented by the commit alone.
The original repository remains the recovery source for its full history.

### Imported after baseline

- `c772a56f1800cbd91016d876b31dc8f13cd07a77` — imported the Machine Facts
  SparkIndex output adaptation (code, schema, and focused tests only).
- `3ae8167ef7294ba19fd449b6c7fe933e6d8fd7d0` — not imported because it only
  removes trailing whitespace from curated documentation.

## Data Graph source

- Repository: `data-graph`
- Branch at baseline: `master`
- Commit at baseline: `ece061ad62b2ff9e516970c48be8aca254601eb8`
- Source worktree status at baseline: clean
- Empty-status fingerprint (SHA-256):
  `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`

Only the current continuation and file-based investigation behavior selected by
this repository's specification is migrated. The old repository remains the
recovery source for excluded historical graph implementations.
