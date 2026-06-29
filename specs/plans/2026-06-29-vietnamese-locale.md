# Vietnamese Bilingual Locale Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire every user-facing string through Paraglide i18n so the app is fully bilingual (`en` + `vi`) — switching locale flips the entire app, not just the nav.

**Architecture:** Paraglide JS is already configured but unused. Add the missing runtime sync (`setLanguageTag` driven by `settings.locale`), reorganize message keys into feature namespaces, then migrate ~560 hardcoded strings page-by-page (waves), with en + vi written together. Number/currency/date formatting is already locale-aware and only needs verification.

**Tech Stack:** SvelteKit 5, Svelte 5 runes, Paraglide JS (`@inlang/paraglide-js` 1.11.8), Vitest, Tauri v2, SQLite.

## Global Constraints

- **Locales:** `en` (source/default) and `vi`. Source language tag in `project.inlang/settings.json` stays `en`.
- **Default locale:** `'en'`. No OS-locale auto-detection. Locale persists in DB via `meta` (unchanged).
- **Currencies:** `VND` (0 decimals), `USD` (2 decimals). Do not change currency logic.
- **Amounts:** integers in smallest currency unit. No floats.
- **i18n runtime import:** `import * as m from '$lib/paraglide/messages'` (alias `$lib` → `src/lib`). Functions are named exports, e.g. `m.nav_dashboard()`.
- **Regen command (run after editing any `messages/*.json`):** `pnpm exec paraglide-js compile --project ./project.inlang --outdir ./src/lib/paraglide`
- **Key→function naming:** Paraglide sanitizes message keys to valid JS identifiers by replacing non-alphanumeric chars with `_`. A dotted key `nav.dashboard` compiles to function `nav_dashboard`. This is verified in Task 1. **All dotted keys must not collide** — the old flat key `nav_dashboard` (function `nav_dashboard`) and a new `nav.dashboard` (also `nav_dashboard`) would collide, so old flat keys are removed in Task 1 before adding namespaced ones.
- **TDD:** write failing test → watch fail → implement → pass → commit. Run `pnpm test` before every commit.
- **Commit prefix:** `feat:`, `fix:`, `docs:`, `refactor:`, `test:`.
- **Vietnamese quality:** use natural finance terminology (giao dịch, ngân sách, báo cáo, tài khoản, mục tiêu, công nợ, thu/chi, chuyển khoản, hoàn tiền, điều chỉnh), not literal word-for-word.
- **Translation ownership:** implementer writes both en and vi. User reviews the complete `vi.json` at the end.

## File Structure

**Message sources (edited by hand, then compiled):**
- `messages/en.json` — English messages (source)
- `messages/vi.json` — Vietnamese messages
- `project.inlang/settings.json` — Paraglide config (unchanged: already loads empty-pattern + missing-translation linters)

**Compiled (generated — never hand-edit):**
- `src/lib/paraglide/messages.js` + `messages/en.js` + `messages/vi.js` + `runtime.js`

**Runtime sync (new logic):**
- `src/lib/stores/settings.svelte.ts` — add `$effect` + explicit `setLanguageTag` calls

**Pages/components migrated (markup → `m.*()` calls), in wave order:**
- Wave 1 (forms): `src/lib/components/forms/TransactionForm.svelte`, `AccountForm.svelte`, `GoalForm.svelte`
- Wave 2: `src/routes/dashboard/+page.svelte`, `src/routes/transactions/+page.svelte`
- Wave 3: `src/routes/budgets/+page.svelte`, `src/routes/reports/+page.svelte`, `src/routes/goals/+page.svelte`
- Wave 4: `src/routes/accounts/+page.svelte`, `src/routes/debts/+page.svelte`
- Wave 5: `src/routes/settings/+page.svelte`, `src/routes/settings/categories/+page.svelte`, `src/routes/onboarding/+page.svelte`, `src/lib/components/layout/{TopBar,BottomNav,FAB,Sidebar,GlobalToast}.svelte`, `src/routes/+layout.svelte`

**Helpers verified/patched:**
- `src/lib/utils/currency.ts` (`formatCurrency`, `formatNumber`)
- `src/lib/utils/date.ts` (`formatDate`, `formatDateRelative` — move vi literals to message keys)
- `src/lib/utils/number_parse.ts` (Locale type — unchanged)

**Tests:**
- `src/tests/unit/i18n.test.ts` — extend with per-wave assertions

---

## Conventions used by every migration task (Waves 1–5)

Each migration task follows the same loop. This block is the canonical reference; tasks below refer to it rather than repeating verbatim.

### The migration loop (per file)
1. **Inventory:** Read the target `.svelte` file. Collect every user-facing literal string (button text, headings, labels, placeholders, toasts, empty-state messages, `title="..."` attributes, `<p>`/`<span>` text). Ignore non-user strings (CSS classes, `data-*` keys, tag names).
2. **Key + translate:** For each string, add a namespaced key to BOTH `messages/en.json` and `messages/vi.json`. Namespace = feature (`transactions.*`, `budgets.*`, …). Shared words (save/cancel/delete/edit/add/search/amount/date/…) go in `common.*` — check it exists first; if it already exists from an earlier wave, reuse it, do not duplicate.
3. **Regen:** `pnpm exec paraglide-js compile --project ./project.inlang --outdir ./src/lib/paraglide`
4. **Replace markup:** In the `.svelte` file, add `import * as m from '$lib/paraglide/messages';` to `<script lang="ts">`, then replace each literal with its function call `m.<namespace>_<key>()`. For interpolated strings use params: `m.transactions_paid_to({ name })`.
5. **Test:** add one `it(...)` to `src/tests/unit/i18n.test.ts` asserting the new feature's representative vi string (see "Representative test" below).
6. **Verify + commit:** `pnpm test` green → commit.

