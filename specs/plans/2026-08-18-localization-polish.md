# Localization Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clean up the Paraglide message catalogs: delete 12 dead keys, standardize Vietnamese terminology and copy, normalize `errors_*` punctuation, and lock it all in with a catalog-parity unit test.

**Architecture:** All changes are data-only edits to `messages/en.json` / `messages/vi.json` plus one new Vitest unit test that reads both JSON files and enforces the conventions (key parity, placeholder parity, no dead keys, no English "File" in vi, no trailing periods in `errors_*`). Paraglide regenerates `src/lib/paraglide/messages/` via `pnpm check`. No component or store code changes.

**Tech Stack:** Paraglide JS 1.11.8 (pinned), Vitest, plain JSON message files with flat underscore keys.

**Spec:** Self-contained — findings from the 2026-08-18 localization review (this conversation). No separate spec doc.

## Global Constraints

- Message keys are **flat underscore** (`snake_case`), never dotted — Paraglide 1.11.8 rejects dotted IDs.
- Every message edited must be updated in **both** `messages/en.json` and `messages/vi.json` in the same change.
- `{placeholder}` names inside a message must match exactly between en and vi.
- Never hand-edit `src/lib/paraglide/messages/` — regenerate with `pnpm check`.
- Commit prefixes: `fix:`, `test:`, `chore:`. All tests must pass before committing (`pnpm test`).
- Verified safe to delete: the 12 dead keys have **zero** references in `src/`, `src/tests/`, `e2e/`, `scripts/` (checked 2026-08-18). The historical plans that introduced them (`2026-06-29-vietnamese-locale.md`, `2026-07-07-ux-friction-reduction-phase-1.md`, `2026-07-31-reporting-depth.md`) are already executed; current charts use `reports_legend_year_a_income` / `year_b_*` instead.

---

### Task 1: Catalog parity test (failing)

**Files:**
- Create: `src/tests/unit/i18n-messages.test.ts`

**Interfaces:**
- Consumes: `messages/en.json`, `messages/vi.json` (read via `fs`, repo-root relative path)
- Produces: test names `i18n messages > …` used by Tasks 2–4 to verify each fix

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../../../..');
type Catalog = Record<string, string>;
const en: Catalog = JSON.parse(readFileSync(resolve(root, 'messages/en.json'), 'utf8'));
const vi: Catalog = JSON.parse(readFileSync(resolve(root, 'messages/vi.json'), 'utf8'));

const placeholders = (s: string) => (s.match(/\{[a-zA-Z_]+\}/g) ?? []).sort();

// Keys confirmed unreferenced across src/, src/tests/, e2e/, scripts/ on 2026-08-18.
const DEAD_KEYS = [
	'budgets_remaining',
	'dashboard_quick_entry',
	'import_tx_preview_heading',
	'layout_menu',
	'reports_axis_amount',
	'reports_axis_month',
	'reports_legend_expense',
	'reports_legend_income',
	'reports_legend_net_worth',
	'reports_window_12m',
	'reports_window_24m',
	'reports_window_6m',
];

