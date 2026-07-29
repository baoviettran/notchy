# Roadmap Status Generator — 2026-07-29

## Problem

When asked "what's the roadmap progress / which specs and plans are implemented?", the assistant must re-scan all 16 specs + 12 plans + git history every time. Root cause: **plan checkboxes are never flipped to `[x]` on completion** — every plan shows 0 checked boxes, including just-shipped work. The in-file tracker is dead, so status is re-derived from scratch each query.

## Goals

1. **Single source of truth:** one generated file (`specs/STATUS.md`) that answers "what's implemented?" without re-scanning.
2. **Trustworthy:** the generator self-validates staleness so trusting STATUS.md is safe.
3. **Discipline enforcement:** the generator cross-checks plan checkboxes against git log, surfacing both missed checkboxes and missing commits.
4. **Future-session aware:** CLAUDE.md instructions + memory pointer so future sessions know the workflow exists and use it.

## Success Criteria

- `pnpm test:roadmap` runs, exits 0 (or nonzero with `⚠ stale` if staleness detected), and emits `specs/STATUS.md`.
- STATUS.md contains all 12 plans with correct rollup statuses.
- The test-confidence plan (fully shipped, boxes currently open) shows `implemented-pending-checkbox` with SHAs `a83ad74`/`40facbe`/`89dde52` matched.
- The categorize-rules plan shows its 8 directives matched (scope-agnostic — `feat(db):` matches the `feat(categorize-rules):` directive).
- Stdout prints a condensed table (one row per plan: topic, status, done/total tasks).
- `specs/STATUS.md` is committed to git (provides immediate visibility and historical record).
- `pnpm check` stays green (no TS impact — script is standalone `.mjs`).

## Architecture

### File Layout

| File | Action | Purpose |
| --- | --- | --- |
| `scripts/roadmap.mjs` | create | The generator. Pure Node 22 builtins, ESM. New `scripts/` dir at repo root (none exists yet). Chosen over inline `node -e` (too long, ~150-200 lines) and over `src/scripts/` (would pollute the SvelteKit app graph and imply it ships with the app). |
| `specs/STATUS.md` | create (committed) | Generated rollup output. Committed to provide immediate visibility and historical record. |
| `package.json` | modify | Add `"test:roadmap": "node scripts/roadmap.mjs"`. |
| `CLAUDE.md` | modify | Add `## Spec/Plan Tracking` section after `## Repo Layout`, before `## Gotchas`. |
| memory: `spec-plan-tracking.md` + `MEMORY.md` pointer | create / modify | So future sessions learn the workflow on startup. |

### Why commit STATUS.md?

Committed STATUS.md provides immediate visibility (clone the repo → see roadmap status without running anything), historical record (`git log specs/STATUS.md` shows evolution), and PR review integration (status changes are part of the review). More like `ROADMAP.md` (committed docs) than `coverage/` (build artifact). The timestamp problem is solved by only writing if content actually changed (compare before overwriting).

## Detailed Design

### Inputs

```
plans   = glob('specs/plans/*.md')            # 12 files
specs   = glob('specs/*.md')                   # 16 files
commits = git log --format='%h\t%s'            # newest-first; all reachable from HEAD
specIndex = { topicSlug(specPath): specPath }  # for plan→spec linkage by shared slug
```

### Parsing: `parseTasks(planText)`

Returns `[{headerLevel, number, title, steps[]}]`.

- Split on task headers: regex `/^(#{2,3})\s+Task\s+(\d+):\s*(.+)$/m`. **Both `## Task` and `### Task` occur** (5 plans use h2, 6 use h3 — verified).
- A task's body runs until the next `^#{2,3} Task` header OR a terminal section: `^## (Self-Review|Self-Review Notes|Summary|Acceptance|Out of Scope|Open Questions)`.
- Within a task, collect step checkboxes: `/^- \[([ x])\]\s+\*\*Step\s+(\d+):/` (flush-left, bold-wrapped title — verified syntax). Count open vs done per task.
- Identify each task's **final step** text (for commit-directive extraction below).

### Commit Directive Extraction: `extractCommitSubject(taskFinalStepText)`

Returns `subject | null`. Three directive forms (all verified in-repo):

1. `` Commit with `type: subject` `` — regex `/Commit with\s+`([^`]+)`/`, subject = captured.
2. ```` ```bash\ngit commit -m "type(scope): subject"\n``` ```` — regex `/git commit -m "([^"]+)"/`.
3. Heredoc: `git commit -m "$(cat <<'EOF'\n<subject>\n... EOF )"` — regex `/git commit -m "\$\(cat <<'?EOF'?\n([^\n]+)/`. First line after `EOF` is the subject.