### Vietnamese translation conventions (apply consistently)
- Expense/Income/Transfer/Refund/Adjustment → Chi tiêu / Thu nhập / Chuyển khoản / Hoàn tiền / Điều chỉnh
- Account types: Checking → Tài khoản thanh toán, Savings → Tài khoản tiết kiệm, Cash → Tiền mặt, Credit Card → Thẻ tín dụng, Loan to Person → Cho vay cá nhân, Loan from Person → Vay cá nhân
- Goal types: Savings → Tiết kiệm, Debt Payoff → Trả nợ, Net Worth → Tổng tài sản
- Assets/Liabilities → Tài sản / Nợ phải trả
- Active/Completed/Archived → Đang hoạt động / Đã hoàn thành / Đã lưu trữ
- Add/Edit/Delete/Save/Cancel → Thêm / Sửa / Xoá / Lưu / Huỷ
- Empty states: "No transactions found." → "Không có giao dịch nào." ; "No data for this month." → "Chưa có dữ liệu trong tháng này."
- Toasts past-tense: "Transaction duplicated." → "Đã nhân bản giao dịch." ; "Account archived." → "Đã lưu trữ tài khoản."
- Reuse these exact terms across all waves so the corpus is consistent.

### Representative test (per wave)
Add to `src/tests/unit/i18n.test.ts`, one `it` per feature migrated that wave:

```ts
import * as m from '$lib/paraglide/messages';
import { setLanguageTag } from '$lib/paraglide/runtime';

describe('localized messages', () => {
	it('renders <FEATURE> strings in vi', () => {
		setLanguageTag('vi');
		expect(m.<namespace>_<key>()).toBe('<expected vi string>');
		setLanguageTag('en'); // restore
	});
});
```
Replace `<FEATURE>`, `<namespace>_<key>`, `<expected vi string>` with a real key/string from that wave (e.g. for transactions: `m.transactions_empty_state()` → `'Không có giao dịch nào.'`).

---

## Task 1: Plumbing — runtime sync + namespaced keys (Wave 0)

**Files:**
- Modify: `messages/en.json`, `messages/vi.json`
- Modify: `src/lib/stores/settings.svelte.ts`
- Modify (regenerated): `src/lib/paraglide/*`
- Test: `src/tests/unit/i18n.test.ts`

**Interfaces:**
- Produces: `import * as m from '$lib/paraglide/messages'` (named exports, dotted keys compiled to `_`); `setLanguageTag` from `$lib/paraglide/runtime`. All later tasks consume these.

- [ ] **Step 1: Write the failing test**

Append to `src/tests/unit/i18n.test.ts`:

```ts
import * as m from '$lib/paraglide/messages';
import { setLanguageTag } from '$lib/paraglide/runtime';

describe('paraglide runtime sync', () => {
	it('returns vi string after setLanguageTag(vi)', () => {
		setLanguageTag('vi');
		expect(m.nav_dashboard()).toBe('Tổng quan');
		setLanguageTag('en'); // restore for other tests
	});

	it('returns en string by default', () => {
		setLanguageTag('en');
		expect(m.nav_dashboard()).toBe('Dashboard');
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/tests/unit/i18n.test.ts`
Expected: FAIL — `m.nav_dashboard` currently returns `'Dashboard'` even after `setLanguageTag('vi')` because `vi.json` value is the source `Dashboard`-style literal OR the dotted-key function name differs. (This step confirms current behavior and that `setLanguageTag` plumbing exists but vi content for the namespaced key is absent.)

- [ ] **Step 3: Rewrite message files with namespaced keys**

Overwrite `messages/en.json`:

```json
{
	"$schema": "https://inlang.com/schema/inlang-message-format",
	"app.name": "Notchy",
	"nav.dashboard": "Dashboard",
	"nav.transactions": "Transactions",
	"nav.budgets": "Budgets",
	"nav.reports": "Reports",
	"nav.accounts": "Accounts",
	"nav.goals": "Goals",
	"nav.debts": "Debts",
	"nav.settings": "Settings",
	"common.save": "Save",
	"common.cancel": "Cancel",
	"common.delete": "Delete",
	"common.edit": "Edit",
	"common.add": "Add",
	"common.undo": "Undo",
	"common.search": "Search",
	"common.amount": "Amount",
	"common.date": "Date",
	"common.description": "Description",
	"common.name": "Name",
	"common.none": "— None —",
	"common.optional": "Optional",
	"common.today": "Today",
	"common.yesterday": "Yesterday",
	"onboarding.choose_language": "Choose your language",
	"onboarding.choose_currency": "Choose your currency",
	"onboarding.create_account": "Create your first account",
	"onboarding.continue": "Continue",
	"onboarding.finish": "Finish setup",
	"lang.english": "English",
	"lang.vietnamese": "Tiếng Việt"
}
```

Overwrite `messages/vi.json` with the same keys, vi values:

```json
{
	"$schema": "https://inlang.com/schema/inlang-message-format",
	"app.name": "Notchy",
	"nav.dashboard": "Tổng quan",
	"nav.transactions": "Giao dịch",
	"nav.budgets": "Ngân sách",
	"nav.reports": "Báo cáo",
	"nav.accounts": "Tài khoản",
	"nav.goals": "Mục tiêu",
	"nav.debts": "Công nợ",
	"nav.settings": "Cài đặt",
	"common.save": "Lưu",
	"common.cancel": "Huỷ",
	"common.delete": "Xoá",
	"common.edit": "Sửa",
	"common.add": "Thêm",
	"common.undo": "Hoàn tác",
	"common.search": "Tìm kiếm",
	"common.amount": "Số tiền",
	"common.date": "Ngày",
	"common.description": "Diễn giải",
	"common.name": "Tên",
	"common.none": "— Không —",
	"common.optional": "Tuỳ chọn",
	"common.today": "Hôm nay",
	"common.yesterday": "Hôm qua",
	"onboarding.choose_language": "Chọn ngôn ngữ",
	"onboarding.choose_currency": "Chọn đơn vị tiền tệ",
	"onboarding.create_account": "Tạo tài khoản đầu tiên",
	"onboarding.continue": "Tiếp tục",
	"onboarding.finish": "Hoàn tất",
	"lang.english": "English",
	"lang.vietnamese": "Tiếng Việt"
}
```

