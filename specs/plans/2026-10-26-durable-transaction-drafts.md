# Durable Transaction Drafts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Serves:** STORY-039

**Review revision:** 2026-10-26; see [review resolutions](../notes/2026-10-26-plan-review-resolution.md).

**Goal:** Preserve every unfinished transaction capture/edit across normal closing, restart, language changes and profile switches, with no ledger effect until submission.

**Architecture:** Versioned raw editor payloads live in profile SQLite. Native revisions, editor ownership and retired tombstones prevent lost updates; one receipt-backed submit commits the transaction and retires its draft atomically. A Svelte controller flushes edits before lifecycle transitions and exposes pending/error state.

**Tech Stack:** Rust/rusqlite/Tauri v2; Svelte 5 runes/TypeScript; Vitest/Playwright.

**Spec:** `specs/2026-10-26-personal-finance-confidence-design.md`, sections 1–3, 5, 9–11.

## Global Constraints

- Execute after `2026-10-26-automatic-backups.md`; use its approved isolated checkout and content-revision registration seam.
- Node 22.22.3 / pnpm 10.11.0. Tabs/single quotes in TS; runes; ULIDs; integer smallest currency units.
- Native schema becomes 9, browser schema becomes 8 (migration `008_transaction_drafts.ts`). Preserve released migrations and old manifests; confirm versions at execution if upstream changed.
- Preserve raw text, including invalid/incomplete amounts and dates. No age-based draft cleanup. An untouched blank editor creates no draft.
- Stateful editors stay outside `{#key settings.locale}`. Track labels outside that key. New strings go in both locale JSONs; generated Paraglide code is untouched.
- SQLite is the durable store. Do not place new financial payloads in localStorage/sessionStorage; read legacy sessionStorage only for one-time migration.
- No ledger writes before validated submit. Existing retry operation IDs survive ambiguous IPC responses and restore-as-new.
- All monetary effects and draft retirement must share one native transaction. No nested `run_idempotent` transactions.
- Every task follows red → green → verification → commit. Run `pnpm test` before committing; `pnpm check` after TS/Svelte changes, affected Rust tests after native changes. Stage only task files, preserving personal CSVs and the `docs/` submodule.

- Verification must report a nonzero executed-test count and include the newly named behavior. A compile error is a valid initial red state; a successful command selecting zero tests is never green. Run each named integration test target without an unverified substring filter; inspect test discovery/counts before accepting results.

## Review Focus

1. A stale autosave arrives after discard or successful submit: it cannot recreate the draft — Tasks 1–2.
2. An edit draft's original transaction is changed/deleted elsewhere: preserve proposed input and require conflict resolution — Tasks 2 and 5.
3. A session switch starts while the final autosave is pending: native acknowledgment must precede transition acknowledgment — Task 4.
4. An ambiguous save committed before the app closed: reopening discovers its result without posting again — Tasks 2 and 6.
5. Quick Add/Main open the same draft, or a restored profile inherits old ownership: show ownership conflict and permit safe reclaim after process restart/restore — Tasks 1 and 4.

## Files and data contracts

Create `src-tauri/src/database/domains/drafts.rs` for draft CRUD/claims/submission, `src/lib/drafts/types.ts` for the editor-facing contract re-exporting generated native DTOs, `src/lib/drafts/editor.svelte.ts` for autosave state, and browser/native draft adapters under `src/lib/db/{browser,native}/drafts.ts`. Keep browser SQL in `browser/repos/drafts.ts`.

Create tests `src-tauri/tests/domain_drafts.rs`, `src/tests/unit/drafts.test.ts`, `src/tests/unit/draft-editor.test.ts`, `src/tests/unit/components/DraftList.test.ts`, and `src/tests/e2e/drafts.spec.ts`. Reuse `createTestDb()` and existing profile integration harnesses.

DTOs (native uses Rust snake_case fields with camelCase serialization):

```ts
type DraftBaseline = { transaction: Transaction; revision: number };
type DraftPayloadV1 = {
  version: 1; surface: 'full' | 'quick'; mode: 'new' | 'edit';
  transactionId: string | null; baseTransaction: DraftBaseline | null;
  kind: string; amount: string; date: string; accountId: string;
  transferAccountId: string; refundOfId: string; tagId: string;
  payee: string; description: string; quickText: string;
  parsingLocale: string; currency: string;
};
type DraftPayloadEnvelope =
  | { decoding: 'supported'; payloadVersion: 1; payload: DraftPayloadV1 }
  | { decoding: 'unsupported' | 'invalid'; payloadVersion: number | null; rawPayload: string };
type DraftRecord = {
  id: string; revision: number;
  status: 'active' | 'submitted' | 'discarded'; createdAt: string; updatedAt: string;
  submittedTransactionId: string | null;
} & DraftPayloadEnvelope;
type DraftWrite = { id: string; expectedRevision: number; payload: DraftPayloadV1 };
type DraftSubmit = {
  id: string; expectedRevision: number;
  transaction: NewTransaction; baseTransaction: DraftBaseline | null;
};
type DraftSubmitResult = { draftId: string; transactionId: string; revision: number };
```

