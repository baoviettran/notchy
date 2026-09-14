# Rust business-layer fix phase — design

**Status:** Draft — awaiting review
**Date:** 2026-09-14
**Predecessor:** `specs/2026-08-17-rust-database-integrity-boundary-design.md` (implemented, plan closed)
**Trigger:** Code review of `src-tauri/src/database/domains/` (12 files, 3819 lines), cross-checked against the TypeScript reference in `src/lib/db/browser/repos/`.

---

## 1. What this phase is

This is not new design. The Rust database boundary shipped, its plan is 100% closed, `@tauri-apps/plugin-sql` is gone, and the native path is live in production desktop builds. The review found a set of defects that are best understood as **distance between the boundary spec's stated criteria and what actually shipped**.

The boundary spec made these commitments. Each is violated in the shipping build:

| Commitment | Source | Reality |
|---|---|---|
| "Generated TypeScript bindings, or an equivalent checked generation step, are committed and verified in CI so the frontend cannot drift from the native API." | boundary spec, Verification | Types are generated and CI-checked. The **command surface** is checked by nothing. 4 commands the client invokes do not exist in Rust. |
| "Contract tests prove Rust/TypeScript DTO and error-code parity." | boundary spec, Verification | DTO parity yes. **Error-code parity was never wired** — no Rust error code is handled anywhere in `src/lib`. |
| "Every mutating IPC command accepts a client-supplied operation ULID… calling twice with the same ULID must return the first result." | boundary spec, Transaction and idempotency | `commands.rs` generates the ID itself on every call. The client has no concept of an operation ID. |

So the phase has two jobs: **close the gaps the spec already required**, and **fix the correctness defects the review found**. Where the spec and the code disagree about a mechanism, the spec's intent wins; where they disagree about a model (see §7), the shipped model wins and the spec text is corrected.

## 2. Defects in scope

Severity as reviewed. `[V]` = verified empirically, with the evidence noted.

### Critical

**C1 — Four commands the client invokes have no Rust implementation.** `[V]`
`src-tauri/src/lib.rs` registers 74 commands; `src/lib/db/native/client.ts` invokes 78 distinct; the diff is exactly 4, and 0 registered commands are uninvoked (verified by comment-aware parse of `generate_handler![...]` cross-referenced against every `invoke()` site in `src/lib/**`).

| Command | Client site | UI surface |
|---|---|---|
| `transaction_delete_many` | `native/client.ts:151` | bulk delete — `routes/transactions/+page.svelte:203` |
| `transaction_set_tag_many` | `:155` | bulk retag — `:232` |
| `transaction_set_account_many` | `:159` | bulk move — `:239` |
| `transaction_frequent` | `:163` | **the dashboard "Frequent transactions" strip** |

The fourth is the most severe and was **misdiagnosed as dead code during review** — see §8. It is a documented product feature (`README.md:64`, `docs/TECHNICAL_DESIGN.md:1074`) driven by `src/lib/components/sections/FrequentTransactions.svelte:37`, rendered from `routes/+page.svelte:229`. On desktop it does not fail loudly: the component degrades silently by design (`.catch(() => (loadFailed = true))` — *"the strip is an accelerator, never a required surface"*), so the feature simply never appears.

**Why the existing boundary test cannot see this.** `src/tests/unit/native-boundary.test.ts:313-316` already lists all four commands, with their exact command strings and arg keys. But both sides of that assertion are TypeScript: it checks the client against the test's own idea of the contract. Nothing binds the table to `lib.rs`. The table is a third copy of the surface, and it is the only one that is verified.

**C2 — Duplicate `SET transfer_account_id` produces a CHECK violation reported as database corruption.** `[V]`
In `domains/transactions.rs` `update_transaction`, when a patch supplies `transfer_account_id` while changing kind away from transfer, two branches both write the column:

```sql
UPDATE transactions SET updated_at=?, kind=?,
  transfer_account_id = NULL, transfer_pair_id = NULL,   -- existing.kind == Transfer branch
  transfer_account_id = ?                                -- appended, dest_handled == false
WHERE id = ? AND deleted_at IS NULL
```

SQLite applies duplicate SET columns last-wins, so the row ends with `transfer_account_id` populated and `transfer_pair_id` NULL — the exact combination the CHECK in `migrations.rs:296-321` forbids. Reproduced against the real DDL: `IntegrityError: CHECK constraint failed`. Control: the same statement without the appended duplicate is accepted, so the duplicate is the cause.