- [ ] **Step 4: Regenerate compiled messages**

Run: `pnpm exec paraglide-js compile --project ./project.inlang --outdir ./src/lib/paraglide`
Expected: compiles with no errors. Verify the function name produced for key `nav.dashboard`:

Run: `grep -n "nav_dashboard\|nav.dashboard" src/lib/paraglide/messages.js`
Expected: shows `export const nav_dashboard = (params = {}, options = {}) => {` — confirms dotted key `nav.dashboard` compiles to function `nav_dashboard`. If the function name differs (e.g. `nav_dot_dashboard`), adjust the test in Step 1 and all later tasks to use the actual sanitized name. **Record the confirmed name here: `nav_dashboard`.**

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test src/tests/unit/i18n.test.ts`
Expected: PASS — `m.nav_dashboard()` returns `'Tổng quan'` after `setLanguageTag('vi')`.

- [ ] **Step 6: Add runtime sync to SettingsStore**

In `src/lib/stores/settings.svelte.ts`, add the import and reactive sync. The full updated file:

```ts
import { getDb } from '$lib/db';
import * as meta from '$lib/db/repos/meta';
import type { Locale } from '$lib/utils/number_parse';
import { setLanguageTag } from '$lib/paraglide/runtime';

class SettingsStore {
	locale = $state<Locale>('en');
	currency = $state('VND');
	firstRunComplete = $state(false);
	theme = $state<'auto' | 'light' | 'dark'>('light');

	constructor() {
		// Keep Paraglide's active locale in sync with the persisted locale.
		$effect(() => {
			setLanguageTag(this.locale);
		});
	}

	async load(): Promise<void> {
		const db = await getDb();
		this.locale = (await meta.getLocale(db)) as Locale;
		setLanguageTag(this.locale);
		this.currency = await meta.getCurrency(db);
		this.firstRunComplete = await meta.isFirstRunComplete(db);
		this.applyThemeClass();
	}

	async setLocale(locale: Locale): Promise<void> {
		const db = await getDb();
		await meta.setMeta(db, 'locale', locale);
		this.locale = locale;
		setLanguageTag(locale);
	}

	async setCurrency(currency: string): Promise<void> {
		const db = await getDb();
		await meta.setMeta(db, 'currency', currency);
		this.currency = currency;
	}

	async completeOnboarding(): Promise<void> {
		const db = await getDb();
		await meta.setMeta(db, 'first_run_complete', '1');
		await meta.setMeta(db, 'onboarding_step', 'complete');
		this.firstRunComplete = true;
	}

	setTheme(theme: 'auto' | 'light' | 'dark'): void {
		this.theme = theme;
		this.applyThemeClass();
	}

	private applyThemeClass(): void {
		if (typeof document === 'undefined') return;
		document.documentElement.classList.remove('light', 'dark');
		if (this.theme !== 'auto') document.documentElement.classList.add(this.theme);
	}
}

export const settings = new SettingsStore();
```

> Note on `$effect` in a class constructor: Svelte 5 runes `$effect` registers against the nearest reactive root. In this class-field style it tracks `this.locale`. If `pnpm check` reports the `$effect` cannot run outside a component context, instead expose a `syncLocale()` method calling `setLanguageTag(this.locale)` and call it from `+layout.svelte` `onMount` after `settings.load()`. Prefer the `$effect` form first; fall back only if `pnpm check` errors.

- [ ] **Step 7: Run typecheck + tests**

Run: `pnpm check`
Expected: no errors (or apply the fallback noted above).
Run: `pnpm test`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add messages/en.json messages/vi.json src/lib/paraglide src/lib/stores/settings.svelte.ts src/tests/unit/i18n.test.ts
git commit -m "feat(i18n): add runtime locale sync and namespaced message keys"
```

---

## Task 2: Migrate forms (Wave 1)

Migrate the three form components. These define `forms.*` and `validation.*`, used by all pages.

**Files:**
- Modify: `messages/en.json`, `messages/vi.json`
- Modify: `src/lib/components/forms/TransactionForm.svelte`, `AccountForm.svelte`, `GoalForm.svelte`
- Modify (regenerated): `src/lib/paraglide/*`
- Test: `src/tests/unit/i18n.test.ts`

**Interfaces:**
- Consumes: `common.*` from Task 1 (save/cancel/name/date/amount/optional/none).
- Produces: `forms.*` (type labels + field labels), `validation.*` (error messages). Later pages that embed these forms need no extra work — the components self-translate.

- [ ] **Step 1: Write the failing test**

Append to `src/tests/unit/i18n.test.ts`:

```ts
describe('form messages', () => {
	it('renders transaction type labels in vi', () => {
		setLanguageTag('vi');
		expect(m.forms_expense()).toBe('Chi tiêu');
		expect(m.forms_transfer()).toBe('Chuyển khoản');
		setLanguageTag('en');
	});

	it('renders validation messages in vi', () => {
		setLanguageTag('vi');
		expect(m.validation_name_required()).toBe('Tên là bắt buộc');
		setLanguageTag('en');
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/tests/unit/i18n.test.ts`
Expected: FAIL — `m.forms_expense` is undefined.

- [ ] **Step 3: Add form + validation keys (en + vi)**

Add these keys to BOTH `messages/en.json` and `messages/vi.json` (en values shown; vi values in the comments — write the vi value into `vi.json`):

