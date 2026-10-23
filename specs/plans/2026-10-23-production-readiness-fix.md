# Production Readiness Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement task-by-task; use superpowers:subagent-driven-development only if the user chooses delegation. Track steps with checkboxes. This document authorizes no implementation or publication by itself.

**Serves:** STORY-009, STORY-013, STORY-015, STORY-023

**Goal:** Đóng các rủi ro dữ liệu R1–R4, rồi tạo release candidate tương thích dữ liệu cho các OS đã được kiểm chứng.

**Architecture:** Đưa toàn bộ posting của một schedule vào một domain operation nguyên tử, thay chuỗi create/markPosted từ JS. Truyền operation ID ổn định xuyên IPC cho các mutation có receipt. Tách filesystem durability theo OS và dùng quality gates của đúng release SHA.

**Tech Stack:** Svelte 5, TypeScript, Tauri v2, Rust/rusqlite, SQLite, Vitest, Playwright, GitHub Actions.

**Spec:** `specs/notes/2026-10-23-production-readiness-review.md` (R1–R5, reproduction, closure và release requirements).

**Status:** Implemented on `codex/production-readiness-fix`; Linux 0.2.2 package acceptance underway. User authorized execution. See the verification record for actual results and deviations; unchecked steps remain unverified or replaced by the rulings below.

## Scope và lựa chọn kiến trúc

- Chọn atomic **per-schedule pass**: một transaction gồm tối đa 24 occurrence và cập nhật schedule. Phù hợp cap hiện có, ít boundary mới, rollback rõ ràng. Lỗi một schedule không rollback schedule khác.
- Không chọn chỉ lưu ngày sau từng create: vẫn có cửa sổ crash giữa hai commit.
- Chưa chọn occurrence ledger/schema mới: với executor tuần tự, đọc schedule hiện tại trong transaction và receipt cho retry đủ đóng lỗi đã thấy. Nếu Task 2 chứng minh chưa đủ, dừng task, ghi counterexample và bổ sung design/migration trước khi làm tiếp.
- Candidate mặc định `0.2.2` nếu vẫn là patch tương thích. Kiểm tra remote versions trước khi bump.
- Chuẩn bị gate đa nền tảng, nhưng chỉ phát hành OS có bằng chứng. Linux là lane nghiệm thu đầu tiên; Windows/macOS không tự được coi là pass.
- R5 giữ nguyên backup thủ công với hướng dẫn rõ ràng. Auto-backup, retention, profile management, sync nằm ngoài phase.

## Global Constraints

- Node **22.22.3**, pnpm **10.11.0** theo `AGENTS.md`; rebuild native dependencies đúng ABI trước khi đọc kết quả tests. Không lấy fallback Node 24 làm release gate.
- Test đỏ trước fix; SQLite thật qua `createTestDb()` hoặc native scratch database. Không mock DB để chứng minh atomicity.
- Tiền là integer smallest currency units; ID dùng ULID utility hiện có.
- Không thêm raw SQL/transaction API vào `AppDatabase`; Rust giữ business transaction boundary.
- Không sửa migration đã phát hành, không giảm manifest/integrity checks. Không mặc định schema bump.
- Không sửa generated Paraglide. Copy mới phải có cả `messages/en.json` và `messages/vi.json`; giữ keyed-locale boundary.
- Bảo toàn bảy CSV untracked được liệt kê trong report; không commit/xóa chúng. Dùng isolated checkout khi triển khai nếu cần; `docs/` là submodule.
- Mỗi task implementation: targeted red/green, rồi `pnpm test` trước commit; TypeScript/Svelte đổi thì thêm `pnpm check`. Chỉ đánh dấu done khi bằng chứng thực tế đạt.
- Không tag/push/publish ở phase viết plan. Khi triển khai, bước publish cần yêu cầu riêng của người dùng.

## Review Focus