`DraftOps` on `AppDatabase`: `list(): Promise<DraftRecord[]>`, `get(id: string): Promise<DraftRecord | null>`, `baseline(transactionId: string): Promise<DraftBaseline>`, `claim(id: string): Promise<DraftRecord>`, `release(id: string): Promise<void>`, `upsert(input: DraftWrite, options?: MutationOptions): Promise<DraftRecord>`, `discard(id: string, expectedRevision: number, options?: MutationOptions): Promise<void>`, `submit(input: DraftSubmit, options?: MutationOptions): Promise<DraftSubmitResult>`. Listing returns active drafts only, including unsupported/invalid envelopes; get exposes terminal results for recovery. Decode each record independently: one unknown/malformed payload must not fail the entire list. The editor opens only decoding=supported records; other records allow exact raw export and explicit discard, with no autosave/submit or normalization. Financially invalid fields inside a structurally supported payload remain fully editable. All mutable request hashes include the target ID, expected revision and stable payload. Session generation is authorization, not part of a durable business request hash.

New drafts use client ULIDs and `expectedRevision=0`; native upsert creates/claims them atomically. Existing claims use a native-derived webview label plus process-incarnation token; never accept caller-supplied trusted window identity. Claims are runtime coordination, not permanent ownership after restore. Exact claim persistence mechanism is Task 1's implementation choice, provided stale processes cannot write.

## Task 1: Persist versioned drafts, terminal state and safe ownership

**Files:** Create `src-tauri/src/database/domains/drafts.rs`, `src/lib/db/browser/migrations/008_transaction_drafts.ts`; modify native migrations/manifest/domain registration, browser migration registry, automatic-backup trigger registration; create `src-tauri/tests/domain_drafts.rs`, `src/tests/unit/drafts.test.ts`.

**Interfaces:** Produce DTOs above and native `list_drafts(conn: &Connection) -> DbResult<Vec<DraftRecord>>`, `get_draft(conn: &Connection, id: &str) -> DbResult<Option<DraftRecord>>`, `upsert_draft(conn: &mut Connection, op_id: OperationId, owner: &DraftOwner, input: DraftWrite) -> DbResult<DraftRecord>`. Define `DraftOwner { process_id: String, window_label: String }`; native command derives both. Claim/release/discard use the same owner guard and session boundary.

- [ ] **Step 1: Write failing persistence tests.** Save `amount="1..5tr"`, `date=""`, empty account and arbitrary partial quick text; reopen and assert exact payload equality. Create two IDs and assert both survive. Stale expected revision must reject without overwriting. Discard followed by delayed upsert must remain terminal. A changed default-only field is meaningful; an entirely untouched default payload is filtered by the editor before persistence. Named behavior: `preserves_invalid_input_after_reopen`; decisive assertion: `assert_eq!(reopened.payload, original_payload)` (using that task’s fixture).
- [ ] **Step 2: Run red tests.** `cargo test --manifest-path src-tauri/Cargo.toml --test domain_drafts`; `pnpm exec vitest run src/tests/unit/drafts.test.ts`. Expect missing draft schema/API.
- [ ] **Step 3: Implement native migration/domain.** Add `transaction_drafts` with raw versioned JSON, revision, status, stable submit operation/result metadata and original edit snapshot. Add `transaction_edit_versions` with seeded existing rows and triggers for every insert/update/delete to capture a monotonic version, independent of timestamp granularity. `baseline(transactionId)` reads transaction and version atomically. For new upserts validate the known payload shape/version without normalizing text or applying ledger constraints. For existing stored JSON, decode each row to DraftPayloadEnvelope: preserve exact raw bytes-as-UTF-8 text for unknown/malformed payloads, never rewrite them on list/get and never let one row abort the list. Schema compatibility and payload decodability are separate checks; same-schema unknown payloads remain recoverable. Include client ID and baseline in receipt hashes; old writes cannot resurrect terminal rows. Permit a restarted process/new restored profile to reclaim; refuse concurrent same-draft writers. Add content triggers for payload/status changes, not heartbeat/claim bookkeeping. Manifest validation includes the new table and preserves old snapshots.
- [ ] **Step 4: Verify.** Step 2 commands pass, plus native migrations and profile-backup tests. Add a same-draft two-window claim case and a restore into a new profile with no inherited live owner.
- [ ] **Step 5: Commit.** Run required checks; Commit with `feat(drafts): persist versioned transaction drafts`.