If none match, `directive = null` (task has no commit directive; status falls back to checkbox-only).

### Subject Normalization: `normalizeSubject(subject)`

Returns `{type, scope, body}`.

- Split `type(scope): body` vs `type: body`: `/^(\w+)(?:\(([^)]+)\))?:\s*(.+)$/`.
- Return `{type, scope, body}`. **Matching uses `body` only** (scope-agnostic — the load-bearing correction). If no conventional-prefix match, `body = whole subject`.

### Git Matching: `matchGit(directiveSubject, commits)`

Returns `{sha, additionalMatches}` or `null`.

- `directiveBody = normalizeSubject(directiveSubject).body`
- Iterate commits newest-first; first commit whose `normalizeSubject(commit.subject).body` **contains** `directiveBody` as substring (case-sensitive) wins → record SHA.
- Count further matches → `additionalMatches`. (Multiple matches are informational; most-recent wins.)
- No match → `null`.

### Rollup Status: `rollupStatus(tasks)`

Returns one of five states:

| State | Condition | Meaning |
| --- | --- | --- |
| `planned` | 0 tasks done (no boxes flipped, no commits) | Not started |
| `in-progress` | some tasks done, some not | Partially shipped |
| `implemented` | all tasks: box `[x]` AND commit matched | Fully shipped, disciplined |
| `implemented-pending-checkbox` | all tasks: commit matched, box `[ ]` | Shipped but checkboxes not flipped (backfill debt — **this is the current state of every shipped plan**) |
| `stale` | any task: box `[x]` but NO matching commit | Checkbox flipped without a commit — corruption signal |

The split between `implemented-pending-checkbox` and `stale` is deliberate: they are **opposite** problems (missing checkboxes vs missing commits). Collapsing them would hide the real signal.

### Staleness Self-Validation

Two checks, run after generating fresh state:

1. **Rebased-away SHAs:** if `specs/STATUS.md` already exists on disk, parse every `|\s[0-9a-f]{7}\s|` SHA from it; for each SHA not in current `git log`, emit `⚠ stale: SHA <sha> no longer in history (rebased/amended)`.
2. **Flipped-without-commit:** per plan, if all boxes `[x]` but no matching commits → `⚠ stale: plan <plan> has all boxes flipped but no matching commits`.

Nonzero exit code (`exit(1)`) if any staleness warning fires, so future sessions / CI can detect an untrustworthy rollup. The generator prints `⚠ stale` and tells the user to regenerate.

## STATUS.md Format

Header (auto-generated, do-not-hand-edit banner + regenerate instruction + summary line), then one `## Plan: <topic>` section per plan (sorted newest-first), each with plan path, matched spec path (or `—` if no spec shares the topic slug), rollup status, and a per-task table.

Example rendered from the test-confidence plan (fully shipped, boxes currently open → `implemented-pending-checkbox`):

```markdown
<!-- AUTO-GENERATED by `pnpm test:roadmap` on 2026-07-29T14:51:00Z. Do not hand-edit. -->
<!-- Re-run: pnpm test:roadmap. Source: specs/plans/*.md + git log. -->

# Roadmap Status
Generated: 2026-07-29T14:51:00Z | Plans: 11 | Commits: 231

## Plan: test-confidence-improvement
- Plan: specs/plans/2026-07-27-test-confidence-improvement.md
- Spec: specs/2026-07-27-test-confidence-audit.md
- Status: implemented-pending-checkbox (all commits present, checkboxes not flipped — backfill debt)

| Task | Title | Box | Commit subject | SHA | Status |
| --- | --- | --- | --- | --- | --- |
| 1 | Add a versioned migration-fixture test harness | [ ] (0/6) | test: cover upgrades from released database fixtures | a83ad74 | committed, box open |
| 2 | Establish mutation testing for high-risk domain modules | [ ] (0/7) | test: add mutation checks for financial data logic | 40facbe | committed, box open |
| 3 | Make desktop release verification repeatable | [ ] (0/5) | docs: add desktop release smoke checklist | 89dde52 | committed, box open |
```

The script also prints a condensed table to stdout (one row per plan: topic, status, done/total tasks) so a quick `pnpm test:roadmap` gives the answer without opening the file.

## CLAUDE.md Addition

Exact text, inserted after `## Repo Layout`, before `## Gotchas`:

