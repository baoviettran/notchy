# Automatic backup verification

Execution date: 2026-10-28. Source: `codex/automatic-backups`, Notchy 0.2.2, native schema 8 (browser test schema 7). Serves STORY-038. This records Linux acceptance only; it adds no platform, signing or publication claim.

## Installed native acceptance

A current debug RPM was installed only in task-owned Fedora 44 container `notchy-automatic-backup-smoke`, with Xvfb/WebKitWebDriver and synthetic data. `XDG_CONFIG_HOME` and `XDG_DATA_HOME` point inside `artifacts/automatic-backups/native/installed-20261028`; HOME was unchanged. The container mount maps that artifact tree to `/work-artifacts`.

The installed executable, compiled executable and executable before package-only bundling all have SHA-256 `4d5b65e24e16f7224552297d13d1065bc94eec29d370a8a0fcc9ed1959546f2c`. The production frontend and debug executable built successfully. Default RPM compression was stopped after prolonged active CPU use; `pnpm tauri bundle --debug --bundles rpm --config /tmp/notchy-task5-rpm-config.json` then packaged the same binary with temporary RPM `compression: { type: 'none' }`. That package-only command and installation exited 0. This is an installed debug-build check, not an optimized release-package or signing certification. Version and repository packaging configuration were unchanged.

The installed journey used the **actual native clock in the container's UTC zone (+00:00)**, not Asia/Ho_Chi_Minh, a frontend clock override or a failpoint. Offset/calendar-change cases are covered by native clock fixtures. Automatic backup was disabled while legitimate account/transaction commands seeded synthetic income 1,000,000 VND, expense 50,000 VND and transfer 100,000 VND; re-enabling then checking made the dirty ledger due. Observed results:

- Enabled by default; one registered verified copy captured revision 7 on 2026-10-28 (ISO week 2026-W44), at `2026-10-28T07:48:39.985790867+00:00`.
- Native resolved folder: `/work-artifacts/native/installed-20261028/data/com.notchy.app/profiles/01M60QQ2CDR0AESTCFBYC0KHC6/backups`. Published file: `notchy-backup-v8-0.2.2-01M60QQ2XJ6N7TJHHWTGRSFA31.sqlite`; SQLite `integrity_check` returned `ok`, schema metadata was 8.
- Automatic SHA-256: `9f171888d6c9fdd5ee99563fb4c94c5aab9adf9c02847ceb946e34c15ff53be7`. A later same-day write advanced content to revision 8 without advancing backed-up revision 7, timestamp or file bytes. Earliest next eligible date displayed 2026-10-29.
- A real native Space key disabled then enabled the checkbox, with explicit focus before each key and waiting for both the persisted status and control readiness. No DOM click or preference mutation substituted for those keypresses.
- Terminating/reopening the real installed process preserved the timestamp and automatic/manual file hashes. Manual SHA-256: `633cd06d6ece768cfcf857bd05b79c5ee65adce558dfd40a865f53d281c961f2`.
- Restore-as-new created profile `01M60QQ68MC27K8HRNVY9VXFJ1`. All three captured transaction IDs matched exactly; querying the same account IDs returned balances **850000** and **100000** VND. The original profile retained four transactions (including the later write), and the automatic source hash stayed unchanged.

Full IDs, paths, statuses, hashes and result are in [native-results.json](../../artifacts/automatic-backups/native/installed-20261028/evidence/native-results.json). Screenshots: [1200×800 policy](../../artifacts/automatic-backups/native/installed-20261028/evidence/01-installed-policy-1200x800.png), [800×600 keyboard result](../../artifacts/automatic-backups/native/installed-20261028/evidence/02-installed-policy-keyboard-800x600.png), [restored dashboard](../../artifacts/automatic-backups/native/installed-20261028/evidence/03-installed-restored-dashboard.png). Bounded visual review confirmed native path/status text wraps at the supported minimum width and the restored dashboard shows net position 950,000 VND.

Harness-only attempts were preserved: `startup-attempt-without-automation` lacked `TAURI_WEBVIEW_AUTOMATION=true` and never established IPC; `keyboard-attempt-without-refocus` proved publication but stopped because the second keypress lacked focus after the busy control was temporarily disabled. Corrected launcher/harness and successful evidence are under `artifacts/automatic-backups/native/`. No production fault/debug IPC was added.

## Automated evidence

