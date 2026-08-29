# CSV Transaction Import + Dedup — Design
**Serves:** STORY-006

**Date:** 2026-07-06
**Status:** Design (pending implementation plan)
**Branch:** `feat/actual`

## Summary

Add CSV transaction import with an editable column-mapping UI and strict duplicate detection, so users can bulk-load bank-exported transactions instead of entering them by hand. The feature *appends* rows to the current database — it does **not** replace it, and is deliberately named and routed separately from the existing whole-database "Import" in Settings. Inspired by Actual Budget's import pipeline; the dedup pattern is adapted to a strict, safe-default policy.

No new architectural layer. Extends the existing UI → stores → repos → DB stack with two pure utils (parser + inference), one repo batch function, and one store + modal.

## Goals

- Import transactions from a bank-exported CSV into a chosen account, via a preview-then-commit flow.
- Auto-guess the column mapping (date/amount/payee/notes) from header names, including Vietnamese headers, with user override.
- Detect duplicates strictly — same account + date + amount — so re-importing a file (or importing overlapping periods) never writes duplicate rows.
- Keep the riskiest, least-deterministic logic — CSV parsing and column inference — pure and unit-testable with bank-CSV fixtures, no DB or Svelte dependency.
- Reuse the existing transaction layer's validation for the batch write instead of opening a raw-SQL back door.

## Non-goals (explicit YAGNI)

- OFX/QIF/QFX/CSV-CAMT parsers (the mapping UI is reusable when these are added).
- Saved import profiles per account (auto-guess per-import only).
- Fuzzy ±7-day duplicate matching, imported_id exact-match dedup pass, bank transaction id tracking.
- Bank-API sync / open-banking providers.
- Auto-categorization of imported rows. The rules engine (separate spec, `2026-07-06-categorize-rules-engine-design.md`) is a *future* integration point; this spec ships import and rules independently.
- Encoding detection (Windows-1252/Latin-1). UTF-8 assumed; a wrong encoding surfaces as mojibake in preview.

## Decisions (locked during brainstorming)

| Decision | Choice | Rationale |
|---|---|---|
| Format scope | **CSV + column mapping** | One parser path; covers most bank exports; mapping UI reusable for OFX/QIF later |
| Dedup policy | **Strict** (account + date + amount) | Safe default; won't silently drop a real same-week same-amount transaction |
| Review flow | **Preview then commit** | Transparency catches parser/sign mistakes before any write |
| Mapping effort | **Auto-guess, per-import** | Header heuristics ~90% correct; preview catches the rest; saved profiles deferred |
| Architecture | **Approach A** — pure parser util + import store + repo batch insert | Riskiest logic isolated & fixture-testable; no new dependency; reuses existing validation |

## Naming collision (handled)

Notchy's existing Settings "Import" (`importDatabase`) means *replace the entire database*. This feature is the opposite — *append transactions*. To prevent the two blurring in UI and code: this feature is "transaction import", routed through a dedicated modal, and uses an `import_tx_*` i18n key prefix distinct from the existing `settings_backup_import_*` family.

## Architecture

```
ImportTransactionsModal.svelte (UI: file pick → mapping → preview → commit)
  → import.svelte.ts (store: orchestrates parse → infer → dedup → preview → commit)
      ├─→ csv_parse.ts + infer_columns.ts (PURE utils — no deps, like number_parse)
      │     parseCsv(text, opts) → rows[][]; inferColumns(header, sample) → InferredMapping
      ├─→ dedup.ts (PURE: classifyRow — no DB)
      │     classifyRow(candidate, existing[]) → new | duplicate | invalid
      ├─→ transactions.ts (repo: existing listTransactions for dedup candidates
      │                        + new createTransactions(db, inputs[]) batch insert)
      └─→ DatabaseService → SQLite (CHECK constraints enforce expense|income/amount)
```

### Unit responsibilities