1. Commit nhưng mất IPC response: retry cùng intent không tạo thêm hiệu ứng; khác payload bị từ chối — Tasks 1–3.
2. Catch-up lỗi ở occurrence thứ hai: cả pass rollback, restart không lặp kỳ đã ghi — Tasks 2–3.
3. Hai window cùng boot hoặc schedule bị sửa/xóa trước khi job chạy: đọc trạng thái authoritative trong transaction — Tasks 2–3.
4. Export overwrite hoặc restore gặp permission/disk/rename failure: không mất bản nguồn và luôn có trạng thái recovery đúng — Tasks 4, 7.
5. Tag trỏ commit chưa kiểm tra hoặc artifact bị rebuild sau smoke: release phải bị chặn, không dùng evidence cũ — Tasks 5, 7–8.

## File map

| Boundary | Files chính |
| --- | --- |
| Retry intent / IPC | `src/lib/db/client.ts`, `src/lib/db/native/client.ts`, `src/lib/db/native/schedules.ts`, `src-tauri/src/database/commands.rs`, `types.rs`, `receipt.rs` |
| Atomic schedules | `src-tauri/src/database/domains/schedules.rs`, `domains/transactions.rs`, `domains/civil_date.rs`, `src/lib/db/browser/schedules.ts`, `browser/repos/schedules.ts`, `src/lib/logic/post-due-schedules.ts` |
| UI retry owner | `src/lib/stores/transactions.svelte.ts`, `src/lib/components/forms/TransactionForm.svelte`, các mutation call sites và Quick Add theo inventory Task 1 |
| Durability | `src-tauri/src/database/backup.rs`, `restore.rs`, new `durability.rs`, `mod.rs` |
| Gates | `.github/workflows/ci.yml`, `release.yml`, `scripts/release-dogfood.mjs`, `release-dogfood.test.mjs` |
| Verification | `src-tauri/tests/`, `src/tests/unit/native-boundary.test.ts`, `src/tests/unit/schedules/`, `src/tests/e2e/schedules.spec.ts`, `specs/notes/` |

Regenerate `src/lib/native/contracts.generated.ts` bằng tooling. Các path bên dưới tính từ repo root; line numbers baseline chỉ là tham khảo.

### Task 1: Giữ operation ID qua IPC và retry

**Depends:** none. **Closes:** R3 foundation.

**Files:** port/native clients/commands/types ở file map; tests `src/tests/unit/native-boundary.test.ts`, `native-client.test.ts`, new `native-mutation-intent.test.ts`, new `src-tauri/tests/command_idempotency.rs`.

**Interfaces:**
- Add `MutationOptions { operationId?: string }` trong `db/client.ts`; receipt-backed mutation methods nhận optional final `options?: MutationOptions`.
- Native invoke gửi `operationId` bắt buộc; Rust command nhận `operation_id: OperationId`, không tự mint ID. Không có options thì adapter mint ULID cho intent mới; retry caller phải giữ cùng options.
- New `src/lib/native/mutation-intent.ts`: `createMutationIntent(): { operationId: string }`, dùng utility ID có sẵn. Không có retry tự động vô hạn.

- [ ] **Step 1:** Inventory toàn bộ mutation command: receipt-backed, metadata không receipt, lifecycle/file operations; ghi bảng trong note evidence. Áp dụng contract cho mọi receipt-backed domain mutation, không chỉ create transaction. Lifecycle/backup không được quảng cáo có receipt nếu chưa có.
- [ ] **Step 2:** Thay test baseline đang khẳng định “no operation id” bằng tests: cùng options gửi cùng ID; hai intent mới khác ID; malformed ID bị native reject.
- [ ] **Step 3:** Run `pnpm exec vitest run src/tests/unit/native-boundary.test.ts src/tests/unit/native-mutation-intent.test.ts --minWorkers=1 --maxWorkers=2`; thấy fail đúng contract trước fix.
- [ ] **Step 4:** Implement options, native arg và command plumbing; update boundary op fixtures/camelCase arg sets, generated contracts. Không mint lại ID khi retry.
- [ ] **Step 5:** Native command test: call với ID X, bỏ response, gọi lại X/payload cũ → cùng result ID, chỉ một financial effect; X/payload khác → `OperationIdConflict`; Y → intent mới. Cover create, transfer pair và batch; dùng command thật qua harness `command_guards.rs`.
- [ ] **Step 6:** Run targeted Vitest, `cargo test --manifest-path src-tauri/Cargo.toml --test command_idempotency`, `pnpm check:db-contracts`, full pre-commit checks.
- [ ] **Step 7:** Commit with `fix(ipc): preserve mutation ids across retries`.