English block to add to `en.json`:
```json
	"forms.expense": "Expense",
	"forms.income": "Income",
	"forms.transfer": "Transfer",
	"forms.refund": "Refund",
	"forms.adjustment": "Adjustment",
	"forms.who_paid": "Who did you pay?",
	"forms.select_account": "Select an account",
	"forms.select_destination": "Select a destination account",
	"forms.account_type.checking": "Checking",
	"forms.account_type.savings": "Savings",
	"forms.account_type.cash": "Cash",
	"forms.account_type.credit_card": "Credit Card",
	"forms.account_type.loan_to_person": "Loan to Person",
	"forms.account_type.loan_from_person": "Loan from Person",
	"forms.counterparty": "Counterparty",
	"forms.counterparty_hint": "Person's name",
	"forms.initial_balance": "Initial balance (optional)",
	"forms.goal_type.savings": "Savings",
	"forms.goal_type.debt_payoff": "Debt Payoff",
	"forms.goal_type.net_worth": "Net Worth",
	"forms.target_amount": "Target amount",
	"forms.target_date": "Target date",
	"forms.linked_account": "Linked account",
	"forms.create": "Create",
	"forms.save_changes": "Save changes",
	"forms.saving": "Saving...",
	"validation.name_required": "Name is required",
	"validation.counterparty_required": "Counterparty is required for loans",
	"validation.source_dest_differ": "Source and destination must differ",
	"validation.target_date_required": "Target date is required"
```

Vietnamese block to add to `vi.json` (same keys):
```json
	"forms.expense": "Chi tiêu",
	"forms.income": "Thu nhập",
	"forms.transfer": "Chuyển khoản",
	"forms.refund": "Hoàn tiền",
	"forms.adjustment": "Điều chỉnh",
	"forms.who_paid": "Bạn đã trả cho ai?",
	"forms.select_account": "Chọn tài khoản",
	"forms.select_destination": "Chọn tài khoản nhận",
	"forms.account_type.checking": "Tài khoản thanh toán",
	"forms.account_type.savings": "Tài khoản tiết kiệm",
	"forms.account_type.cash": "Tiền mặt",
	"forms.account_type.credit_card": "Thẻ tín dụng",
	"forms.account_type.loan_to_person": "Cho vay cá nhân",
	"forms.account_type.loan_from_person": "Vay cá nhân",
	"forms.counterparty": "Đối tác",
	"forms.counterparty_hint": "Tên người",
	"forms.initial_balance": "Số dư ban đầu (tuỳ chọn)",
	"forms.goal_type.savings": "Tiết kiệm",
	"forms.goal_type.debt_payoff": "Trả nợ",
	"forms.goal_type.net_worth": "Tổng tài sản",
	"forms.target_amount": "Số tiền mục tiêu",
	"forms.target_date": "Ngày mục tiêu",
	"forms.linked_account": "Tài khoản liên kết",
	"forms.create": "Tạo",
	"forms.save_changes": "Lưu thay đổi",
	"forms.saving": "Đang lưu...",
	"validation.name_required": "Tên là bắt buộc",
	"validation.counterparty_required": "Đối tác là bắt buộc đối với khoản vay",
	"validation.source_dest_differ": "Tài khoản nguồn và đích phải khác nhau",
	"validation.target_date_required": "Ngày mục tiêu là bắt buộc"
```

> The remaining form strings (toasts like "Account updated."/"Goal created.", and any field labels not listed) are added by reading each form file during the migration loop and appending keys under `forms.*`/`validation.*`/`common.*` using the conventions block. Do not skip any user-facing literal.

- [ ] **Step 4: Regenerate**

Run: `pnpm exec paraglide-js compile --project ./project.inlang --outdir ./src/lib/paraglide`

- [ ] **Step 5: Replace markup in the three form components**

For each of `TransactionForm.svelte`, `AccountForm.svelte`, `GoalForm.svelte`:
- Add `import * as m from '$lib/paraglide/messages';` to the `<script lang="ts">` block.
- Replace each literal with its call. Examples (TransactionForm):
  - `Expense` → `{m.forms_expense()}`
  - `Income` → `{m.forms_income()}`
  - `Transfer` → `{m.forms_transfer()}`
  - `Refund` → `{m.forms_refund()}`
  - `Adjustment` → `{m.forms_adjustment()}`
  - `Who did you pay?` → `{m.forms_who_paid()}`
  - `Select an account` → `{m.forms_select_account()}`
  - `Select a destination account` → `{m.forms_select_destination()}`
  - `Save` → `{m.common_save()}` (reuse common)
  - `Cancel` → `{m.common_cancel()}`
  - `Saving...` → `{m.forms_saving()}`
  - error `Source and destination must differ` → `{m.validation_source_dest_differ()}`
  - toasts `Account updated.`/`Account created.` → add `forms.account_updated`/`forms.account_created` (en + vi: "Đã cập nhật tài khoản."/"Đã tạo tài khoản.") and call them.
- Repeat the full inventory for AccountForm (account types, counterparty, initial balance, toasts) and GoalForm (goal types, target amount/date, linked account, toasts, validation) — every user-facing literal.

- [ ] **Step 6: Run tests**