## Task 2: Commit transactions and retire drafts atomically

**Files:** Modify native `database/domains/{drafts,transactions}.rs`, receipt/DTO exports as needed; extend `src-tauri/tests/domain_drafts.rs`, `src-tauri/tests/domain_accounts_transactions.rs`.

**Interfaces:** Consume `DraftSubmit`; produce `submit_draft(conn: &mut Connection, op_id: OperationId, owner: &DraftOwner, input: DraftSubmit) -> DbResult<DraftSubmitResult>`. Reuse `insert_transaction(tx, input)`. Extract existing update body as `pub(crate) fn update_transaction_in(tx: &rusqlite::Transaction<'_>, id: &str, patch: TransactionPatch) -> DbResult<()>`; existing `update_transaction` keeps its outer receipt and delegates.

- [ ] **Step 1: Write failing atomicity/retry tests.** Inject failure between ledger mutation and retirement; assert ledger unchanged and draft active. Submit twice with one operation ID; assert one financial effect, identical result and terminal draft. Reopen before retry. Replay succeeds even after mutable account state changes; new attempts against changed/deleted original edit snapshots return a conflict while retaining the payload. A transaction changed then changed back still conflicts: use a durable edit revision, not timestamp equality alone. Named behavior: `submits_once_after_lost_response_and_reopen`; decisive assertion: `assert_eq!(transaction_count, 1)` (using that task’s fixture).
- [ ] **Step 2: Run red tests.** `cargo test --manifest-path src-tauri/Cargo.toml --test domain_drafts`; expect incomplete atomic-submit behavior.
- [ ] **Step 3: Implement one-transaction submit.** Check receipt replay before state-dependent validation. Compare payload parsing locale/currency and submitted raw fields; validate final `NewTransaction` through existing domain validation. Use Task 1 durable transaction edit revisions so draft baselines cannot miss same-timestamp edits. Freeze expected draft revision, insert/update ledger, store result and retire draft inside the same receipt transaction. Terminal results survive restore-as-new; only replaying a matching request returns success. No new insert on an unresolved edited/deleted original.
- [ ] **Step 4: Verify.** Task command and `cargo test --manifest-path src-tauri/Cargo.toml --test domain_accounts_transactions` pass. Existing non-draft transaction callers still have unchanged financial semantics.
- [ ] **Step 5: Commit.** Run required checks; Commit with `feat(drafts): submit ledger changes and drafts atomically`.

## Task 3: Expose typed ports and browser SQLite parity

**Files:** Create `src/lib/drafts/types.ts`, `src/lib/db/{native/drafts,browser/drafts,browser/repos/drafts}.ts`; modify `src/lib/db/{client,native/client,browser/client}.ts`, `src/lib/native/invoke.ts`, native command exports/registration, `src-tauri/src/database/error.rs`, localized error mapping and both locales; extend native boundary/contracts tests and `src/tests/unit/drafts.test.ts`.

**Interfaces:** Produce `AppDatabase.drafts: DraftOps` above. Register `draft_list`, `draft_get`, `draft_baseline`, `draft_claim`, `draft_release`, `draft_upsert`, `draft_discard`, `draft_submit`. Native command derives `DraftOwner` from trusted runtime; all calls use bound session. Claim/release are ownership coordination; upsert/discard/submit use explicit receipt IDs.