```markdown
## Spec/Plan Tracking

- To answer "what's the roadmap progress / which specs are implemented," run `pnpm test:roadmap` and read `specs/STATUS.md` — do NOT re-scan plans + git log by hand.
- `specs/STATUS.md` is **generated** (from `specs/plans/*.md` checkboxes + `git log`). Never hand-edit it; re-run `pnpm test:roadmap` to refresh.
- **Checkbox discipline:** when a plan task's commit lands, flip that task's step checkboxes `- [ ]`→`- [x]` in the plan file. A task counts as done only if its box is `[x]` AND git log has the matching commit.
- If `pnpm test:roadmap` prints `⚠ stale`, the rollup can't be trusted — regenerate it before relying on it. Nonzero exit = staleness detected.
```

## Memory

`MEMORY.md` pointer (append one line):
```
- [Spec/Plan tracking workflow](spec-plan-tracking.md) — run pnpm test:roadmap for roadmap progress; read specs/STATUS.md; flip plan checkboxes on commit; STATUS.md generated, don't hand-edit
```

New `spec-plan-tracking.md` (frontmatter: `name`, `description`, `metadata.type: reference`), body covering:
- How to answer roadmap questions (run `pnpm test:roadmap`, read `specs/STATUS.md`, don't re-scan).
- Checkbox discipline: a task is done only when box `[x]` AND matching commit in git log.
- The five status states and what each means (esp. `implemented-pending-checkbox` = backfill debt, `stale` = corruption).
- Generator location (`scripts/roadmap.mjs`) and the three commit-directive forms it parses.
- Matching is scope-agnostic body-substring (plan scope may differ from shipped commit scope — verified).

## Backfill

The generator will report `implemented-pending-checkbox` for every shipped plan (correctly surfacing the debt). **The generator must NOT auto-flip checkboxes** — that would make box state a derived artifact of git and destroy the independent cross-check. Backfill is a manual pass: read matched SHAs in STATUS.md, verify each task shipped, flip `- [ ]`→`- [x]`, re-run to confirm `implemented`. Do this as a follow-up after the generator + CLAUDE.md/memory land. Not part of this spec's deliverables.

## Edge Cases

- **Final step not a commit directive** → `directive: null`; status reflects checkbox-only (box `[x]` alone still counts toward `implemented` only if the plan task genuinely has no commit directive; if it does and the box is `[x]` without a match → `stale`).
- **Scoped vs unscoped subjects** → `normalizeSubject` handles both `type(scope): body` and `type: body`.
- **Squash-merged / amended non-matching subjects** → reports `stale` or `in-progress` (correct — surfaces the gap; the human reconciles).
- **Plan with no spec / spec with no plan** → `Spec: —`; slug collisions list all candidate spec paths.
- **Multiple commits matching one directive** → most-recent SHA wins, `additionalMatches: N` recorded.
- **Self-Review / Summary sections** → `parseTasks` stops at `^## (Self-Review|Self-Review Notes|Summary|Acceptance|Out of Scope|Open Questions)`.

## Verification

1. `pnpm test:roadmap` runs, exits 0 (or nonzero with `⚠ stale` if pre-existing STATUS.md references moved SHAs — but there's no STATUS.md yet on first run, so expect exit 0 + a fresh file).
2. `specs/STATUS.md` is created; contains all 12 plans with correct rollup statuses. The test-confidence plan shows `implemented-pending-checkbox` with SHAs `a83ad74`/`40facbe`/`89dde52` matched. The categorize-rules plan shows its 8 directives matched (scope-agnostic — `feat(db):` matches the `feat(categorize-rules):` directive).
3. Stdout table prints one row per plan.
4. `git ls-files specs/STATUS.md` shows the file is tracked.
5. `pnpm check` stays green (no TS impact — script is standalone `.mjs`).
6. Manual staleness test: introduce a fake SHA into STATUS.md, re-run, confirm `⚠ stale` warning + nonzero exit.
7. Re-read CLAUDE.md — new section is terse and fits the existing style.

## TDD Note

`scripts/roadmap.mjs` is a tooling script, not application code. Per CLAUDE.md's TDD-discipline exception ("Throwaway prototypes, generated code, configuration files"), the script itself is written directly with its parsing/matching logic factored into testable pure functions. Add a small `scripts/roadmap.test.mjs` (Vitest) covering `normalizeSubject`, `extractCommitSubject` (all 3 directive forms), `matchGit` (scope-agnostic substring, multiple-match counting, no-match), and `rollupStatus` (all 5 states). These are pure functions with no DB — fast. This honors the TDD discipline without treating the script as throwaway.