Run: `pnpm test`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add messages/en.json messages/vi.json src/lib/paraglide src/lib/components/forms src/tests/unit/i18n.test.ts
git commit -m "feat(i18n): migrate forms to Paraglide (en+vi)"
```

---

## Task 3: Migrate dashboard + transactions (Wave 2)

**Files:**
- Modify: `messages/en.json`, `messages/vi.json`
- Modify: `src/routes/dashboard/+page.svelte`, `src/routes/transactions/+page.svelte`
- Modify (regenerated): `src/lib/paraglide/*`
- Test: `src/tests/unit/i18n.test.ts`

**Interfaces:**
- Consumes: `common.*`, `forms.*`, `validation.*`.
- Produces: `transactions.*` (and `dashboard.*` if dashboard has unique strings; otherwise reuse `transactions.*`).

- [ ] **Step 1: Write the failing test**

Append to `src/tests/unit/i18n.test.ts`:

```ts
describe('transactions messages', () => {
	it('renders empty state in vi', () => {
		setLanguageTag('vi');
		expect(m.transactions_empty_state()).toBe('Không có giao dịch nào.');
		setLanguageTag('en');
	});

	it('renders transaction count (plural) in vi', () => {
		setLanguageTag('vi');
		expect(m.transactions_count({ count: 0 })).toBe('Không có giao dịch nào');
		expect(m.transactions_count({ count: 5 })).toBe('5 giao dịch');
		setLanguageTag('en');
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/tests/unit/i18n.test.ts`
Expected: FAIL — `m.transactions_empty_state` undefined.

- [ ] **Step 3: Add keys (en + vi)**

Add to `en.json`:
```json
	"transactions.title": "Transactions",
	"transactions.search_placeholder": "Search payee, description...",
	"transactions.empty_state": "No transactions found.",
	"transactions.future": "Future",
	"transactions.duplicated": "Transaction duplicated.",
	"transactions.previous": "Previous",
	"transactions.next": "Next →",
	"transactions.edit": "Edit transaction",
	"transactions.duplicate": "Duplicate",
	"transactions.count": "{count, plural, =0 {No transactions} one {# transaction} other {# transactions}}"
```

Add to `vi.json`:
```json
	"transactions.title": "Giao dịch",
	"transactions.search_placeholder": "Tìm người nhận, diễn giải...",
	"transactions.empty_state": "Không có giao dịch nào.",
	"transactions.future": "Tương lai",
	"transactions.duplicated": "Đã nhân bản giao dịch.",
	"transactions.previous": "Trước",
	"transactions.next": "Tiếp →",
	"transactions.edit": "Sửa giao dịch",
	"transactions.duplicate": "Nhân bản",
	"transactions.count": "{count, plural, =0 {Không có giao dịch nào} other {# giao dịch}}"
```

> Vietnamese has no singular/plural distinction, so the plural uses only `=0` and `other`. Complete the rest of each page's strings via the migration loop (inventory the file → add `transactions.*` / `dashboard.*` keys en+vi → regen → replace). Do not skip any literal.

- [ ] **Step 4: Regenerate**

Run: `pnpm exec paraglide-js compile --project ./project.inlang --outdir ./src/lib/paraglide`

- [ ] **Step 5: Replace markup**

For `dashboard/+page.svelte` and `transactions/+page.svelte`: add the import, then replace literals. The plural/count usage: where the page shows a count, use `{m.transactions_count({ count: n })}`.

- [ ] **Step 6: Run tests**

Run: `pnpm test`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add messages/en.json messages/vi.json src/lib/paraglide src/routes/dashboard src/routes/transactions src/tests/unit/i18n.test.ts
git commit -m "feat(i18n): migrate dashboard and transactions to Paraglide (en+vi)"
```

---

## Task 4: Migrate budgets + reports + goals (Wave 3)

**Files:**
- Modify: `messages/en.json`, `messages/vi.json`
- Modify: `src/routes/budgets/+page.svelte`, `src/routes/reports/+page.svelte`, `src/routes/goals/+page.svelte`
- Modify (regenerated): `src/lib/paraglide/*`
- Test: `src/tests/unit/i18n.test.ts`

**Interfaces:**
- Consumes: `common.*`, `forms.*`, `validation.*`.
- Produces: `budgets.*`, `reports.*`, `goals.*`.

- [ ] **Step 1: Write the failing test**

Append to `src/tests/unit/i18n.test.ts`:

```ts
describe('wave 3 messages', () => {
	it('renders budgets + reports + goals vi strings', () => {
		setLanguageTag('vi');
		expect(m.budgets_title()).toBe('Ngân sách');
		expect(m.reports_net_cash_flow()).toBe('Dòng tiền thuần');
		expect(m.goals_empty_state()).toBe('Tạo mục tiêu đầu tiên');
		setLanguageTag('en');
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/tests/unit/i18n.test.ts`
Expected: FAIL — keys undefined.

- [ ] **Step 3: Add keys (en + vi)**

Add to `en.json`:
```json
	"budgets.title": "Budgets",
	"budgets.copy_from_previous": "Copy from previous",
	"budgets.used": "used",
	"budgets.remaining": "remaining",
	"budgets.updated": "Budget updated.",
	"reports.title": "Reports",
	"reports.overview": "Overview",
	"reports.trend": "Trend",
	"reports.compare": "Compare",
	"reports.include_adjustments": "Include adjustments",
	"reports.income": "Income",
	"reports.expenses": "Expenses",
	"reports.net_cash_flow": "Net Cash Flow",
	"reports.spending_by_bucket": "Spending by Bucket",
	"reports.top_categories": "Top Categories",
	"reports.top_transactions": "Top Transactions",
	"reports.empty": "No data for this month. Add transactions to see reports.",
	"goals.title": "Goals",
	"goals.add": "+ Add goal",
	"goals.active": "Active",
	"goals.completed": "Completed",
	"goals.empty_state": "Create your first goal",
	"goals.status.on_track": "On track",
	"goals.status.behind": "Behind",
	"goals.status.ahead": "Ahead",
	"goals.status.overdue": "Overdue",
	"goals.status.insufficient_data": "Insufficient data",
	"goals.extend_date": "Extend date",
	"goals.mark_complete": "Mark complete",
	"goals.mark_abandoned": "Mark abandoned",
	"goals.complete": "Complete",
	"goals.marked_complete": "Goal marked complete.",
	"goals.abandoned": "Goal abandoned."
```

Add to `vi.json`:
```json
	"budgets.title": "Ngân sách",
	"budgets.copy_from_previous": "Sao chép từ kỳ trước",
	"budgets.used": "đã dùng",
	"budgets.remaining": "còn lại",
	"budgets.updated": "Đã cập nhật ngân sách.",
	"reports.title": "Báo cáo",
	"reports.overview": "Tổng quan",
	"reports.trend": "Xu hướng",
	"reports.compare": "So sánh",
	"reports.include_adjustments": "Bao gồm điều chỉnh",
	"reports.income": "Thu",
	"reports.expenses": "Chi",
	"reports.net_cash_flow": "Dòng tiền thuần",
	"reports.spending_by_bucket": "Chi tiêu theo nhóm",
	"reports.top_categories": "Nhóm hàng đầu",
	"reports.top_transactions": "Giao dịch hàng đầu",
	"reports.empty": "Chưa có dữ liệu trong tháng này. Thêm giao dịch để xem báo cáo.",
	"goals.title": "Mục tiêu",
	"goals.add": "+ Thêm mục tiêu",
	"goals.active": "Đang hoạt động",
	"goals.completed": "Đã hoàn thành",
	"goals.empty_state": "Tạo mục tiêu đầu tiên",
	"goals.status.on_track": "Đúng tiến độ",
	"goals.status.behind": "Chậm tiến độ",
	"goals.status.ahead": "Vượt tiến độ",
	"goals.status.overdue": "Quá hạn",
	"goals.status.insufficient_data": "Thiếu dữ liệu",
	"goals.extend_date": "Gia hạn ngày",
	"goals.mark_complete": "Đánh dấu hoàn thành",
	"goals.mark_abandoned": "Đánh dấu bỏ qua",
	"goals.complete": "Hoàn thành",
	"goals.marked_complete": "Đã đánh dấu hoàn thành mục tiêu.",
	"goals.abandoned": "Đã bỏ qua mục tiêu."
```

> Complete remaining per-page literals via the migration loop.

- [ ] **Step 4: Regenerate**

Run: `pnpm exec paraglide-js compile --project ./project.inlang --outdir ./src/lib/paraglide`

- [ ] **Step 5: Replace markup** in `budgets`, `reports`, `goals` pages (import + replace every literal). For status enums rendered from data (on_track/behind/…), map the data value to the message call, e.g. a helper `{m[\`goals_status_${status}\`]()}` or an explicit switch.

- [ ] **Step 6: Run tests**

Run: `pnpm test`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add messages/en.json messages/vi.json src/lib/paraglide src/routes/budgets src/routes/reports src/routes/goals src/tests/unit/i18n.test.ts
git commit -m "feat(i18n): migrate budgets, reports, goals to Paraglide (en+vi)"
```

---

## Task 5: Migrate accounts + debts (Wave 4)

**Files:**
- Modify: `messages/en.json`, `messages/vi.json`
- Modify: `src/routes/accounts/+page.svelte`, `src/routes/debts/+page.svelte`
- Modify (regenerated): `src/lib/paraglide/*`
- Test: `src/tests/unit/i18n.test.ts`

**Interfaces:**
- Consumes: `common.*`, `forms.*`, `validation.*`.
- Produces: `accounts.*`, `debts.*`.

- [ ] **Step 1: Write the failing test**

Append to `src/tests/unit/i18n.test.ts`:

```ts
describe('wave 4 messages', () => {
	it('renders accounts + debts vi strings', () => {
		setLanguageTag('vi');
		expect(m.accounts_assets()).toBe('Tài sản');
		expect(m.accounts_liabilities()).toBe('Nợ phải trả');
		expect(m.debts_i_owe()).toBe('Tôi nợ');
		setLanguageTag('en');
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/tests/unit/i18n.test.ts`
Expected: FAIL — keys undefined.

- [ ] **Step 3: Add keys (en + vi)**

Add to `en.json`:
```json
	"accounts.title": "Accounts",
	"accounts.add": "+ Add account",
	"accounts.assets": "Assets",
	"accounts.liabilities": "Liabilities",
	"accounts.archived": "Archived",
	"accounts.empty.assets": "No asset accounts.",
	"accounts.empty.liabilities": "No liability accounts.",
	"accounts.archive": "Archive",
	"accounts.archived_toast": "Account archived.",
	"accounts.unarchived_toast": "Account unarchived.",
	"accounts.delete_confirm_title": "Delete account?",
	"accounts.delete_confirm_body": "This will hide the account from active lists. You can restore it from a backup if needed.",
	"debts.title": "Debts",
	"debts.i_owe": "I Owe",
	"debts.owed_to_me": "Owed to Me",
	"debts.empty.i_owe": "No debts. You're debt-free! 🎉",
	"debts.empty.owed_to_me": "No one owes you money.",
	"debts.pay": "Pay",
	"debts.receive": "Receive",
	"debts.write_off": "Write off",
	"debts.payment_recorded": "Payment recorded.",
	"debts.written_off": "Debt written off.",
	"debts.select_account": "Select an account.",
	"debts.make_payment": "Make payment",
	"debts.receive_payment": "Receive payment",
	"debts.write_off_debt": "Write off debt",
	"debts.from_account": "From account",
	"debts.to_account": "To account",
	"debts.record": "Record"
```

Add to `vi.json`:
```json
	"accounts.title": "Tài khoản",
	"accounts.add": "+ Thêm tài khoản",
	"accounts.assets": "Tài sản",
	"accounts.liabilities": "Nợ phải trả",
	"accounts.archived": "Đã lưu trữ",
	"accounts.empty.assets": "Chưa có tài khoản tài sản.",
	"accounts.empty.liabilities": "Chưa có tài khoản nợ phải trả.",
	"accounts.archive": "Lưu trữ",
	"accounts.archived_toast": "Đã lưu trữ tài khoản.",
	"accounts.unarchived_toast": "Đã bỏ lưu trữ tài khoản.",
	"accounts.delete_confirm_title": "Xoá tài khoản?",
	"accounts.delete_confirm_body": "Việc này sẽ ẩn tài khoản khỏi danh sách đang hoạt động. Bạn có thể khôi phục từ bản sao lưu nếu cần.",
	"debts.title": "Công nợ",
	"debts.i_owe": "Tôi nợ",
	"debts.owed_to_me": "Người khác nợ tôi",
	"debts.empty.i_owe": "Không có khoản nợ nào. Bạn đã hết nợ! 🎉",
	"debts.empty.owed_to_me": "Chưa ai nợ tiền bạn.",
	"debts.pay": "Trả",
	"debts.receive": "Nhận",
	"debts.write_off": "Xoá nợ",
	"debts.payment_recorded": "Đã ghi nhận thanh toán.",
	"debts.written_off": "Đã xoá khoản nợ.",
	"debts.select_account": "Chọn tài khoản.",
	"debts.make_payment": "Thực hiện thanh toán",
	"debts.receive_payment": "Nhận thanh toán",
	"debts.write_off_debt": "Xoá khoản nợ",
	"debts.from_account": "Từ tài khoản",
	"debts.to_account": "Đến tài khoản",
	"debts.record": "Ghi nhận"
```

> Complete remaining literals via the migration loop.

- [ ] **Step 4: Regenerate**

Run: `pnpm exec paraglide-js compile --project ./project.inlang --outdir ./src/lib/paraglide`

- [ ] **Step 5: Replace markup** in `accounts` and `debts` pages.

- [ ] **Step 6: Run tests**

Run: `pnpm test`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add messages/en.json messages/vi.json src/lib/paraglide src/routes/accounts src/routes/debts src/tests/unit/i18n.test.ts
git commit -m "feat(i18n): migrate accounts and debts to Paraglide (en+vi)"
```

---

## Task 6: Migrate settings, categories, onboarding, layout (Wave 5)

**Files:**
- Modify: `messages/en.json`, `messages/vi.json`
- Modify: `src/routes/settings/+page.svelte`, `src/routes/settings/categories/+page.svelte`, `src/routes/onboarding/+page.svelte`
- Modify: `src/lib/components/layout/TopBar.svelte`, `BottomNav.svelte`, `FAB.svelte`, `Sidebar.svelte`, `GlobalToast.svelte`
- Modify: `src/routes/+layout.svelte`
- Modify: `src/lib/utils/date.ts` (move vi literals to keys)
- Modify (regenerated): `src/lib/paraglide/*`
- Test: `src/tests/unit/i18n.test.ts`

**Interfaces:**
- Consumes: all prior namespaces.
- Produces: `settings.*`, `categories.*`, `onboarding.*` (extend), `layout.*`.

- [ ] **Step 1: Write the failing test**

Append to `src/tests/unit/i18n.test.ts`:

```ts
describe('wave 5 messages', () => {
	it('renders settings + categories + layout vi strings', () => {
		setLanguageTag('vi');
		expect(m.settings_title()).toBe('Cài đặt');
		expect(m.categories_title()).toBe('Nhãn');
		expect(m.layout_warming_up()).toBe('Đang khởi động');
		setLanguageTag('en');
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/tests/unit/i18n.test.ts`
Expected: FAIL — keys undefined.

- [ ] **Step 3: Add keys (en + vi)**

Add to `en.json`:
```json
	"settings.title": "Settings",
	"settings.categories": "Categories",
	"settings.categories_desc": "Manage buckets and tags",
	"settings.backup": "Backup & Data",
	"settings.backup_desc": "Export, import, and manage backups",
	"settings.theme": "Theme",
	"settings.theme.auto": "auto",
	"settings.theme.light": "light",
	"settings.theme.dark": "dark",
	"settings.language": "Language",
	"settings.version": "Notchy v0.1.0",
	"categories.title": "Categories",
	"categories.add_tag": "+ Add tag",
	"categories.uncategorise": "Uncategorise (mark as deleted)",
	"categories.merge_into": "Merge into:",
	"categories.system": "system",
	"categories.tag_updated": "Tag updated.",
	"categories.tag_created": "Tag created.",
	"categories.tag_deleted": "Tag deleted.",
	"categories.delete_confirm_title": "Delete tag?",
	"categories.delete_confirm_body": "This tag has no transactions. It will be soft-deleted.",
	"layout.search_placeholder": "Search transactions, payees…",
	"layout.menu": "Menu",
	"layout.home": "Home",
	"layout.trans": "Trans",
	"layout.budget": "Budget",
	"layout.reports": "Reports",
	"layout.warming_up": "Warming up",
	"layout.add_transaction": "Add transaction"
```

Add to `vi.json`:
```json
	"settings.title": "Cài đặt",
	"settings.categories": "Nhãn",
	"settings.categories_desc": "Quản lý nhóm và nhãn",
	"settings.backup": "Sao lưu & Dữ liệu",
	"settings.backup_desc": "Xuất, nhập và quản lý bản sao lưu",
	"settings.theme": "Giao diện",
	"settings.theme.auto": "tự động",
	"settings.theme.light": "sáng",
	"settings.theme.dark": "tối",
	"settings.language": "Ngôn ngữ",
	"settings.version": "Notchy v0.1.0",
	"categories.title": "Nhãn",
	"categories.add_tag": "+ Thêm nhãn",
	"categories.uncategorise": "Bỏ phân loại (đánh dấu xoá)",
	"categories.merge_into": "Gộp vào:",
	"categories.system": "hệ thống",
	"categories.tag_updated": "Đã cập nhật nhãn.",
	"categories.tag_created": "Đã tạo nhãn.",
	"categories.tag_deleted": "Đã xoá nhãn.",
	"categories.delete_confirm_title": "Xoá nhãn?",
	"categories.delete_confirm_body": "Nhãn này không có giao dịch. Nó sẽ bị xoá mềm.",
	"layout.search_placeholder": "Tìm giao dịch, người nhận…",
	"layout.menu": "Menu",
	"layout.home": "Trang chính",
	"layout.trans": "Giao dịch",
	"layout.budget": "Ngân sách",
	"layout.reports": "Báo cáo",
	"layout.warming_up": "Đang khởi động",
	"layout.add_transaction": "Thêm giao dịch"
```

> Complete remaining literals via the migration loop.

- [ ] **Step 4: Regenerate**

Run: `pnpm exec paraglide-js compile --project ./project.inlang --outdir ./src/lib/paraglide`

- [ ] **Step 5: Replace markup in all Wave 5 files**

- In `onboarding/+page.svelte`: **remove every `{locale === 'vi' ? '…' : '…'}` inline conditional** and replace with `m.onboarding_*()` calls. For each conditional, add the corresponding `onboarding.*` key (en + vi) using the value already present in the conditional as the source text, then call it.
- In `+layout.svelte`: replace `Warming up` → `{m.layout_warming_up()}` and the Modal `title="Add transaction"` → `title={m.layout_add_transaction()}`.
- In layout components: replace `Home`/`Trans`/`Budget`/`Reports` (BottomNav), search placeholders (TopBar), etc.

- [ ] **Step 6: Move date helper vi literals to message keys**

In `src/lib/utils/date.ts`, `formatDateRelative` returns hardcoded `'Hôm nay'`/`'Hôm qua'`/`'Today'`/`'Yesterday'`. Refactor to read from messages:

```ts
import * as m from '$lib/paraglide/messages';

export function formatDateRelative(dateStr: string, locale: Locale): string {
	// ... existing same-day / prior-day logic ...
	if (isToday) return locale === 'vi' ? m.common_today() : m.common_today();
	if (isYesterday) return locale === 'vi' ? m.common_yesterday() : m.common_yesterday();
	// (common.today/common.yesterday already hold the right per-locale value
	//  because setLanguageTag was called; the locale param is kept for the
	//  existing format fallback only.)
	...
}
```

> Simplification: since `setLanguageTag` is synced to `settings.locale` and `common.today`/`common.yesterday` resolve per active tag, the `locale` branch can be dropped and the function can return `m.common_today()` / `m.common_yesterday()` directly. Keep the `locale` param only if other call sites still pass it; otherwise leave the signature unchanged to avoid touching callers. Update the existing `formatDateRelative` tests — they assert `'Hôm nay'`/`'Today'`; those still pass because the message values match. Run `pnpm test` to confirm.

- [ ] **Step 7: Run typecheck + tests**

Run: `pnpm check`
Expected: no errors.
Run: `pnpm test`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add messages/en.json messages/vi.json src/lib/paraglide src/routes/settings src/routes/onboarding src/lib/components/layout src/routes/+layout.svelte src/lib/utils/date.ts src/tests/unit/i18n.test.ts
git commit -m "feat(i18n): migrate settings, categories, onboarding, layout (en+vi)"
```

---

## Task 7: Parity audit + final verification

**Files:**
- Read/verify: `messages/en.json`, `messages/vi.json`, all migrated pages/components
- Test: `src/tests/unit/i18n.test.ts`

- [ ] **Step 1: Verify en/vi key parity**

Run: `pnpm exec paraglide-js compile --project ./project.inlang --outdir ./src/lib/paraglide`
Expected: no warnings from `message-lint-rule-missing-translation` or `message-lint-rule-empty-pattern`. If warnings appear, add the missing vi (or en) values.

- [ ] **Step 2: Grep for remaining hardcoded literals**

Run:
```bash
grep -rnE "'(Save|Cancel|Delete|Edit|Add|Settings|Dashboard|Transactions|Accounts|Goals|Debts|Reports|Budgets)'" src/routes src/lib/components --include=*.svelte
```
Expected: no user-facing literal matches (ignore matches inside `m.*()` calls or non-user contexts). Any remaining literal → add a key and replace.

- [ ] **Step 3: Grep for leftover onboarding conditionals**

Run: `grep -rn "locale === 'vi'" src/routes/onboarding`
Expected: no matches.

- [ ] **Step 4: Run full suite**

Run: `pnpm test`
Expected: all green.
Run: `pnpm check`
Expected: no errors.

- [ ] **Step 5: Manual smoke test**

Run: `pnpm tauri dev`
- Switch language to Tiếng Việt in Settings.
- Visit every page (dashboard, transactions, budgets, reports, accounts, goals, debts, settings, categories). Confirm no English leftovers.
- Switch back to English. Confirm no Vietnamese leftovers.

- [ ] **Step 6: User reviews vi.json**

Hand `messages/vi.json` to the user for a complete review pass. Apply any terminology corrections (en + vi key parity maintained). Regen + `pnpm test` after corrections.

- [ ] **Step 7: Commit**

```bash
git add messages/en.json messages/vi.json src/lib/paraglide
git commit -m "fix(i18n): apply vi review corrections"
```

---

## Self-Review Notes (completed)

- **Spec coverage:** §1 plumbing → Task 1. §1.2 namespacing → Task 1 + used throughout. §1.3 plurals/interpolation → Task 3 (`transactions.count`). §2 waves → Tasks 2–6. §3 formatting verification → Task 6 Step 6 (date literals) + Task 7. §4 testing → every task has a failing-test step; linters enforced in Task 7. §5 scope (out-of-scope items) → none implemented. All spec sections covered.
- **Type consistency:** message function names follow `namespace_key` (dots → `_`) consistently; `setLanguageTag`/`m` import paths identical across tasks. `Locale` type unchanged. Goal status enum handled via `goals_status_*` naming.
- **Placeholder scan:** migration loops intentionally defer exhaustive literal enumeration to the implementer reading each file (the file is the source of truth and hand-listing 560 strings would be stale/plausible-but-wrong). Every task still ships concrete seed keys, a representative test, the exact regen command, and the replacement pattern. No "TBD"/"add error handling" language.
```