| Unit | Responsibility | Depends on | Test approach |
|---|---|---|---|
| `src/lib/utils/csv_parse.ts` | Pure: `(text, {delimiter, hasHeader}) → rows[][]`. RFC-4180-ish (quoted fields, embedded delimiters/newlines, escaped quotes). | Nothing | Pure unit tests with bank-CSV fixtures |
| `src/lib/utils/infer_columns.ts` | Pure: header-name + sample heuristics → which column is date/amount/payee/notes + sign convention + date format. EN + Vi headers. | `number_parse`, date util (pure) | Pure unit tests; deterministic heuristics |
| `src/lib/utils/dedup.ts` | Pure: `classifyRow(candidate, existing[])` → status. | Nothing | Pure unit tests |
| `src/lib/db/repos/transactions.ts` (extended) | Add `createTransactions(db, inputs[])` — batch insert in one transaction, reusing per-row validation. | `DatabaseService` | DB-pattern tests |
| `src/lib/stores/import.svelte.ts` (new) | Orchestrate parse→infer→dedup→preview→commit. Holds `ImportRow[]` with per-row status. | utils + repo | Component/integration |

## Parsing — `src/lib/utils/csv_parse.ts` (pure)

```typescript
export interface CsvParseOptions { delimiter?: string; hasHeader?: boolean; }
export interface CsvParseResult { rows: string[][]; delimiter: string; }
export function parseCsv(text: string, opts?: CsvParseOptions): CsvParseResult;
```

- **Delimiter auto-detect** if not given: comma vs semicolon vs tab by counting which appears most in the first non-quoted line. Vietnamese/European bank CSVs often use `;`.
- **Quoted fields** — `"a,b"` (embedded delimiter), `""` (escaped quote), embedded newlines inside quotes. Naive `split(',')` breaks on any payee with a comma; this must be correct.
- **Encoding** — assumes UTF-8. A wrong-encoding file shows mojibake in preview; user catches it. (Out of scope to detect.)
- **Empty/malformed** — throws a typed `AppError('import_csv_parse_failed')` with row context, not partial garbage.

## Column inference — `src/lib/utils/infer_columns.ts` (pure)

```typescript
export type ColumnRole = 'date' | 'amount' | 'payee' | 'notes' | 'debit' | 'credit' | 'ignore';
export type SignConvention = 'signed' | 'debit_credit_separate';
export interface InferredMapping {
    date: number | null; amount: number | null; payee: number | null; notes: number | null;
    signConvention: SignConvention;
    dateFormat: string | null;          // 'YYYY-MM-DD' | 'DD/MM/YYYY' | 'MM/DD/YYYY'
    amountLocale: string | null;         // inferred from date format, user-overrideable
}
export function inferColumns(header: string[] | null, sampleRows: string[][]): InferredMapping;
```

Header-name heuristics (case-insensitive, multilingual — EN + Vi, since Vi is a primary locale):
- **date** — `date|ngày|trans(action)? date|posting date|time`; sample must parse as a date. Format disambiguated by trying known patterns; DD vs MM resolved by whether any value > 12.
- **amount** — `amount|số tiền|debit|credit|withdrawal|deposit|transaction amount`. If one column has negative values → `signConvention:'signed'`. If two separate debit/credit columns → `'debit_credit_separate'`.
- **payee** — `payee|description|memo|nội dung|người nhận|người chuyển|detail|name`.
- **notes** — secondary description column if present.

### Sign convention — the important detail

Bank CSVs split three ways:
1. One signed `amount` column (expenses negative) → `signed`; amount as-is.
2. Separate `debit`/`withdrawal` and `credit`/`deposit` columns → `debit_credit_separate`; final amount = `credit − debit`; kind = `credit > debit ? income : expense`; stored magnitude positive.
3. One positive `amount` + a direction/type column → rare; not auto-guessed in v1, user fixes in preview.

Amount parsing reuses `parseAmount` (`number_parse.ts`, already locale-aware), so `1.234,56` (Vi/EU) and `1,234.56` (US) both parse. Amount locale inferred from date format (EU date → EU number format), manually overrideable.

The inferred mapping is a **starting point** — every guess is editable in the preview UI. ~90% of files map correctly; the rest the user corrects before commit.

## Dedup engine — `src/lib/utils/dedup.ts` (pure)

Strict: a candidate is a duplicate if an existing non-deleted transaction matches `(account_id, date, amount)` exactly. No fuzzy window.