- [ ] **Step 1: Write failing adapter cases.** Use real `createTestDb()` for save/reopen, two drafts, stale update, discard tombstone and submit rollback/replay. Assert mutation invocation carries one operation ID and correct camelCase args. Missing account/category stays in raw payload for repair. Store a version-99 payload and a malformed JSON row beside a supported incomplete draft. List returns all three with independent supported/unsupported/invalid envelopes; exact raw text exports unchanged; the supported draft still opens/submits. Unknown/malformed rows reject autosave/submit but permit explicit discard, preserving terminal recovery metadata. Named behavior: `it('does replay a draft mutation without a second ledger effect')`; decisive assertion: `expect(transactionRows).toHaveLength(1)` (using that task’s fixture).
- [ ] **Step 2: Run red tests.** `pnpm exec vitest run src/tests/unit/drafts.test.ts src/tests/unit/native-boundary.test.ts src/tests/unit/native-client.test.ts`; affected Rust contracts tests must first expose missing commands/DTOs.
- [ ] **Step 3: Implement ports and parity.** Browser adapter uses database transactions and persisted submit result/fingerprint on the draft; it must not mock the database or require native-only receipts. Export native DTOs via existing generation command, add stable localized conflict/unsupported/persistence errors, and regenerate bindings. Add new receipt mutation commands to `invoke.ts` while keeping ownership calls out of financial-intent storage.
- [ ] **Step 4: Verify.** Step 2 commands, `pnpm generate:db-contracts`, `pnpm check:db-contracts`, `pnpm check` and `cargo test --manifest-path src-tauri/Cargo.toml --test contracts` pass.
- [ ] **Step 5: Commit.** Run required checks; Commit with `feat(drafts): expose native and browser draft services`.

## Task 4: Autosave input and flush before lifecycle transitions

**Files:** Create `src/lib/drafts/editor.svelte.ts`; modify `src/lib/profiles/{drafts.svelte,windows,reset-state}.ts`, `src/lib/stores/profiles.svelte.ts`, `src/routes/+layout.svelte`, `src/routes/quick-add/+page.svelte`, native close/tray handling in `src-tauri/src/lib.rs`; create `src/tests/unit/draft-editor.test.ts`; extend profile-draft/window integration tests.

**Interfaces:** Produce `createDraftEditor(db: AppDatabase, session: ProfileSession, initial: DraftPayloadV1, draftId?: string)` exposing `{ id, payload, state, update(payload), flush(): Promise<void>, submit(transaction): Promise<DraftSubmitResult>, discard(): Promise<void>, dispose(): Promise<void> }`. State is `clean | saving | saved | error | conflict | submitting`; create a new ID only for a new logical editor. `flushDurableDrafts(): Promise<void>` is added to the profile/window barrier before current dirty-state acknowledgment.

- [ ] **Step 1: Write failing fake-timer/lifecycle tests.** Autosave after 250 ms of inactivity and on explicit flush; sequential revisions handle typing during save without dropping the newer payload. Failed save must not report saved. Close/profile switch waits for pending acknowledgment; failure blocks transition. Slow responses from profile A cannot change B. Editor teardown cannot clear another draft. Assert leases release only after flush; a conflict preserves local input and permits an explicit copy into a new ID. Named behavior: `it('does wait for the final draft flush before switching profiles')`; decisive assertion: `expect(transitionAcknowledged).toBe(false)` (using that task’s fixture).
- [ ] **Step 2: Run red tests.** `pnpm exec vitest run src/tests/unit/draft-editor.test.ts src/tests/unit/profile-drafts.test.ts src/tests/unit/profile-windows.test.ts src/tests/unit/components/ProfileDraftIntegration.test.ts`.
- [ ] **Step 3: Implement controller and barriers.** Queue writes; snapshot each raw revision and keep one stable operation ID per queued mutation until acknowledged. Use the persisted draft ULID itself as the lifetime `draft_submit` operation ID, distinct from autosave operation IDs; flush the exact final payload before first submit and freeze it until a definitive result. On reopen, get terminal status/result before allowing another submit; matching retries retain that ID. Validation failure before commit writes no receipt and leaves the active draft editable. Flush then freeze the editor; retain unrelated dirty settings' existing discard/cancel flow. Intercept native close and Quick Add hide using an awaited handshake; an unawaited event callback does not prove persistence. Add a bounded handoff state with retry/discard choices, never clear input on timeout. Reuse lifecycle listeners and release all listeners on teardown. Sudden process death only guarantees last native-acknowledged content.
- [ ] **Step 4: Verify.** Step 2 command plus `pnpm check` pass. Test original locale-boundary behavior and pending-submit ownership after cancel/profile switch. No payloads appear in localStorage.
- [ ] **Step 5: Commit.** Run required checks; Commit with `feat(drafts): preserve editors across app transitions`.

## Task 5: Integrate full editor, Quick Add and draft list

**Files:** Modify `src/lib/components/forms/TransactionForm.svelte`, `src/routes/quick-add/+page.svelte`, `src/routes/+layout.svelte`, shared navigation affordances and both locales; create `src/routes/drafts/+page.svelte`, `src/lib/components/drafts/DraftList.svelte`, `src/lib/drafts/legacy.ts`; extend TransactionForm/QuickAdd component tests and create DraftList tests.