`map_sqlite_error` (`error.rs:150-171`) maps the unmapped `SqliteFailure` to `ErrorCode::DatabaseCorrupt`, which `mapError` renders as the generic unknown-error string (§3).

**C3 — `debt_write_off` without a tag crashes on desktop.** `[V]`
`native/client.ts:397-398` sends `tagId: tagId ?? ''`; `domains/debts.rs:112-175` takes `tag_id: &str` and inserts it unconditionally. Verified: `tag_id=''` → `FOREIGN KEY constraint failed`; `tag_id='tag_loss'` → accepted. The TypeScript reference defaults to `'tag_loss'` (`browser/repos/debts.ts:57`). Writing off a loan without choosing a tag fails on desktop and succeeds on web.

### Important

**I1 — `report_get_trend` accepts and silently discards `bucket_id`.** `[V]`
`commands.rs:807-811` declares `_bucket_id: Option<String>` and never forwards it; `domains/reports.rs:192-196` has no such parameter. `native/client.ts:431` sends it, and the TypeScript reference implements the filter (`browser/repos/reports.ts:100-103`). A filter that works on web does nothing on desktop.

**I2 — `restore_account` / `restore_goal` place their guard outside the receipt boundary.** `[V]`
`domains/accounts.rs:389-403` runs the `deleted_at IS NOT NULL` pre-check *before* `run_idempotent` at `:407`; `domains/goals.rs:437-449` is identical. A retry cannot return the cached result because the guard rejects first. Both UPDATEs also omit `AND deleted_at IS NOT NULL`, which the TypeScript reference has (`browser/repos/accounts.ts:229`).

**I3 — `delete_account` discards the blocking-goals detail.** `[V]`
`domains/accounts.rs:353-385` returns a bare `InvalidInput` and throws away the goal names it selected. The TypeScript reference throws `AppError('account_delete_linked_goals', { count, names })`, and `mapError` (`src/lib/utils/errors.ts:38-44`) already implements that code **including one/other plural variants**. The rendering side is complete and dead on desktop.

**I4 — `next_month` panics on short input.** `domains/budgets.rs:17-24` indexes `parts[1]` after a split that yields one element for `"2026"`. Reachability of a malformed month was not established; treated as a one-line guard.

**I5 — Amount validation disagrees with the schema.** `[V]`
`validate_money` (`error.rs`) accepts up to `9_007_199_254_740_991`; the schema caps at `999_999_999_999` (`migrations.rs:303`). Everything between is accepted by the business layer and then rejected by SQLite as `DatabaseCorrupt`: verified at `1_000_000_000_000`, `1_400_000_000_000`, and `9_007_199_254_740_991`.

**I6 — Control-character sanitization diverges.** `[V]`
Rust `strip_control_chars` (`domains/transactions.rs:51-58`) uses `char::is_control()` (C0 ∪ C1); `src/lib/utils/sanitize.ts:13` strips only `[\x00-\x1F\x7F]`. Verified by compiling and running the Rust predicate: U+0085, U+0092, U+0007 stripped; `aéb` preserved.

### Suggestion

**S1** — balance CASE SQL duplicated across 5 files (`reports.rs`, `goals.rs`, `debts.rs`, `reconciliations.rs`, `accounts.rs`); the Hinnant constant `719_468` appears in 8 places across 5 files; `deleted_at IS NULL` is hand-written 62 times. `[V]`
**S2** — `kind_filter()` (`reports.rs:52`) and the inline adjustment-tag filter (`:93-106`) are two representations of "what counts as an adjustment" in one file.
**S3** — `src/lib/db/native/reports.ts` is genuinely unimported (verified: every `reports` import resolves to `browser/repos/reports` or the `db/repos` forwarder) and every function throws `'native reports adapter not wired'`. The live path is `native/client.ts:427-451`.
**S4** — N+1 in `reports.rs:605-631` and the equivalent loop in `goals.rs:64-85`.

## 3. Design

### Stage 0 — Contract gates

These land first. They fail immediately and enumerate the work; every later stage is verified against them by construction.

**Gate 1 — command-surface parity.** Extend the existing table-driven test in `src/tests/unit/native-boundary.test.ts` rather than adding a second test. The table already carries a `command` field for every op, so the gate adds one assertion: every `command` in the table must appear in the set parsed from `lib.rs`.