### Task 2: Atomic native posting của một schedule

**Depends:** Task 1. **Closes:** R1 native.

**Files:** `domains/schedules.rs`, `domains/transactions.rs`, `domains/civil_date.rs`, `types.rs`, `commands.rs`, `src-tauri/src/lib.rs`, `src-tauri/src/bin/export_bindings.rs`; tests `domain_schedules.rs`, new `schedule_posting.rs`, fixtures under `src-tauri/tests/fixtures/`.

**Interfaces:**
- DTO `SchedulePostResult { posted: u32, reminder_due: bool, capped: bool, advanced: bool }` exported to TS.
- Domain `post_due_schedule(connection: &mut Connection, operation_id: OperationId, schedule_id: &str, today: IsoDate) -> DbResult<SchedulePostResult>`.
- Command `schedule_post_due` accepts `operationId`, `id`, `today`; executes one `data_job`.
- Add pure Rust `next_due_date(date: &IsoDate, frequency: &ScheduleFrequency) -> DbResult<IsoDate>` following JS clamping/drift exactly. Shared JSON cases consumed by Rust and JS tests.

- [ ] **Step 1:** Write native regression: expense 50,000, failpoint after first financial write before schedule advancement → zero committed occurrences and unchanged schedule after reopen. Baseline sequence create/markPosted demonstrates failure window.
- [ ] **Step 2:** Add cases: income, two-legged transfer, failure on second catch-up occurrence, same-ID response loss, two distinct-ID requests queued for same due schedule, soft-deleted account, disabled/deleted/completed schedule and stale JS snapshot. Assert one effect per due occurrence and no half transfer.
- [ ] **Step 3:** Run `cargo test --manifest-path src-tauri/Cargo.toml --test schedule_posting`; observe missing operation / regression failures.
- [ ] **Step 4:** Implement one `run_idempotent` transaction: load current schedule and live accounts inside transaction, validate, calculate recurrence, post up to 24, advance/bookkeep, park cap if needed, commit receipt. Due-null reanchors to start; inactive/already-current rows return zero-effect result. No transaction helpers that commit independently inside outer receipt; extract transaction-scoped insert primitive shared with ordinary create.
- [ ] **Step 5:** Preserve current semantics: monthly Jan31→Feb28→Mar28, reminder-only one notice per pass, cap counts financial posts, end date completes, error on one schedule does not prevent later schedules. Failed pass rolls back; orchestration may park it afterward.
- [ ] **Step 6:** Use failpoints only through test/debug mechanisms; IPC cannot arm production failpoints. Check malformed/boundary dates without panic.
- [ ] **Step 7:** Run native schedule/transaction/idempotency suites, shared recurrence corpus and contracts check; full pre-commit checks.
- [ ] **Step 8:** Commit with `fix(schedules): post due transactions atomically`.

### Task 3: Port atomic posting và giữ retry intent trong UI

**Depends:** Tasks 1–2. **Closes:** R1, R3 end-to-end.

**Files:** `db/client.ts`, browser/native schedules adapters, `logic/post-due-schedules.ts`, mutation callers from Task 1 inventory; tests `src/tests/unit/schedules/post-due-schedules.test.ts`, component tests for changed editors, `native-boundary.test.ts`, `src/tests/e2e/schedules.spec.ts` and Tauri mock fixtures.