**Interfaces:** Consume Task 4 editor and Task 3 DraftOps. Add optional `draftId` prop to TransactionForm; preserve existing transaction-open behavior by fetching an atomic `DraftBaseline` on editor open, and creating an edit draft only after meaningful input. `importLegacyDraft(db: AppDatabase, profileId: string, storage: Storage): Promise<void>` uses a stable generated/imported ID in the original legacy key until acknowledged.

- [ ] **Step 1: Write failing component cases.** Close and reopen an invalid partial draft with original date/account/destination intact. Start another entry and verify both drafts exist. Change locale mid-edit and preserve original amount interpretation. Resume a transaction edit changed elsewhere and require resolve/copy/discard. Legacy valid payload imports once across retry; malformed/unbound payload remains recoverable. Successful Quick Add resets to a fresh editor without recreating its terminal draft. Named behavior: `it('does preserve both drafts when another capture starts')`; decisive assertion: `expect(activeDrafts).toHaveLength(2)` (using that task’s fixture).
- [ ] **Step 2: Run red tests.** `pnpm exec vitest run src/tests/unit/components/TransactionForm.test.ts src/tests/unit/components/QuickAddPage.test.ts src/tests/unit/components/DraftList.test.ts`.
- [ ] **Step 3: Implement the focused UI.** Display raw text/date and validity state, open/create/discard controls, saved/saving/error state and draft count. Ordinary editor close preserves; explicit discard alone deletes active input. Existing invalid/deleted references remain visible with repair choices. Unsupported/invalid envelopes render an isolated recovery row with version/error, exact raw export and explicit discard; they do not mount a live editor or block other drafts. A currency/locale change prompts reinterpretation before ledger submit instead of changing value silently. Import only the currently profile-bound legacy key; preserve unsupported data for user export/recovery. Keep capture outside locale remount boundary; reuse current primitives and tracked labels.
- [ ] **Step 4: Verify.** Step 2 and locale/profile integration tests pass, plus `pnpm check`. Keyboard/screen-reader users can reach list, resume, explicit discard, and conflicts. No redesign of unrelated navigation.
- [ ] **Step 5: Commit.** Run required checks; Commit with `feat(drafts): add resume and manage draft workflows`.

## Task 6: Verify real restart, restore and lost-response submission

**Files:** Create `src/tests/e2e/drafts.spec.ts`, `specs/notes/2026-10-26-draft-verification.md`; extend native profile restore tests, README pair, roadmap and STORY-039 after acceptance.

**Interfaces:** Consume complete drafts slice and automatic backup. Produce evidence that drafts are included in verified profile backup/restore and terminal results do not repost.

- [ ] **Step 1: Add failing journey tests.** Create two incomplete captures and an edit draft, navigate away and back, switch profiles, change locale, resume/discard and submit; verify only confirmed entries affect ledger. Test no draft resurrection after a successful save with a late autosave response. Named behavior: `it('does retain incomplete captures through profile changes')`; decisive assertion: `expect(resumed.amount).toBe(typedAmount)` (using that task’s fixture).
- [ ] **Step 2: Run red journey.** `pnpm exec playwright test src/tests/e2e/drafts.spec.ts src/tests/e2e/profiles.spec.ts src/tests/e2e/quick-add.spec.ts`; distinguish new journey failures from setup errors.
- [ ] **Step 3: Complete native acceptance and docs.** Installed Linux binary in isolated paths: close/reopen, hide Quick Add, two-window claim, restore-as-new with drafts, and injected lost response after native commit. Compare transaction IDs/counts and balances across restart; retry returns same result. Record exact binary/source, commands and evidence. Verify automatic backup revision advances for draft content but not claim heartbeats.
- [ ] **Step 4: Verify gates.** `pnpm test`, `pnpm check`, `pnpm build`, `pnpm check:db-contracts`, `pnpm test:roadmap`, all Rust tests/Clippy, then affected production E2E without concurrent generated-asset builds. Mark STORY-039 shipped only after native acceptance.
- [ ] **Step 5: Commit.** Commit with `test(drafts): verify durable capture and retry recovery`.

## Handoff

Proceed to `specs/plans/2026-10-26-spending-forecast.md`. That plan extends payloads with explicit obligation/reserve links; this slice stores unknown future-version payloads as opaque recovery envelopes safely and makes no premature forecast claims.

## Self-Review

Spec section 5 maps to Tasks 1–5; locale/profile safety and backup recovery map to Tasks 4–6. Atomic edit baselines, lifetime submit ID, late-save tombstones and unsupported payload recovery are explicit. All six tasks have verification/commit steps and no completed checkboxes. Forecast links are versioned in the following plan.