```typescript
export type RowStatus = 'new' | 'duplicate' | 'invalid';
export interface ClassifyResult { status: RowStatus; duplicateOfId?: string; error?: string; }
export function classifyRow(
    candidate: { accountId: string; date: string; amount: number; kind: 'expense' | 'income' },
    existing: { id: string; accountId: string; date: string; amount: number; kind: string }[]
): ClassifyResult;
```

Two-layer design — pure logic + DB supplies candidates:
- **`classifyRow` is pure** — given candidate + existing candidates, returns status. `invalid` = unparseable amount/missing date (parser flagged these; classify double-checks normalized values).
- **The store does the DB work** — for the whole batch, query existing transactions for the target account over the import's date range **once** (via `listTransactions` with a date filter), then run `classifyRow` against that in-memory set for every row. One range query, O(batch × matchesInWindow) classify — no N queries.

### Match key

- `account_id` — equal (import targets one account the user picks).
- `date` — equal (ISO `YYYY-MM-DD`, normalized from the file's format).
- `amount` — equal as a **magnitude**. Strict dedup compares the stored amount (always positive integer per Notchy convention) regardless of kind: a `$50 expense` and `$50 income` same-day same-account are vanishingly unlikely both legitimate, and if they are, the user unchecks the duplicate flag. Matching kind too would let a genuine duplicate slip if the bank flips sign.

### Edge cases

- **Multiple existing matches** (same amount+date+account already imported twice) → still `duplicate`, matched against the first; not an error.
- **Two rows in the same file matching on the key** (same account + date + amount-magnitude — even if opposite kind) → first is `new`, second is `duplicate` of the first *pending* row. The store tracks pending-to-commit IDs so intra-file dups resolve against not-yet-committed rows. This is the one place the batch matters as a unit, and it uses the same magnitude-only key as cross-file dedup.
- **Refunds/transfers** — out of scope; import produces only expense/income, no conflict with `refund_of_id` or `transfer_pair_id`.
- **Re-importing the same file** → every row matches what was committed → all `duplicate`. This is the safety property the user relies on.

## Preview & commit flow — `import.svelte.ts`

The store holds the entire preview as derived state; the modal is a thin view. One source of truth.

```typescript
type Phase = 'select' | 'mapping' | 'preview' | 'done';
interface ImportRow {
    raw: string[]; date?: string; amount?: number; kind?: 'expense' | 'income';
    payee?: string; notes?: string;
    status: RowStatus; duplicateOfId?: string; included: boolean; error?: string;
}
```

**Phase flow:**
1. **select** — pick file + target account. File read → `parseCsv` → `inferColumns` → `mapping`.
2. **mapping** — editable per-column-role dropdown (date/amount/payee/notes/debit/credit/ignore), sign-convention toggle, date-format + amount-locale overrides. Any change re-runs inference application + re-classifies the preview live (`$derived`). "Looks right" → preview.
3. **preview** — table: date · payee · amount (with income/expense indicator) · status badge (`new` / `duplicate` struck-through / `invalid` red). Duplicates default `included:false`; new default `included:true`; invalid forced `included:false` + disabled. User toggles any. Totals: "42 new · 3 duplicates (auto-skipped) · 1 invalid".
4. **commit** — collect committed rows, call `createTransactions(db, inputs)`, emit existing `transaction:saved` Tauri event (main window + dashboard refresh). → `done`: summary toast, then close.

### Invariants

- **Dedup is advisory, user is sovereign.** A duplicate can be force-included; a new row can be unchecked. **Commit writes rows where `included && status !== 'invalid'`** — force-included duplicates go in, invalid (unparseable) rows never do.
- **Mapping edits re-classify live** — changing amount column or sign convention instantly re-runs `classifyRow` across all rows; preview always reflects current mapping. No stale-preview bug.
- **Atomicity** — `createTransactions` runs in one `db.transaction` (SAVEPOINT). A CHECK violation on row 30 (unreachable since classify guards, but defense-in-depth) rolls back the whole batch; nothing partial written. Error → toast; return to preview.
- **No auto-categorization.** Imported rows get `tag_id:null`. Import↔rules wiring is a later enhancement.
- **Amount sign → kind resolved at mapping time** (not commit): `signed` → negative=expense/positive=income; `debit_credit_separate` → debit=expense/credit=income. Preview shows resolved kind/amount so the user catches sign mistakes before commit.

## Repo — `createTransactions` in `transactions.ts`

```typescript
export async function createTransactions(db: DatabaseService, inputs: NewTransaction[]): Promise<string[]>;
```

- All inserts inside **one `db.transaction` (SAVEPOINT)** — atomic all-or-nothing.
- **Reuses existing validation**, doesn't bypass it: each input runs the same kind/amount/tag/refund checks as `createTransaction`, minus transfer/refund branches (import rows are never those). DB CHECK constraints (amount > 0, kind IN (…), date range) are the final backstop.
- **No `imported_id` column** — strict dedup keys on (account, date, amount), not a bank id. Adding a bank-id column is a later enhancement unlocking Actual-style exact-id dedup.
- Returns the array of created ULIDs.

## Error handling

| Failure | Handling |
|---|---|
| File unreadable / not CSV | `parseCsv` throws `import_csv_parse_failed` → store catches → toast, stay on `select` |
| Wrong encoding (mojibake) | Not detected; shows in preview → user sees garbled payees → cancels, re-saves as UTF-8. Acceptable for v1. |
| All rows invalid / zero new | Preview shows it; commit disabled when `included` count is 0 |
| CHECK-constraint violation at commit | `db.transaction` rolls back whole batch → toast with detail → return to preview (unreachable via classify; defense-in-depth) |
| Partial write (power loss mid-batch) | One transaction = atomic; SQLite all-or-nothing |
| Target account missing/archived | Blocked at `select` — account picker offers only non-archived accounts |
| Existing `transaction:saved` listeners | Reused unchanged — commit emits it; main window + quick-add + dashboard refresh |

## Schema impact — NONE

**No migration, no schema-version bump.** Import writes to the existing `transactions` table with existing columns. The only DB touch is the new `createTransactions` repo function — code, not schema. The schema-version-call-site gotcha does not apply. This makes CSV import the lower-risk of the two v0.x specs.

## i18n

New `import_tx_*` key family in both `messages/en.json` and `messages/vi.json` (flat underscore keys, per Paraglide 1.11.8 pin): file picker labels, mapping controls, status badges (`import_tx_status_new` / `_duplicate` / `_invalid`), totals template, commit/toast strings. Distinct prefix from the existing `settings_backup_import_*` family to avoid the naming collision.

## Testing

Following project TDD discipline (red-green-refactor) and the "do not mock the DB / pure functions" conventions:

- **`csv_parse.test.ts`** (pure) — quoted fields, embedded delimiters/newlines, escaped quotes, `;`/tab delimiters, empty file, malformed (unclosed quote) → throws.
- **`infer_columns.test.ts`** (pure) — EN + Vi headers; signed vs debit/credit-separate detection; date-format disambiguation (DD vs MM); low-confidence cases.
- **`dedup.test.ts`** (`classifyRow`, pure) — new vs duplicate; intra-file dup (second identical = duplicate of pending); multiple existing matches; invalid amounts.
- **`transactions.test.ts`** (extend, DB-pattern with `createTestDb` + `runMigrations`) — `createTransactions` inserts all in one transaction; a constraint-violating input rolls back the entire batch (verify zero rows written after thrown insert).
- **`import.svelte.test.ts`** (store) — phase transitions; mapping edit re-classifies; force-include a duplicate; commit writes only `included && !invalid`; emits `transaction:saved`.
- **E2E** — import a CSV with 3 rows where 1 matches an existing transaction → preview flags the dup, commit writes 2 new. Re-import the same file → all flagged duplicate, commit writes 0.

## Open questions

None at design time. Defaults pinned in the body: **strict** dedup on (account, date, amount-magnitude); `createTransactions` atomic in one SAVEPOINT; commit writes `included && status !== 'invalid'`; EN + Vi header heuristics; no `imported_id` column. The implementation plan may revisit the header-token lists and date-format set, but should treat the above as the baseline.