**Interfaces:** `ScheduleOps.postDue(id: string, today: string, options?: MutationOptions): Promise<SchedulePostResult>`. DTO result matches generated snake_case fields. JS orchestration aggregates results; no separate financial create/markPosted chain.

- [ ] **Step 1:** Adapt report reproduction to atomic behavior: failed pass leaves zero rows; resume yields exactly one 50,000 row. Add browser cases corresponding to Task 2 and assert summary counts reflect committed results only.
- [ ] **Step 2:** Add component test: Save commits, response is ambiguous, retry preserves same intent ID; changing payload starts a new intent. New form/session gets a new ID. Preserve draft and locale behavior.
- [ ] **Step 3:** Run targeted tests to observe failures before implementation.
- [ ] **Step 4:** Implement browser operation with real transaction and same semantics as native, wire new native command, replace JS posting loop. Remove engine reliance on public markPosted plumbing; update/remove obsolete command/fixtures consistently if retired.
- [ ] **Step 5:** Enroll receipt-backed user mutations from inventory in intent ownership. Keep ID with pending draft/action; invalidate when payload changes or operation definitively completes. For reload/close with unresolved intent, persist only necessary pending intent state with bounded lifetime or show explicit reconciliation before resubmit; do not promise retry safety across reload using memory alone. Record chosen behavior and tests.
- [ ] **Step 6:** Update mock E2E surface without treating it as native proof; test resume, reload, duplicate boot and no duplicated transfer. Run `pnpm test:e2e --grep 'scheduled|schedule'` using actual matching test titles; verify nonzero tests selected.
- [ ] **Step 7:** Run affected components, native boundary, whole unit suite and `pnpm check`; contracts/current-source cutover checks pass.
- [ ] **Step 8:** Commit with `fix(schedules): use atomic posting through the domain port`.

### Task 4: Filesystem publication/restore trên Windows và Unix

**Depends:** none; execute after Task 3 to avoid mixing evidence. **Closes:** R2.

**Files:** new `src-tauri/src/database/durability.rs`, `mod.rs`, `backup.rs`, `restore.rs`; tests `backup_restore.rs`, `crash_recovery.rs`, Windows-only tests in new `filesystem_durability.rs`.

**Interfaces:** shared `sync_parent_directory(path: &Path) -> DbResult<()>`; keep stable error envelope at backup/restore boundary. Platform implementation is private; inspect Windows APIs before choosing handle/flush/replace strategy.

- [ ] **Step 1:** Reproduce directory-open failure on Windows from baseline helpers; capture OS, error and test command. Linux cannot certify this task.
- [ ] **Step 2:** Write failing Windows tests for first publication, overwrite, import/export, restore and reopen. Add permission/read-only target, existing destination, source preservation, pre/post-rename interruption tests.
- [ ] **Step 3:** Implement platform-specific directory durability and replacement behavior. Verify `FILE_FLAG_BACKUP_SEMANTICS`, access/share flags and actual flush support; simply adding flag or swallowing errors is not acceptance. Preserve Unix fsync behavior.
- [ ] **Step 4:** Run `cargo test --manifest-path src-tauri/Cargo.toml --test filesystem_durability --test backup_restore --test crash_recovery` on Windows and Linux; source hashes unchanged, valid rollback retained, recovery state correct after faults.
- [ ] **Step 5:** If Windows cannot be verified, leave R2 open and explicitly exclude Windows release lane in Task 5. Do not mark compatibility fixed on a Linux cross-build alone.
- [ ] **Step 6:** Commit with `fix(backup): use platform-aware durable publication`.

### Task 5: Quality gate bắt buộc cho release SHA

**Depends:** code tasks for final green; gate changes can be reviewed independently. **Closes:** R4 tooling.