describe('i18n messages', () => {
	it('have identical key sets in en and vi', () => {
		expect(Object.keys(vi).sort()).toEqual(Object.keys(en).sort());
	});

	it('match placeholders between en and vi for every key', () => {
		const mismatches = Object.keys(en)
			.filter((k) => placeholders(en[k]).join(',') !== placeholders(vi[k] ?? '').join(','))
			.map((k) => `${k}: en=${placeholders(en[k])} vi=${placeholders(vi[k] ?? '')}`);
		expect(mismatches).toEqual([]);
	});

	it('contain no known-dead keys', () => {
		expect(DEAD_KEYS.filter((k) => k in en || k in vi)).toEqual([]);
	});

	it('use "Tệp" for "file" in vi — no stray English "File"', () => {
		const offenders = Object.entries(vi)
			.filter(([, v]) => /File/.test(v))
			.map(([k, v]) => `${k}: ${v}`);
		expect(offenders).toEqual([]);
	});

	it('end no errors_* message with a period', () => {
		const offenders = Object.keys(en)
			.filter((k) => k.startsWith('errors_') && (en[k].endsWith('.') || vi[k]?.endsWith('.')))
			.map((k) => `${k}`);
		expect(offenders).toEqual([]);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/tests/unit/i18n-messages.test.ts`
Expected: FAIL — 3 failures: "no known-dead keys" (12 keys listed), "no stray English File" (`import_tx_error_file_too_large`, `import_tx_error_parse`), "no period" (`errors_account_delete_linked_goals`, `errors_unknown`). Key-set and placeholder tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/tests/unit/i18n-messages.test.ts
git commit -m "test: add i18n catalog parity and convention checks"
```

---

### Task 2: Delete dead keys

**Files:**
- Modify: `messages/en.json`, `messages/vi.json` (remove 12 key/value pairs each, listed below)

**Interfaces:**
- Consumes: `DEAD_KEYS` list from Task 1
- Produces: nothing — removal only; no code referenced these keys

- [ ] **Step 1: Remove these exact lines from both files**

```
"budgets_remaining"            (en: "remaining" / vi: "còn lại")
"dashboard_quick_entry"        (en: "Quick entry" / vi: "Nhập nhanh")
"import_tx_preview_heading"    (en: "Preview" / vi: "Xem trước")
"layout_menu"                  (en: "Menu" / vi: "Menu")
"reports_axis_amount"          (en: "Amount" / vi: "Số tiền")
"reports_axis_month"           (en: "Month" / vi: "Tháng")
"reports_legend_expense"       (en: "Expense" / vi: "Chi tiêu")
"reports_legend_income"        (en: "Income" / vi: "Thu nhập")
"reports_legend_net_worth"     (en: "Net worth" / vi: "Tài sản ròng")
"reports_window_12m"           (en: "12 months" / vi: "12 tháng")
"reports_window_24m"           (en: "24 months" / vi: "24 tháng")
"reports_window_6m"            (en: "6 months" / vi: "6 tháng")
```

(Verify each pair matches what's actually in the files before deleting; the en/vi values above are from the 2026-08-18 review.)

- [ ] **Step 2: Regenerate Paraglide output**

Run: `pnpm check`
Expected: exits 0; `src/lib/paraglide/messages/` regenerated (gitignored — no commit needed for it).

- [ ] **Step 3: Run the dead-key test**

Run: `pnpm exec vitest run src/tests/unit/i18n-messages.test.ts -t "dead keys"`
Expected: PASS

- [ ] **Step 4: Run full unit suite**

Run: `pnpm test`
Expected: PASS (nothing referenced the deleted keys; if anything fails, a key was live — restore it and remove it from `DEAD_KEYS` instead)

- [ ] **Step 5: Commit**

```bash
git add messages/en.json messages/vi.json
git commit -m "chore: remove 12 unused i18n message keys"
```

---

### Task 3: Vietnamese copy fixes

**Files:**
- Modify: `messages/vi.json` (5 keys), `messages/en.json` (2 keys — counterparty alignment only)

**Interfaces:**
- Consumes: nothing
- Produces: nothing — string values only; keys, placeholders, and call sites (`src/lib/utils/errors.ts:42-43`, `src/lib/components/forms/AccountForm.svelte:36`) unchanged

- [ ] **Step 1: Apply these exact replacements**

`messages/vi.json`:

| Key | Old (vi) | New (vi) |
|---|---|---|
| `import_tx_error_file_too_large` | `File quá lớn (>10MB). Vui lòng chọn file nhỏ hơn.` | `Tệp quá lớn (>10MB). Vui lòng chọn tệp nhỏ hơn.` |
| `import_tx_error_parse` | `Không thể đọc file CSV. Kiểm tra lại file hợp lệ.` | `Không thể đọc tệp CSV. Hãy kiểm tra lại tệp có đúng định dạng CSV.` |
| `errors_counterparty_required` | `Bên vay là bắt buộc đối với tài khoản vay` | `Đối tác là bắt buộc đối với tài khoản vay` |
| `errors_txn_not_found_deleted` | `Không tìm thấy giao dịch hoặc giao dịch chưa bị xoá` | `Không tìm thấy giao dịch, hoặc giao dịch chưa bị xoá` |
| `transactions_search_placeholder` | `Tìm người nhận, diễn giải...` | `Tìm đối tác, diễn giải...` |

`messages/en.json` (align the two counterparty messages so en and vi stay parallel):

| Key | Old (en) | New (en) |
|---|---|---|
| `validation_counterparty_required` | `Counterparty is required for loans` | `Counterparty is required for loan accounts` |

- [ ] **Step 2: Regenerate Paraglide output**

Run: `pnpm check`
Expected: exits 0

- [ ] **Step 3: Run the File-wording test**

Run: `pnpm exec vitest run src/tests/unit/i18n-messages.test.ts -t "Tệp"`
Expected: PASS

- [ ] **Step 4: Run full unit suite + E2E accounts tests (they assert counterparty validation copy)**

Run: `pnpm test && pnpm test:e2e src/tests/e2e/accounts-extended.spec.ts`
Expected: PASS (E2E matches by test-id/behavior, not the message string — but verify; if a spec asserts the old vi/en string, update that assertion in the same commit)

- [ ] **Step 5: Commit**

```bash
git add messages/en.json messages/vi.json
git commit -m "fix(i18n): standardize vi terminology (Tệp, đối tác) and clarify copy"
```

---

### Task 4: Normalize errors_* punctuation

**Files:**
- Modify: `messages/en.json` (2 keys), `messages/vi.json` (2 keys)

**Interfaces:**
- Consumes: nothing
- Produces: nothing — convention enforced by Task 1's "end no errors_* message with a period" test

- [ ] **Step 1: Remove trailing periods from these exact values**

`messages/en.json`:

| Key | Old (en) | New (en) |
|---|---|---|
| `errors_account_delete_linked_goals` | `Cannot delete account: it is linked to {count} active goal(s): {names}. Delete or unlink the goal first.` | `Cannot delete account: it is linked to {count} active goal(s): {names}. Delete or unlink the goal first` |
| `errors_unknown` | `Something went wrong. Please try again.` | `Something went wrong. Please try again` |

`messages/vi.json`:

| Key | Old (vi) | New (vi) |
|---|---|---|
| `errors_account_delete_linked_goals` | `Không thể xoá tài khoản: đang liên kết với {count} mục tiêu đang hoạt động: {names}. Hãy xoá hoặc bỏ liên kết mục tiêu trước.` | `Không thể xoá tài khoản: đang liên kết với {count} mục tiêu đang hoạt động: {names}. Hãy xoá hoặc bỏ liên kết mục tiêu trước` |
| `errors_unknown` | `Đã xảy ra lỗi. Vui lòng thử lại.` | `Đã xảy ra lỗi. Vui lòng thử lại` |

Internal sentence periods stay; only the final period goes.

- [ ] **Step 2: Regenerate Paraglide output**

Run: `pnpm check`
Expected: exits 0

- [ ] **Step 3: Run the whole i18n test file**

Run: `pnpm exec vitest run src/tests/unit/i18n-messages.test.ts`
Expected: PASS (all 5 tests — Tasks 2–4 fixes all in)

- [ ] **Step 4: Run full suite**

Run: `pnpm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add messages/en.json messages/vi.json
git commit -m "fix(i18n): drop trailing periods from errors_* messages"
```

---

### Task 5: Roadmap rollup refresh

**Files:**
- Regenerate: `specs/STATUS.md` (generated — never hand-edit)

- [ ] **Step 1: Flip this plan's checkboxes as tasks complete**

Each task's steps get `- [ ]` → `- [x]` when its commit lands.

- [ ] **Step 2: Refresh STATUS.md**

Run: `pnpm test:roadmap`
Expected: exit 0, no `⚠ stale`

- [ ] **Step 3: Commit**

```bash
git add specs/plans/2026-08-18-localization-polish.md specs/STATUS.md
git commit -m "docs: mark localization polish plan complete"
```