The inverse direction is checked against **all `invoke()` sites in `src/**`**, not against the table — the table only covers commands the db client exposes, and several registered commands (e.g. `quit_app`, `database_restore`) are invoked elsewhere or from Rust. The verified invariant is: every registered command is invoked somewhere, and every invoked command is registered. Both currently hold except for the 4 missing commands.

**Gate 1 MUST also cover arguments, not just names.** Checking names alone leaves the same one-sidedness one level down. The table's `argKeys` is asserted only against the client's own `invoke` call — both sides TypeScript — while Tauri maps camelCase to snake_case across the boundary and nothing binds the two. `native-boundary.test.ts:297` asserts `['accountId', 'date']`; `commands.rs:116-121` declares `account_id, date`. Rename that Rust parameter to `acct_id`, or write one of the four new C1 commands with `tag_ids` where the client sends `tagId`, and every test still passes while the command fails at runtime exactly as the four missing commands do today.

So the same `lib.rs` parse must also extract each command's non-`State` parameters and assert that their camelCase projection equals the table's `argKeys`. If that proves impractical, it may be scoped out — but only by naming the residual risk here, never by leaving it unstated, since an unstated gap reads as coverage.

The parser **MUST fail closed**. An unreadable file, an unfindable `generate_handler![...]` block, unbalanced brackets, or an empty extracted set must throw — never degrade to an empty set that passes.

The parser **MUST be self-tested against a fixture**, including a comment header followed by commands. This is not hypothetical: sizing this work, a first-pass parser that split on commas *before* stripping comments reported 15 missing commands instead of 4, silently, because each `// Account commands` header swallowed the command after it. See §8 for two further instances in the same session.

Comment stripping precedes comma splitting. The scan covers `src/**/*.ts` and `src/**/*.svelte` — a `.ts`-only scan reports `quit_app` as a false orphan.

`FIXTURES[command] ?? null` is removed: an unknown command must fail.

**Gate 2 — error-code parity, enforced by the compiler.** `mapError` is a static switch over browser-layer codes and has no case for any Rust code; a Rust rejection is not an `AppError` and falls through to `errors_unknown()`.

Rather than a test that parses the switch, the Rust codes get a `Record<ErrorCode, (params) => string>`, typed by the generated union in `src/lib/native/contracts.generated.ts`. Exhaustiveness then becomes a **compile error**: adding a Rust error code without a message breaks the build. Codes with no bespoke copy (e.g. `recovery_required`) take an explicit `generic` entry with a comment — a decision, not an accident.

Supporting piece: `toAppError()` in `native/client.ts` converts the `{code, meta}` envelope to `AppError(code, params)`. `meta` is already `BTreeMap<String, String>`, which fits `ErrorParams`, and `mapError` already does `Number(p.count)` for the linked-goals case.

**Dispatch MUST key on origin, not on the code string.** There are 17 Rust codes and 33 browser codes, and exactly one string appears in both: `database_corrupt`. That collision is live — `src/lib/db/index.ts:260` throws `fail('database_corrupt', …)` from the browser/startup path and `RecoveryScreen.svelte:35` renders it. A rule like `code in RUST_ERRORS ? record[code] : switch(code)` would silently route a browser-originated `database_corrupt` through the Rust table, going unnoticed until the two tables diverge. `toAppError()` therefore tags Rust-originated errors (a subclass or marker property) and `mapError` branches on that marker. String-keyed dispatch across two overlapping namespaces is the fragility; a marker removes it structurally.

**The compile-time guarantee is conditional on regeneration.** Verified in sync today (17 generated TS values, 17 Rust `as_str` values, zero diff either direction). But the guarantee only fires *after* `pnpm generate:db-contracts` runs: a developer who adds a Rust error code without regenerating leaves the union stale, the `Record` stays exhaustive over the old union, and the build stays green while the new code falls through to the dispatch. `check:db-contracts` in CI is what closes that, so it is an acceptance criterion (§6), not an implementation detail.

### Stage 1 — Rust source fixes