**Files:** `.github/workflows/ci.yml`, `release.yml`, `scripts/release-dogfood.mjs`, `release-dogfood.test.mjs`; new `scripts/release-gates.test.mjs` if needed.

**Interfaces:** E2E failure is fatal for candidate release. Tag workflow runs or reuses mandatory gates for exactly tagged SHA before build/publish; draft remains true. Per-OS support is explicit matrix/config, not inferred from build success.

- [ ] **Step 1:** Add test injecting nonzero E2E exit: artifact/release step never executes. Baseline `SOFT_GATE_STEPS` must fail this assertion.
- [ ] **Step 2:** Implement fatal E2E gate and tests for failed bindings/Rust/unit gate, version mismatch and dirty checkout. Assert no bypass silently converts failure into success.
- [ ] **Step 3:** Refactor CI checks into reusable workflow or run equivalent mandatory jobs on tag; require success before draft artifacts. Test workflow structure for dependencies and exact checkout ref, then verify with actual CI run at Task 7.
- [ ] **Step 4:** Add Windows native test job for claimed Windows support; macOS job for claimed macOS support. If an OS cannot satisfy native/package acceptance, omit from public candidate and document reason.
- [ ] **Step 5:** Record signing/notarization status honestly; do not equate updater signature with Windows executable signing. Never invent certificates/secrets.
- [ ] **Step 6:** Run `pnpm test:release-tooling`, `node --test scripts/release-gates.test.mjs`, full pre-commit checks; review trigger paths and least required permissions.
- [ ] **Step 7:** Commit with `fix(release): require quality gates for candidate artifacts`.

### Task 6: Integrated verification và review fix

**Depends:** Tasks 1–5. **Produces:** evidence and closure R1–R4 at source level; no package certification yet.

**Files:** report closure table, new `specs/notes/2026-10-23-production-fix-verification.md`, story trace rows in `product/stories/index.md` (link existing stories to this plan; no new product story needed).

- [ ] **Step 1:** Capture tool versions, exact source SHA/base SHA, scoped git status; remove environment ABI mismatch by rebuilding dependencies in isolated supported environment.
- [ ] **Step 2:** Run `pnpm check`, `pnpm test`, `pnpm test:coverage`, coverage gate with explicit PR merge-base via `BASE_SHA`, `pnpm test:e2e`, `pnpm build`.
- [ ] **Step 3:** Run `cargo test --manifest-path src-tauri/Cargo.toml`, `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`, `pnpm check:db-contracts`, `pnpm check:native-db-cutover`, `pnpm test:release-tooling`, `pnpm test:mutation:db` required by dogfood lane.
- [ ] **Step 4:** Get independent review of changed transaction, retry and filesystem boundaries. Fix findings with regressions; rerun affected gates. Record unavailable OS as unavailable, never pass.
- [ ] **Step 5:** Link this plan to STORY-009/013/015/023, run `pnpm test:roadmap`, inspect generated diff and `git diff --check`. Historical stale plans are not new phase completion evidence.
- [ ] **Step 6:** Commit with `docs: record production fix verification`.

### Task 7: Bump candidate và nghiệm thu package cuối

**Depends:** Task 6. **Produces:** versioned candidate, artifact hashes and OS acceptance records. Candidate bump is not publish.

