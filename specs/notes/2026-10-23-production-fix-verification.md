# Production fix execution evidence

**Serves:** STORY-009, STORY-013, STORY-015, STORY-023

Baseline `29e0055`; branch `codex/production-readiness-fix`. Package acceptance in progress.

## Scope and rulings

- Linux-only 0.2.2 candidate. Remote releases checked with `gh release list`; latest public release is 0.2.0. `git ls-remote --tags origin 'refs/tags/v0.2.2*'` returned none. No remote tag/publish performed.
- Managed worktree was read-only under sandbox, so implementation uses a dedicated branch in original checkout. User CSVs untouched.
- Pending intent ownership centralized in native invoke rather than repeated editor-specific code. Durable storage retains only SHA-256 request fingerprint and operation ULID; unknown transport failure keeps intent across reload. Definitive response clears it. Explicit operation IDs supported.
- Atomic per-schedule transaction retains existing schema 7. Transfers keep the existing **single-row transfer model**, rather than adding two rows as wording in plan suggested.
- R2 Windows compatibility remains open: no Windows runner available. Windows/macOS excluded from this candidate's release matrix; no unverified filesystem patch included.
- Existing manual backup/retention policy remains. This package does not introduce auto-backup or sync.
- Cargo jobs limited to 2 after default parallel linking saturated 16GB RAM/swap. Initial superseded runs cancelled, not counted as passing.

## Evidence so far

- Browser regression R1: RED two 50,000 occurrences after advancement error/resume; GREEN atomic rollback leaves zero, resume leaves exactly one.
- Durable intent tests: lost-response retry uses same ULID; next successful independent intent uses a new ULID; explicit ID retained.
- Native command retry: same ID/input returns original transaction; changed amount conflicts.
- Affected browser schedule semantics/native boundary: 116 tests passed before further additions.
- Release gate regression: baseline missing fatal-gate interface failed; new fatal E2E and same-SHA reusable workflow tests pass.
- Node 22.22.3 SQLite binary rebuilt with local matching headers; cached pnpm 10.11.0 used.

## Independent review and fix pass

A fresh read-only reviewer reported six Important findings, no Critical findings
and no minor findings. All six were addressed in one fix pass:

1. Late intent completion could delete a newer pending ID: per-operation storage keys and a deterministic four-call ordering regression.
2. Duplicate receipt hashed derived state: hash original source ID; resolve source/date only on first application inside the receipt.
3. Learned-rule upsert switched create/update receipt command: one stable upsert receipt owns lookup and mutation.
4. Reconciliation recomputed discrepancy on replay and omitted notes: cache full discrepancy/IDs and hash notes; read balance inside transaction.
5. Batch validation preceded receipt replay: state-dependent checks now run inside receipts, including an audit of account create/update, transaction update and debt write-off.
6. Fresh tag supplied zero `event.before` coverage base: choose prior version tag, with repository-root fallback.

Additional command regressions cover changed target IDs and budget copy replay.
Both failed before fixes. Budget copy now includes all allocation writes and its
receipt in one transaction.

## Automated gates

- Node 22.22.3 and pnpm 10.11.0.
- Unit/component coverage after review: **1,163 tests / 131 files pass**;
  statements83.59%, branches76.01%, functions77.07%, lines85.25%.
- Changed-file coverage gate: pass; native client98.95% statements /93.24% branches.
- Type/Svelte check:0 errors, three existing Quick Add CSS warnings.
- Final versioned production browser E2E:159/159 pass; earlier affected rerun14/14 pass.
- Release tooling:14/14 pass with actual child-process access.
- Native full suite:343 pass; final affected schedule/command tests, all-target Clippy with warnings denied and generated bindings check pass.
- First Clippy attempt caught new recurrence helper below test module; moved helper before test module and reran rather than suppressing lint.
- Stryker initial run failed while traversing transient Rust target files. Excluding build outputs, artifact caches and personal CSVs allowed the required DB mutation gate to finish:790 mutants, score88.61%,694 killed,6 timeouts,79 survived,11 uncovered. This is a passed configured gate, not a claim of complete fault detection.

## Package acceptance

Pending actual package smoke, hashes and OS compatibility results. No remote CI,
GitHub release, tag or publication has been claimed.

## Native smoke findings

The actual package exposed a missing `dialog:allow-confirm` permission on both
main and Quick Add windows. A failing capability regression preceded the fix;
release tooling now passes14 tests. Packages were rebuilt after this correction.
Earlier failed screenshots are harness/debug evidence, not acceptance.

The first attempted lost-response hook targeted a read-only Tauri function and
was ineffective. The final harness instead intercepts the runtime callback Map:
the real SQLite commit completes before the success response is routed to the
error callback. No product-side fault injection or financial payload logging was
added.
