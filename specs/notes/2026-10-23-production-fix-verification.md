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
- Release tooling before SDK alignment:14/14 pass; final15-test rerun required with actual child-process access.
- Native full suite:343 pass; final affected schedule/command tests, all-target Clippy with warnings denied and generated bindings check pass.
- First Clippy attempt caught new recurrence helper below test module; moved helper before test module and reran rather than suppressing lint.
- Stryker initial run failed while traversing transient Rust target files. Excluding build outputs, artifact caches and personal CSVs allowed the required DB mutation gate to finish:790 mutants, score88.61%,694 killed,6 timeouts,79 survived,11 uncovered. This is a passed configured gate, not a claim of complete fault detection.

## Package acceptance

Pending actual package smoke, hashes and OS compatibility results. No remote CI,
GitHub release, tag or publication has been claimed.

## Native smoke findings

The actual package exposed a missing `dialog:allow-confirm` permission on both
main and Quick Add windows. The actual native ACL rejection was the RED evidence. A capability-only fix
was insufficient: JS dialog2.2.0 invoked the removed `confirm` command while
Cargo.lock resolved Rust dialog2.7.1. Pinning JS dialog2.7.1 aligns the IPC to
`message`; a new release-tooling regression guards the supported command.
Packages are rebuilt after this correction.
Earlier failed screenshots are harness/debug evidence, not acceptance.

The first attempted lost-response hook targeted a read-only Tauri function and
was ineffective. The final harness instead intercepts the runtime callback Map:
the real SQLite commit completes before the success response is routed to the
error callback. No product-side fault injection or financial payload logging was
added.

## Mutation inventory

The39 receipt-backed commands are enumerated by `MUTATIONS` in
`src/lib/native/invoke.ts`: families are
accounts, transaction single/batch/bulk/duplicate, bucket/tag categories, budget,
goal, rule/learned upsert, debt write-off, reconciliation and schedules including
atomic posting. Every corresponding Rust command requires a client OperationId.
Metadata/preferences, reads and lifecycle commands (initialize, backup, export,
import, restore) are deliberately outside receipt replay. Their existing
filesystem protocols are tested separately; they do not gain financial receipt
semantics from this change.

## Superseded pre-rebase package acceptance

Source3cdf52e was built and passed installed native RPM Fedora44 / DEB Ubuntu24.04
smoke: real commit followed by injected response loss, Keep draft, receipt retry
without duplicate, new intent, Quick Add shortcut/save, schedule replay, SQLite
backup/export/import/restore, CSV export, process restart preserving IDs/balances,
and native file-picker open/cancel/reopen. Both installed binaries matched
643a65688b00469f73b82c064c68cb4c6cc7f6b1e32d6f343a824cb640f7ab9b.
Final SDK-aligned unit1163/1163, affected E2E21/21, tooling15/15 and check0 errors
passed. This acceptance is superseded: user requested rebase onto latest main
with profile management before GitHub publication. No tag or release was pushed.
All artifacts under artifacts/0.2.2 must be rebuilt/retested after integration.

## Latest-main integration (required for publication)

Rebased onto2cf96a3 (merged profile management). Mutation command conflicts retain
both the ProfileSession admission guard and caller OperationId. Atomic schedule
posting now runs through ProfileCoordinator::with_session. Native adapters keep
the bound session and forward mutation options; fingerprints include profileId
but exclude ephemeral generation. Session-expired retry retains its pending key.
Two failing integration regressions preceded the fix and now pass: a lost
response reuses its ID after generation change; another profile gets another ID;
explicit options pass through the session boundary. Targeted boundary132/132,
full unit/component1220/1220 (145 files), check0 errors, full Rust394 tests,
Clippy all-target warnings denied, changed-client coverage100/93.33 and tooling15
pass. Full browser E2E and rebuilt profile-aware native package acceptance remain
in progress. An independent read-only integration review found no Critical or
Important issues. No old package evidence is substituted for the new build.

Native profile-aware acceptance found Quick Add retained firstRunComplete=false
after main completed onboarding without changing the session generation. RED
component regression reproduced disabled input after focus; refreshing profile
settings on focus fixes it. GREEN8/8 Quick Add component tests, full1221 unit
tests, check0 errors, prior full integrated E2E166/166 plus final affected31/31.
The first concurrent E2E/build attempt lost generated assets and was rejected;
the accepted full run used a stable preview. The post-fix affected run similarly
uses a confirmed fresh preview. DB mutation startup range adjusted164–234 after
upstream moved prepareDatabase; mutation gate rerun in progress.