| Finding | Change |
|---|---|
| C1 | Port 4 commands. `transaction_frequent` is a **read** — no `run_idempotent`, same shape as `transaction_list` — and must reproduce the reference SQL verbatim (§4). The three bulk ops keep the reference loop shape (early return on empty `ids`, then one guarded `UPDATE` per id inside a single transaction), and add no validation beyond the foreign key. |
| C2 | Set `dest_handled = true` in the kind-change branch so the destination is never appended twice. In `map_sqlite_error`, map `SQLITE_CONSTRAINT_CHECK` / `FOREIGNKEY` / `NOTNULL` to `ErrorCode::InvalidInput`. |
| C3 | `debt_write_off` takes `tag_id: Option<String>`, defaulting to `'tag_loss'`, matching `browser/repos/debts.ts:57`. `native/client.ts:398` sends `null`, not `''`. |
| I2 | Move the `deleted_at IS NOT NULL` guard inside the `run_idempotent` closure in both `restore_account` and `restore_goal`; add the predicate to both `UPDATE`s. |
| I4 | Malformed month returns `InvalidInput`. No signature change. |
| I5 | `validate_money` enforces the schema's actual cap (`999_999_999_999`), so the window that currently reaches SQLite and returns `DatabaseCorrupt` is rejected up front as `AmountOutOfRange`. **The bound is a named constant in Rust with a comment naming the migration that encodes it — the migration literal is not changed.** Applied migrations are immutable; interpolating a shared symbol into one would retroactively alter a schema already deployed. Anti-drift is a test that parses the CHECK out of the migration text and asserts it equals the constant, not a shared symbol. |

### Stage 2 — Boundary parity

| Finding | Change |
|---|---|
| I1 | Thread `bucket_id` into `reports::get_trend`; add the `JOIN category_tags` + `ct.type_id = ?` clause mirroring `browser/repos/reports.ts:100-103`. |
| I3 | `delete_account` collects linked goal names and count, returning a new `ErrorCode::AccountDeleteLinkedGoals` with allowlisted `MetaKey`s for `count` and `names` (joined). Regenerating contracts plus Gate 2's `Record` makes the compiler demand the message. **This deliberately widens the error envelope's data class**: the boundary spec forbids envelopes carrying payees, descriptions, or amounts, and is silent on goal names. Goal names are user-authored strings, they are already rendered in the goals list, and they are what makes the message useful — so carrying them is the right call, but it is a decision recorded here rather than an incidental side effect of adding a `MetaKey`. |
| §2 bridge | `toAppError()` + the `Record<ErrorCode, …>`; the browser-code switch is untouched. |
| I6 | Both strip C0 ∪ C1, keeping `\n\r\t`. One shared fixture file read by the TypeScript test *and* a Rust test. |

### Stage 3 — Structural

S1 balance helper + date module · S2 collapse the two adjustment predicates · S3 delete `native/reports.ts` only · S4 the two N+1s. Pure refactor: Gates 1 and 2 are green on entry and green on exit, so a failure here is the refactor and not a behavior change in disguise.

## 4. Reference SQL for `transaction_frequent`

Port this verbatim from `browser/client.ts:133-141`:

```sql
SELECT payee, tag_id, account_id, amount, kind, COUNT(*) as count
FROM transactions
WHERE deleted_at IS NULL AND date >= ? AND payee IS NOT NULL AND kind IN ('expense', 'income')
GROUP BY payee, tag_id, account_id
ORDER BY count DESC, date DESC
LIMIT 5
```

Fidelity caveat: `amount` and `kind` are bare columns under `GROUP BY payee, tag_id, account_id`, so SQLite returns arbitrary rows from each group. The browser layer relies on this; the port must match it rather than "fixing" it, or desktop and web will differ. Worth a comment at the port site, not a behavior change.

## 5. Out of scope — the idempotency seam

The receipts layer (`receipt.rs`) is correct and tested: it looks up `operation_receipts` by operation ID, verifies command kind and request hash, returns the cached result, and raises `OperationIdConflict` on mismatch. Its domain-level tests are real (`tests/idempotency.rs:120`, `tests/domain_accounts_transactions.rs:577`).

But `commands.rs` calls `OperationId::generate()` itself — 30 call sites, one per mutating domain entry point — and neither client sends an ID. **No two IPC calls can ever share an operation ID**, so the receipts table provides no protection in the shipping app, and the spec's acceptance criterion ("IPC-response-loss tests prove operation-ULID retries are idempotent") is unsatisfiable as built.