**Files:** `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, package `notchy` entry in `Cargo.lock`; READMEs/release notes; evidence under ignored `artifacts/<candidate-version>/`.

- [ ] **Step 1:** Check remote tags/releases and final scope; choose `0.2.2` only if unused and backward-compatible upgrade remains. If breaking scope emerged, stop for version/scope review.
- [ ] **Step 2:** Bump declared versions consistently using tooling; no global lockfile string replacement. Add release notes including OS support, manual backup policy and downgrade/schema caveats.
- [ ] **Step 3:** Run version consistency tests, full mandatory gates for the versioned commit; `git diff --check`. Commit with `chore: prepare 0.2.2 release candidate` (adjust only if candidate differs).
- [ ] **Step 4:** Build supported packages from clean versioned commit; record SHA, version, schema, OS, build commands and SHA-256 of each artifact. Build alone is not acceptance.
- [ ] **Step 5:** Smoke installed package: fresh install/onboarding; CRUD/income/transfer; schedule catch-up/failure/restart/resume; Quick Add/tray/shortcut; locale/draft persistence; real native file pickers; backup/export/import/restore with source hash and original IDs/balances.
- [ ] **Step 6:** Upgrade from actually published 0.2.1 if available (otherwise latest actual release plus supported old-schema fixture) with nontrivial ledger; verify live migration, rollback snapshot and restart. A preserved package-manager marker is insufficient.
- [ ] **Step 7:** Record per-OS pass/fail with paths/screenshots for destructive cases. If package/code changes, rebuild and repeat affected smoke against new hash. Keep synthetic financial data only.
- [ ] **Step 8:** Commit evidence summary with `docs: record candidate package acceptance`; evidence-only commit may follow candidate code SHA, but show exact relationship. Any tag target must itself pass required CI and produce byte-identified artifacts.

### Task 8: Release decision và bàn giao

**Depends:** Task 7. **Files:** report closure, verification note, release draft metadata.

- [ ] **Step 1:** Fill R1–R4 closure with fix commits, red/green tests, OS evidence and remaining limits; R5 stays documented policy, not falsely “implemented”.
- [ ] **Step 2:** Decision table: Linux eligible only when its gates/package pass; Windows eligible only when Task 4 plus Windows smoke pass; macOS eligible only with its own runtime/distribution evidence. No platform automatically inherits pass.
- [ ] **Step 3:** Confirm zero unresolved P1 in claimed scope, exact-tag-SHA CI green, package version/hash matches smoke, notes/checksums correct. `test:release-smoke` printing checklist is not a passed smoke.
- [ ] **Step 4:** Hand user concrete candidate/version/OS/artifact/evidence and explicit go/no-go. Create tag/push/publish only if user authorizes those actions; no force-push main or overwrite published version.
- [ ] **Step 5:** Final handoff distinguishes code fixed, automated checks, native package evidence and publication status. Mark plan tasks complete only as their deliverables actually land.

## Plan self-review

- R1 → Tasks 2–3; R3 → Tasks 1–3; R2 → Task 4; R4 → Tasks 5–8; R5 → release copy/policy in Task 7.
- Failure classes in Review Focus each have named tests/tasks. Browser/native evidence stays separate.
- Proposed DTO fields and command argument casing are consistent across Tasks 1–3; export via generated contracts.
- No code changes, migrations, version bump or release are performed by writing this plan.
- Implementation should start with Task 1 after plan/design review. Atomic per-schedule transaction, retry ownership across reload and supported release OS are explicit review decisions, not assumed user approvals.

## Execution rulings

- Tasks1–3 share contracts and land as one coherent source commit with version
  and gate changes. The existing single-row transfer representation is preserved.
- RED evidence for the interrupted original posting sequence comes from real
  browser SQLite; native rollback/replay/concurrency are verified separately.
- Task3 intent recovery is centralized at native invoke. Matching unresolved
  requests require explicit native confirmation and support Keep draft. Adapter
  regressions plus actual packaged Svelte UI smoke replace the planned isolated
  component-only test.
- Task4 uses the explicit unavailable-Windows fallback: R2 stays open and
  Windows/macOS packages are excluded. No durability fix is claimed there.
- Remote CI/tag publication is outside this local-package execution. Workflow
  structure is tested locally; exact-tag CI remains required before publishing.
- User CSVs prevent a globally clean checkout; they are excluded from staging and
  all artifacts. Build inputs are tracked source, with the source commit recorded
  at acceptance. This does not relax the scripted clean-checkout release gate.
