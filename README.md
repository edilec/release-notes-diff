# Release Notes Diff

Offline, read-only comparison of **local exported** commit metadata, issue context and release-note entries. It never runs Git, queries an issue tracker, publishes notes, or generates prose. The export must be complete and must give explicit change IDs/categories; missing context stays unknown.

## Run

Node.js 22+, zero dependencies. From this repository:

```sh
node bin/release-notes-diff.mjs --root examples --input passing.json
node bin/release-notes-diff.mjs --root examples --input failing.json
npm run check
```

`--root` confines reads by real path; `--input` is relative within it. Optional `--human` prints one summary to stderr. Stdout is only JSON. No output file is written. Bad arguments/configuration: exit 2, empty stdout. Unreadable/invalid/incomplete evidence: incomplete JSON, exit 2. Evaluated omission or unsupported claim: fail, exit 1. Evaluated agreement: pass, exit 0.

## Export and rules

Top level has `schemaVersion:"1"`, `complete:true`, and `commits`, `issues`, `notes`; each has `complete:true` and `items`. Commits are chronological. A change commit has unique `id`, `kind:"change"`, unique `changeId`, category (`feature`, `fix`, `security`, `docs`, `internal`), `userFacing` boolean, optional ignored `details` string. A revert commit has unique `id`, `kind:"revert"`, and `reverts` naming an **earlier change commit ID**. One revert cancels that change; a replacement must be represented by a separate explicit change commit. Revert-of-revert and multiple reverts of one change are unsupported/incomplete. Issues and notes each have a unique `changeId` and category from the same set. Text is not accepted or generated.

| Condition | Rule / outcome |
| --- | --- |
| Active user-facing change, matching issue, no note | `note-omitted`, fail 1 |
| Note without an active committed change (including reverted change) | `unsupported-claim`, fail 1 |
| Note category disagrees with commit | `category-mismatch`, fail 1 |
| User-facing change or note lacks issue context | `issue-context-missing`, incomplete 2; no fabricated prose |
| Issue category conflicts with commit, invalid/duplicate/revert evidence | incomplete 2 |
| No commits, incomplete export, parser/limit failure | incomplete 2 |

Issue context is required for user-facing changes and notes; internal changes with no notes may have no issue. A referenced revert cancels omission checks for its target. The checker validates only explicit IDs/categories, not whether a prose claim is semantically true. `@export` is the fixed logical source role for the `--input` file; JSON pointers give exact source ordinals. Findings sort by `(location.file, location.pointer, ruleId)` in UTF-16 code-unit order. No raw commit IDs, change IDs, issue titles, note text or host paths are emitted.

## Limits and non-goals

1,048,576 UTF-8 bytes; 100 records in **each** of commits/issues/notes; JSON depth 4 from root depth 0; 5,000 ms on an injectable library clock. Exact N accepted, N+1 incomplete. Strict UTF-8 and duplicate-key rejection (including escaped keys) prevent ambiguous evidence. CLI read has a 5-second abort. No network, Git execution, tracker query, text drafting, publication, or auto-fix.