**This phase does not fix it.** The consumer of an operation ID is a retry, and no mutation retry path exists. Threading an ID through 30 commands changes nothing observable until one does. Implementing the ID half alone yields a live receipts table that nothing queries twice.

It gets its own spec, built alongside the retry path that justifies it. Until then the seam gap is this phase's headline finding, and the correct posture is to leave `receipt.rs` untouched rather than half-wire it.

## 6. Verification

- **Gate 1** fails on entry, enumerating the 4 missing commands; passes only when all 4 exist. Its **parser self-test** — including the comment-header fixture and the malformed-input case that must throw — is part of the acceptance criteria, not just the design: it is the one test standing between this phase and a fourth instance of the scan failures recorded in §8.
- **Gate 1's argument check** fails when a Rust parameter name diverges from the table's `argKeys` (verified by temporarily renaming one).
- **Gate 2** is a compile-time property; `pnpm check:db-contracts` must pass **and** the same command must fail the build when a Rust error code is added without regenerating — otherwise the guarantee is unverified.
- **Gate 2's dispatch** routes a browser-originated `database_corrupt` and a Rust-originated `database_corrupt` to their respective tables, proven by a test that constructs both.
- **Fixtures exist for the four new commands.** Removing `FIXTURES[command] ?? null` means a table command with no fixture now fails rather than degrading to `null`, so the four new entries must be added alongside the ports.
- **IPC-level error mapping** — a Rust-shaped rejection `{code:'account_delete_linked_goals', meta:{count:'1', names:'X'}}` resolves to the singular localized message.
- **C2/C3/I5 regressions** — tests asserting each now yields `InvalidInput`, not `DatabaseCorrupt`. The C2 case is the UPDATE that currently violates the CHECK.
- **I6** — one shared fixture read by both the Rust and TypeScript tests.
- **C1** — `transaction_frequent` returns rows for seeded data; the three bulk ops mutate exactly the selected ids and respect `deleted_at IS NULL`; empty `ids` is a no-op.
- `cargo test` (26 passing at review time) and `pnpm test` green at every stage boundary.

## 7. Spec-text correction applied

`specs/2026-08-17-rust-database-integrity-boundary-design.md:62` read *"Create both sides of a transfer."* The shipped model is a single row — `account_id` source, `transfer_account_id` destination, `transfer_pair_id` identifying the pair — and the schema CHECK enforces it. The line's intent (one atomic command, never two chained calls) is correct and was kept; the wording now describes the single-row model. Corrected in place, since that document is the authority the code is measured against.

## 8. Corrections to the review that produced this phase

Recorded because two of them changed the plan, and all three share one cause.

1. **`getFrequent` was reported as dead code, to be deleted. It is a live dashboard feature.** The conclusion came from a grep for lowercase `frequent` against camelCase symbols (`getFrequent`, `FrequentTransactions`). The scan returned an empty set and was read as a negative. Had it shipped, the phase would have deleted a documented product feature — and the review's own S3 recommendation was the deletion. It is now C1's fourth port target.
2. **The first command-surface parse reported 15 missing commands instead of 4** — it split on commas before stripping comments. The wrong number was briefly treated as the finding.
3. **A `sed` range clipped the `FROM transactions` line** of the reference SQL, briefly suggesting the browser query was malformed.

All three are a scan producing an empty or wrong set that was then read as a fact about the code. That is the same failure shape as `FIXTURES[command] ?? null`, which is why §3 specifies the parser must fail closed and must be fixture-tested rather than trusted. The review's remaining numeric claims (the 74/78 surface diff, the duplication counts, the bulk-op call sites) were re-derived case-exactly after this and confirmed.

## 9. Risks

- **C1's `transaction_frequent` port carries a fidelity caveat** (§4) — bare columns under `GROUP BY`. Matching the browser is correct; diverging silently is not.
- **Stage 3 is the largest diff and has no correctness consumer.** It is the first thing to cut if the phase needs to shrink.
- **The idempotency gap stays open.** Nothing in this phase makes retry-safety real; it only documents why it isn't.
- **Gate 1's argument check is the largest addition to Stage 0** and the most likely to be scoped out under time pressure (Rust parameter parsing is fiddlier than the command list). If it is cut, the residual risk is named in §3 and must be carried into the plan rather than dropped — otherwise the phase ships having closed the command surface while leaving the identical argument-surface gap open.