Commands used Node 22.22.3, pnpm 10.11.0 and `/tmp/notchy-sdd-env.sh` in the managed worktree. Native builds used one Cargo job and ran serially with production browser builds after an initial contention incident.

| Gate | Observed result |
| --- | --- |
| `pnpm test` | 148 files, **1,275 passed** |
| `pnpm check` | **0 errors**, 3 existing Quick Add CSS `@apply` warnings |
| `pnpm build` (Tauri before-build command) | Production static frontend built successfully |
| `cargo test --manifest-path src-tauri/Cargo.toml` after compatibility fix | **436 passed**, 0 failed, including **39 automatic-backup tests** |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | Exit 0 |
| `pnpm check:db-contracts` | Exit 0, generated bindings current |
| Production Playwright backup/profile/startup-recovery journeys | 20 discovered: 18 passed initially; both infrastructure-timeout cases passed on isolated serial rerun with zero retries; backup journeys **7/7 passed** |
| `pnpm test:roadmap` | Exit 0; automatic-backups 4/5 pending controller bookkeeping/commit, unrelated incumbent stale plans remain reported |

The initial backup-journey red run executed **5 passed, 2 failed**: new automatic status and warning assertions exposed missing fixture support. A subsequent fixture-session correction preceded green. The final affected browser run had only two profile navigation/context timeouts during concurrent native linking and full swap pressure; rerunning exactly `profiles.spec.ts:96` and `:115` serially passed **2/2** in 19.3 seconds without changing assertions. Browser IPC/virtual files prove the UI contract only, not disk publication or retention.

Native real-SQLite/file tests inject clock and failure points: concurrent publication, committed revision capture, crash/reopen reconciliation, publish/registry/prune failures, stale sessions, clock rollback/offset changes, corrupt targets, restored ownership and schema retention. `pruning_preserves_manual_unregistered_reset_and_upgrade_files` creates twelve clocked real automatic copies, proves pruning occurs, and compares protected manual/unregistered/reset/upgrade bytes unchanged. This is the real-filesystem equivalent of the plan's named manual-copy-preservation assertion; no browser filesystem claim is made. Installed acceptance does not simulate elapsed weeks or backend failures.

Clippy first rejected `Option::is_none_or` (stable since Rust 1.82) against declared MSRV 1.77.2. Integration replaced it with equivalent `map_or(true, ...)`; full Rust tests and all-target Clippy then passed without suppressing the lint or changing MSRV.

Command logs are retained in `artifacts/automatic-backups/verification/`. The roadmap command runs before this task commit; the controller owns final plan checkboxes and regenerated status after independent review. Same-disk snapshots still require an external export for disk-loss protection, and backups run only while Notchy is open with changed content.

## Final review disposition and known follow-up

Final review of `c1b3f1b..0af0c64d` found no Critical or Important issues and assessed the slice ready to merge. Both Minor findings remain explicit:

- **Keyboard retry observability — addressed.** The browser IPC fixture exposes a count of valid-session `backup_automatic_check` invocations. The retry journey records the count before Enter and waits for exactly one additional invocation, alongside the existing warning and prior-success assertions. A temporary test-only listener suppressing Enter activation made the new assertion fail (expected 6, received 5); removing the listener passed the single affected journey with one worker and zero retries. No application or native code changed.
- **Schema-8 revision-trigger semantic validation — deferred nonblocking hardening.** `src-tauri/src/database/manifest.rs:836` currently checks expected trigger names, not their table/event/body. Correct generated migrations and ordinary app operations are unaffected, but an imported or externally edited schema-8 database could contain a misbound/no-op trigger with the expected name. Follow-up: validate expected trigger semantics (or equivalent behavior), with rejection tests for misbound and no-op definitions. This fix wave intentionally does not redesign production validation.

Existing Quick Add CSS, jsdom chart/navigation, mixed-import and color-environment warning noise is unchanged. This test-only follow-up does not require rebuilding or repeating installed native acceptance; its scope and fresh command evidence are recorded in `.superpowers/sdd/2026-10-26-automatic-backups/final-fix-report.md`.

Final scoped re-review accepted commit `12eb98b`: keyboard retry observability is resolved, with no new breakage. Trigger-definition hardening remains the explicitly documented nonblocking follow-up. Runtime sources are unchanged since installed acceptance, and the binary SHA remains identical. All five plan tasks and final review are complete. Full local review/fix reports are retained in `artifacts/automatic-backups/verification/`; the task container is stopped and the branch/worktree remain available for integration.
