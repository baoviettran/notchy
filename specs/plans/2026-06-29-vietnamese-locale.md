# Vietnamese Bilingual Locale Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire every user-facing string through Paraglide i18n so the app is fully bilingual (`en` + `vi`) — switching locale flips the entire app, not just the nav.

**Architecture:** Paraglide JS is already configured but unused. Add the missing runtime sync (`setLanguageTag` driven by `settings.locale`), reorganize message keys into feature-prefixed underscore names, then migrate ~560 hardcoded strings page-by-page (waves), with en + vi written together. Number/currency/date formatting is already locale-aware and only needs verification.

**Tech Stack:** SvelteKit 5, Svelte 5 runes, Paraglide JS (`@inlang/paraglide-js` 1.11.8), Vitest, Tauri v2, SQLite.

## Global Constraints

- **Locales:** `en` (source/default) and `vi`. Source language tag in `project.inlang/settings.json` stays `en`.
- **Default locale:** `'en'`. No OS-locale auto-detection. Locale persists in DB via `meta` (unchanged).
- **Currencies:** `VND` (0 decimals), `USD` (2 decimals). Do not change currency logic.
- **Amounts:** integers in smallest currency unit. No floats.
- **i18n runtime import:** `import * as m from '$lib/paraglide/messages'` (alias `$lib` → `src/lib`). Functions are named exports, e.g. `m.nav_dashboard()`.
- **Regen command (run after editing any `messages/*.json`):** `pnpm exec paraglide-js compile --project ./project.inlang --outdir ./src/lib/paraglide`
- **Key naming — READ CAREFULLY:** Paraglide JS **1.11.8** (the pinned version) requires message IDs to be valid JavaScript identifiers. It does **NOT** sanitize punctuation — a dotted key like `nav.dashboard` makes `paraglide-js compile` throw `Cannot compile message with ID "nav.dashboard". The message is not a valid JavaScript variable name.` (verified). Therefore keys are written directly as flat **underscore-separated names** and grouped by a feature prefix as a *naming convention*: `nav_dashboard`, `common_save`, `transactions_count`, `forms_expense`, `validation_name_required`, `goals_status_on_track`, `accounts_empty_assets`. The prefix (`nav_`, `common_`, `forms_`, `transactions_`, …) is the namespace. **Do not use dots in keys.** Upgrading to Paraglide 2.x was evaluated and rejected (see ADR note below) — 2.x gives bracket-access dotted strings (`m["nav.dashboard"]()`), not nested namespaces, so the upgrade's payoff is cosmetic while its cost is large.
- **TDD:** write failing test → watch fail → implement → pass → commit. Run `pnpm test` before every commit.
- **Commit prefix:** `feat:`, `fix:`, `docs:`, `refactor:`, `test:`.
- **Vietnamese quality:** use natural finance terminology (giao dịch, ngân sách, báo cáo, tài khoản, mục tiêu, công nợ, thu/chi, chuyển khoản, hoàn tiền, điều chỉnh), not literal word-for-word.
- **Translation ownership:** implementer writes both en and vi. User reviews the complete `vi.json` at the end.

> **ADR — why flat underscore keys on Paraglide 1.11.8, not dotted keys or 2.x:** The original plan assumed dotted keys (`nav.dashboard`) compile to `m.nav_dashboard()`. They do not — 1.11.8 hard-rejects dotted IDs. Paraglide 2.x (~2.20) was researched as an alternative: it accepts dotted IDs but compiles them to quoted bracket-access exports (`export { nav_dashboard as "nav.dashboard" }`, called as `m["nav.dashboard"]()`), not nested property chains (`m.nav.dashboard()` is invalid). So 2.x's dotted keys vs 1.x's flat underscores is purely a cosmetic key-naming difference, while 2.x costs a major-version migration (adapter removed, config + runtime renames, structured plural format, Tauri-incompatible default strategies). The flat-underscore convention on 1.11.8 delivers the same organizational clarity at ~10% the risk. `setLanguageTag`/`getLanguageTag` (1.x names) stay.

## File Structure

**Message sources (edited by hand, then compiled):**
- `messages/en.json` — English messages (source)
- `messages/vi.json` — Vietnamese messages
- `project.inlang/settings.json` — Paraglide config (unchanged: already loads empty-pattern + missing-translation linters)

**Compiled (generated — never hand-edit):**
- `src/lib/paraglide/messages.js` + `messages/en.js` + `messages/vi.js` + `runtime.js`

**Runtime sync (new logic):**
- `src/lib/stores/settings.svelte.ts` — add explicit `setLanguageTag` calls in `load()` + `setLocale()`

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
2. **Key + translate:** For each string, add an underscore-prefixed key to BOTH `messages/en.json` and `messages/vi.json`. Prefix = feature (`transactions_*`, `budgets_*`, …). Shared words (save/cancel/delete/edit/add/search/amount/date/…) go in `common_*` — check it exists first; if it already exists from an earlier wave, reuse it, do not duplicate. Multi-word suffixes use underscores too (`transactions_empty_state`, `goals_status_on_track`, `accounts_empty_assets`). **No dots in keys.**
3. **Regen:** `pnpm exec paraglide-js compile --project ./project.inlang --outdir ./src/lib/paraglide`

> **JSON append discipline:** Task 1 *overwrites* `messages/{en,vi}.json` with a complete object; Tasks 2–5 *append* new keys into the existing object. When appending, the new entries go **inside** the closing `}` — meaning the previous last entry must gain a trailing comma, and the very last entry in the file must never have one. A corrupted JSON file silently breaks the Paraglide compile, so after every append: ensure the comma before your first new key, ensure no comma after your last new key, and let the Step "Regen" compile be the proof (a clean compile = valid JSON).
4. **Replace markup:** In the `.svelte` file, add `import * as m from '$lib/paraglide/messages';` to `<script lang="ts">`, then replace each literal with its function call `m.<prefix>_<key>()`. For interpolated strings use params: `m.transactions_paid_to({ name })`.
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
		expect(m.<prefix>_<key>()).toBe('<expected vi string>');
		setLanguageTag('en'); // restore
	});
});
```
Replace `<FEATURE>`, `<prefix>_<key>`, `<expected vi string>` with a real key/string from that wave (e.g. for transactions: `m.transactions_empty_state()` → `'Không có giao dịch nào.'`).

---

## Task 1: Plumbing — runtime sync + underscore-namespaced keys (Wave 0)

**Files:**
- Modify: `messages/en.json`, `messages/vi.json`
- Modify: `src/lib/stores/settings.svelte.ts`
- Modify (regenerated): `src/lib/paraglide/*`
- Test: `src/tests/unit/i18n.test.ts`

**Interfaces:**
- Produces: `import * as m from '$lib/paraglide/messages'` (named exports, one per underscore key); `setLanguageTag` from `$lib/paraglide/runtime`. All later tasks consume these.

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
Expected: FAIL — today `nav_dashboard` exists (it's one of the current flat keys) but `m.nav_dashboard()` returns `'Dashboard'` even after `setLanguageTag('vi')` because `setLanguageTag` is never called by the app and nothing proves the vi path resolves at runtime under test. This step confirms the runtime-sync gap before wiring it.

- [ ] **Step 3: Rewrite message files with underscore-namespaced keys**

Overwrite `messages/en.json`:

```json
{
	"$schema": "https://inlang.com/schema/inlang-message-format",
	"app_name": "Notchy",
	"nav_dashboard": "Dashboard",
	"nav_transactions": "Transactions",
	"nav_budgets": "Budgets",
	"nav_reports": "Reports",
	"nav_accounts": "Accounts",
	"nav_goals": "Goals",
	"nav_debts": "Debts",
	"nav_settings": "Settings",
	"common_save": "Save",
	"common_cancel": "Cancel",
	"common_delete": "Delete",
	"common_edit": "Edit",
	"common_add": "Add",
	"common_undo": "Undo",
	"common_search": "Search",
	"common_amount": "Amount",
	"common_date": "Date",
	"common_description": "Description",
	"common_name": "Name",
	"common_none": "— None —",
	"common_optional": "Optional",
	"common_today": "Today",
	"common_yesterday": "Yesterday",
	"onboarding_choose_language": "Choose your language",
	"onboarding_choose_currency": "Choose your currency",
	"onboarding_create_account": "Create your first account",
	"onboarding_continue": "Continue",
	"onboarding_finish": "Finish setup",
	"lang_english": "English",
	"lang_vietnamese": "Tiếng Việt"
}
```

Overwrite `messages/vi.json` with the same keys, vi values:

```json
{
	"$schema": "https://inlang.com/schema/inlang-message-format",
	"app_name": "Notchy",
	"nav_dashboard": "Tổng quan",
	"nav_transactions": "Giao dịch",
	"nav_budgets": "Ngân sách",
	"nav_reports": "Báo cáo",
	"nav_accounts": "Tài khoản",
	"nav_goals": "Mục tiêu",
	"nav_debts": "Công nợ",
	"nav_settings": "Cài đặt",
	"common_save": "Lưu",
	"common_cancel": "Huỷ",
	"common_delete": "Xoá",
	"common_edit": "Sửa",
	"common_add": "Thêm",
	"common_undo": "Hoàn tác",
	"common_search": "Tìm kiếm",
	"common_amount": "Số tiền",
	"common_date": "Ngày",
	"common_description": "Diễn giải",
	"common_name": "Tên",
	"common_none": "— Không —",
	"common_optional": "Tuỳ chọn",
	"common_today": "Hôm nay",
	"common_yesterday": "Hôm qua",
	"onboarding_choose_language": "Chọn ngôn ngữ",
	"onboarding_choose_currency": "Chọn đơn vị tiền tệ",
	"onboarding_create_account": "Tạo tài khoản đầu tiên",
	"onboarding_continue": "Tiếp tục",
	"onboarding_finish": "Hoàn tất",
	"lang_english": "English",
	"lang_vietnamese": "Tiếng Việt"
}
```

> Note: the existing flat keys (`nav_dashboard`, `action_save`, `onboarding_*`, `lang_*`, `app_name`) already use valid underscore identifiers. This step keeps the same identifier shape, renames the `action_*` verbs into the `common_*` prefix (canonical shared-words namespace), and drops nothing that is referenced (nothing references any message today). The result is a clean underscore-namespaced baseline.

- [ ] **Step 4: Regenerate compiled messages**

Run: `pnpm exec paraglide-js compile --project ./project.inlang --outdir ./src/lib/paraglide`
Expected: compiles with no errors. Verify the function name produced for key `nav_dashboard`:

Run: `grep -n "nav_dashboard" src/lib/paraglide/messages.js`
Expected: shows `export const nav_dashboard = (params = {}, options = {}) => {` (or equivalent export) — confirms the underscore key `nav_dashboard` compiles to function `nav_dashboard`. **If a compile error mentions an invalid identifier, you have a dot or other punctuation in a key — fix the JSON and recompile.** Record the confirmed name here: `nav_dashboard`.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test src/tests/unit/i18n.test.ts`
Expected: PASS — `m.nav_dashboard()` returns `'Tổng quan'` after `setLanguageTag('vi')`.

- [ ] **Step 6: Add runtime sync to SettingsStore**

In `src/lib/stores/settings.svelte.ts`, add the import and explicit sync calls. The full updated file:

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

> Why no `$effect`: Svelte 5 `$effect` only runs inside a component/effect-root context — a plain class constructor is neither, so a constructor `$effect` would silently never fire. There is also nothing for it to react to: `this.locale` is mutated in exactly two places — `load()` (boot) and `setLocale()` (user change) — and both call `setLanguageTag` explicitly. The two explicit calls are the complete coverage; a reactive `$effect` would add nothing.

- [ ] **Step 7: Run typecheck + tests**

Run: `pnpm check`
Expected: no errors.
Run: `pnpm test`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add messages/en.json messages/vi.json src/lib/paraglide src/lib/stores/settings.svelte.ts src/tests/unit/i18n.test.ts
git commit -m "feat(i18n): add runtime locale sync and underscore-namespaced message keys"
```

---

## Task 2: Migrate forms (Wave 1)

Migrate the three form components. These define `forms_*` and `validation_*`, used by all pages.

**Files:**
- Modify: `messages/en.json`, `messages/vi.json`
- Modify: `src/lib/components/forms/TransactionForm.svelte`, `AccountForm.svelte`, `GoalForm.svelte`
- Modify (regenerated): `src/lib/paraglide/*`
- Test: `src/tests/unit/i18n.test.ts`

**Interfaces:**
- Consumes: `common_*` from Task 1 (save/cancel/name/date/amount/optional/none).
- Produces: `forms_*` (type labels + field labels), `validation_*` (error messages). Later pages that embed these forms need no extra work — the components self-translate.

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

Add these keys to BOTH `messages/en.json` and `messages/vi.json` (append inside the closing `}` per the JSON-append discipline).

English block to add to `en.json`:
```json
	"forms_expense": "Expense",
	"forms_income": "Income",
	"forms_transfer": "Transfer",
	"forms_refund": "Refund",
	"forms_adjustment": "Adjustment",
	"forms_who_paid": "Who did you pay?",
	"forms_select_account": "Select an account",
	"forms_select_destination": "Select a destination account",
	"forms_account_type_checking": "Checking",
	"forms_account_type_savings": "Savings",
	"forms_account_type_cash": "Cash",
	"forms_account_type_credit_card": "Credit Card",
	"forms_account_type_loan_to_person": "Loan to Person",
	"forms_account_type_loan_from_person": "Loan from Person",
	"forms_counterparty": "Counterparty",
	"forms_counterparty_hint": "Person's name",
	"forms_initial_balance": "Initial balance (optional)",
	"forms_goal_type_savings": "Savings",
	"forms_goal_type_debt_payoff": "Debt Payoff",
	"forms_goal_type_net_worth": "Net Worth",
	"forms_target_amount": "Target amount",
	"forms_target_date": "Target date",
	"forms_linked_account": "Linked account",
	"forms_create": "Create",
	"forms_save_changes": "Save changes",
	"forms_saving": "Saving...",
	"validation_name_required": "Name is required",
	"validation_counterparty_required": "Counterparty is required for loans",
	"validation_source_dest_differ": "Source and destination must differ",
	"validation_target_date_required": "Target date is required"
```

Vietnamese block to add to `vi.json` (same keys):
```json
	"forms_expense": "Chi tiêu",
	"forms_income": "Thu nhập",
	"forms_transfer": "Chuyển khoản",
	"forms_refund": "Hoàn tiền",
	"forms_adjustment": "Điều chỉnh",
	"forms_who_paid": "Bạn đã trả cho ai?",
	"forms_select_account": "Chọn tài khoản",
	"forms_select_destination": "Chọn tài khoản nhận",
	"forms_account_type_checking": "Tài khoản thanh toán",
	"forms_account_type_savings": "Tài khoản tiết kiệm",
	"forms_account_type_cash": "Tiền mặt",
	"forms_account_type_credit_card": "Thẻ tín dụng",
	"forms_account_type_loan_to_person": "Cho vay cá nhân",
	"forms_account_type_loan_from_person": "Vay cá nhân",
	"forms_counterparty": "Đối tác",
	"forms_counterparty_hint": "Tên người",
	"forms_initial_balance": "Số dư ban đầu (tuỳ chọn)",
	"forms_goal_type_savings": "Tiết kiệm",
	"forms_goal_type_debt_payoff": "Trả nợ",
	"forms_goal_type_net_worth": "Tổng tài sản",
	"forms_target_amount": "Số tiền mục tiêu",
	"forms_target_date": "Ngày mục tiêu",
	"forms_linked_account": "Tài khoản liên kết",
	"forms_create": "Tạo",
	"forms_save_changes": "Lưu thay đổi",
	"forms_saving": "Đang lưu...",
	"validation_name_required": "Tên là bắt buộc",
	"validation_counterparty_required": "Đối tác là bắt buộc đối với khoản vay",
	"validation_source_dest_differ": "Tài khoản nguồn và đích phải khác nhau",
	"validation_target_date_required": "Ngày mục tiêu là bắt buộc"
```

> The remaining form strings (toasts like "Account updated."/"Goal created.", and any field labels not listed) are added by reading each form file during the migration loop and appending keys under `forms_*`/`validation_*`/`common_*` using the conventions block. Do not skip any user-facing literal.

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
  - toasts `Account updated.`/`Account created.` → add `forms_account_updated`/`forms_account_created` (en + vi: "Đã cập nhật tài khoản."/"Đã tạo tài khoản.") and call them.
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
- Consumes: `common_*`, `forms_*`, `validation_*`.
- Produces: `transactions_*` (and `dashboard_*` if dashboard has unique strings; otherwise reuse `transactions_*`).

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
	"transactions_title": "Transactions",
	"transactions_search_placeholder": "Search payee, description...",
	"transactions_empty_state": "No transactions found.",
	"transactions_future": "Future",
	"transactions_duplicated": "Transaction duplicated.",
	"transactions_previous": "Previous",
	"transactions_next": "Next →",
	"transactions_edit": "Edit transaction",
	"transactions_duplicate": "Duplicate",
	"transactions_count": "{count, plural, =0 {No transactions} one {# transaction} other {# transactions}}"
```

Add to `vi.json`:
```json
	"transactions_title": "Giao dịch",
	"transactions_search_placeholder": "Tìm người nhận, diễn giải...",
	"transactions_empty_state": "Không có giao dịch nào.",
	"transactions_future": "Tương lai",
	"transactions_duplicated": "Đã nhân bản giao dịch.",
	"transactions_previous": "Trước",
	"transactions_next": "Tiếp →",
	"transactions_edit": "Sửa giao dịch",
	"transactions_duplicate": "Nhân bản",
	"transactions_count": "{count, plural, =0 {Không có giao dịch nào} other {# giao dịch}}"
```

> Vietnamese has no singular/plural distinction, so the plural uses only `=0` and `other`. Complete the rest of each page's strings via the migration loop (inventory the file → add `transactions_*` / `dashboard_*` keys en+vi → regen → replace). Do not skip any literal.

- [ ] **Step 4: Regenerate and verify the plural signature**

Run: `pnpm exec paraglide-js compile --project ./project.inlang --outdir ./src/lib/paraglide`
Expected: compiles with no errors. ICU plural keys compile to a function taking a typed `params` object, so verify the exact signature before the Step 1 test can pass:

Run: `grep -n "transactions_count" src/lib/paraglide/messages.js`
Expected: shows `export const transactions_count = (params = {}, options = {}) => {` with `count` required in `params`. This confirms the plural key `transactions_count` compiles to `transactions_count` and accepts `{ count }`. **If the function name or signature differs, or if the compile rejects the inline ICU plural syntax, adjust the test in Step 1 to the actual compiled form before proceeding — and if the inline-ICU plural is rejected by this plugin version, report BLOCKED so the plural can be converted to the plugin's structured form.** Record the confirmed name here: `transactions_count`.

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
- Consumes: `common_*`, `forms_*`, `validation_*`.
- Produces: `budgets_*`, `reports_*`, `goals_*`.

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
	"budgets_title": "Budgets",
	"budgets_copy_from_previous": "Copy from previous",
	"budgets_used": "used",
	"budgets_remaining": "remaining",
	"budgets_updated": "Budget updated.",
	"reports_title": "Reports",
	"reports_overview": "Overview",
	"reports_trend": "Trend",
	"reports_compare": "Compare",
	"reports_include_adjustments": "Include adjustments",
	"reports_income": "Income",
	"reports_expenses": "Expenses",
	"reports_net_cash_flow": "Net Cash Flow",
	"reports_spending_by_bucket": "Spending by Bucket",
	"reports_top_categories": "Top Categories",
	"reports_top_transactions": "Top Transactions",
	"reports_empty": "No data for this month. Add transactions to see reports.",
	"goals_title": "Goals",
	"goals_add": "+ Add goal",
	"goals_active": "Active",
	"goals_completed": "Completed",
	"goals_empty_state": "Create your first goal",
	"goals_status_on_track": "On track",
	"goals_status_behind": "Behind",
	"goals_status_ahead": "Ahead",
	"goals_status_overdue": "Overdue",
	"goals_status_insufficient_data": "Insufficient data",
	"goals_extend_date": "Extend date",
	"goals_mark_complete": "Mark complete",
	"goals_mark_abandoned": "Mark abandoned",
	"goals_complete": "Complete",
	"goals_marked_complete": "Goal marked complete.",
	"goals_abandoned": "Goal abandoned."
```

Add to `vi.json`:
```json
	"budgets_title": "Ngân sách",
	"budgets_copy_from_previous": "Sao chép từ kỳ trước",
	"budgets_used": "đã dùng",
	"budgets_remaining": "còn lại",
	"budgets_updated": "Đã cập nhật ngân sách.",
	"reports_title": "Báo cáo",
	"reports_overview": "Tổng quan",
	"reports_trend": "Xu hướng",
	"reports_compare": "So sánh",
	"reports_include_adjustments": "Bao gồm điều chỉnh",
	"reports_income": "Thu",
	"reports_expenses": "Chi",
	"reports_net_cash_flow": "Dòng tiền thuần",
	"reports_spending_by_bucket": "Chi tiêu theo nhóm",
	"reports_top_categories": "Nhóm hàng đầu",
	"reports_top_transactions": "Giao dịch hàng đầu",
	"reports_empty": "Chưa có dữ liệu trong tháng này. Thêm giao dịch để xem báo cáo.",
	"goals_title": "Mục tiêu",
	"goals_add": "+ Thêm mục tiêu",
	"goals_active": "Đang hoạt động",
	"goals_completed": "Đã hoàn thành",
	"goals_empty_state": "Tạo mục tiêu đầu tiên",
	"goals_status_on_track": "Đúng tiến độ",
	"goals_status_behind": "Chậm tiến độ",
	"goals_status_ahead": "Vượt tiến độ",
	"goals_status_overdue": "Quá hạn",
	"goals_status_insufficient_data": "Thiếu dữ liệu",
	"goals_extend_date": "Gia hạn ngày",
	"goals_mark_complete": "Đánh dấu hoàn thành",
	"goals_mark_abandoned": "Đánh dấu bỏ qua",
	"goals_complete": "Hoàn thành",
	"goals_marked_complete": "Đã đánh dấu hoàn thành mục tiêu.",
	"goals_abandoned": "Đã bỏ qua mục tiêu."
```

> Complete remaining per-page literals via the migration loop.

- [ ] **Step 4: Regenerate**

Run: `pnpm exec paraglide-js compile --project ./project.inlang --outdir ./src/lib/paraglide`

- [ ] **Step 5: Replace markup** in `budgets`, `reports`, `goals` pages (import + replace every literal). For status enums rendered from data (on_track/behind/…), use an explicit `switch` in the script block — it keeps `pnpm check` clean (dynamic key access on the `m` namespace trips `Element implicitly has 'any'`):

```svelte
<script lang="ts">
	function goalStatusLabel(status: string): string {
		switch (status) {
			case 'on_track': return m.goals_status_on_track();
			case 'behind': return m.goals_status_behind();
			case 'ahead': return m.goals_status_ahead();
			case 'overdue': return m.goals_status_overdue();
			case 'insufficient_data': return m.goals_status_insufficient_data();
			default: return status;
		}
	}
</script>
```

Then `{goalStatusLabel(goal.status)}` in markup. (Dynamic `m[\`goals_status_${status}\`]()` works at runtime but needs a `Record<string, () => string>` cast to satisfy TS; prefer the switch.)

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
- Consumes: `common_*`, `forms_*`, `validation_*`.
- Produces: `accounts_*`, `debts_*`.

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
	"accounts_title": "Accounts",
	"accounts_add": "+ Add account",
	"accounts_assets": "Assets",
	"accounts_liabilities": "Liabilities",
	"accounts_archived": "Archived",
	"accounts_empty_assets": "No asset accounts.",
	"accounts_empty_liabilities": "No liability accounts.",
	"accounts_archive": "Archive",
	"accounts_archived_toast": "Account archived.",
	"accounts_unarchived_toast": "Account unarchived.",
	"accounts_delete_confirm_title": "Delete account?",
	"accounts_delete_confirm_body": "This will hide the account from active lists. You can restore it from a backup if needed.",
	"debts_title": "Debts",
	"debts_i_owe": "I Owe",
	"debts_owed_to_me": "Owed to Me",
	"debts_empty_i_owe": "No debts. You're debt-free! 🎉",
	"debts_empty_owed_to_me": "No one owes you money.",
	"debts_pay": "Pay",
	"debts_receive": "Receive",
	"debts_write_off": "Write off",
	"debts_payment_recorded": "Payment recorded.",
	"debts_written_off": "Debt written off.",
	"debts_select_account": "Select an account.",
	"debts_make_payment": "Make payment",
	"debts_receive_payment": "Receive payment",
	"debts_write_off_debt": "Write off debt",
	"debts_from_account": "From account",
	"debts_to_account": "To account",
	"debts_record": "Record"
```

Add to `vi.json`:
```json
	"accounts_title": "Tài khoản",
	"accounts_add": "+ Thêm tài khoản",
	"accounts_assets": "Tài sản",
	"accounts_liabilities": "Nợ phải trả",
	"accounts_archived": "Đã lưu trữ",
	"accounts_empty_assets": "Chưa có tài khoản tài sản.",
	"accounts_empty_liabilities": "Chưa có tài khoản nợ phải trả.",
	"accounts_archive": "Lưu trữ",
	"accounts_archived_toast": "Đã lưu trữ tài khoản.",
	"accounts_unarchived_toast": "Đã bỏ lưu trữ tài khoản.",
	"accounts_delete_confirm_title": "Xoá tài khoản?",
	"accounts_delete_confirm_body": "Việc này sẽ ẩn tài khoản khỏi danh sách đang hoạt động. Bạn có thể khôi phục từ bản sao lưu nếu cần.",
	"debts_title": "Công nợ",
	"debts_i_owe": "Tôi nợ",
	"debts_owed_to_me": "Người khác nợ tôi",
	"debts_empty_i_owe": "Không có khoản nợ nào. Bạn đã hết nợ! 🎉",
	"debts_empty_owed_to_me": "Chưa ai nợ tiền bạn.",
	"debts_pay": "Trả",
	"debts_receive": "Nhận",
	"debts_write_off": "Xoá nợ",
	"debts_payment_recorded": "Đã ghi nhận thanh toán.",
	"debts_written_off": "Đã xoá khoản nợ.",
	"debts_select_account": "Chọn tài khoản.",
	"debts_make_payment": "Thực hiện thanh toán",
	"debts_receive_payment": "Nhận thanh toán",
	"debts_write_off_debt": "Xoá khoản nợ",
	"debts_from_account": "Từ tài khoản",
	"debts_to_account": "Đến tài khoản",
	"debts_record": "Ghi nhận"
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
- Produces: `settings_*`, `categories_*`, `onboarding_*` (extend), `layout_*`.

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
	"settings_title": "Settings",
	"settings_categories": "Categories",
	"settings_categories_desc": "Manage buckets and tags",
	"settings_backup": "Backup & Data",
	"settings_backup_desc": "Export, import, and manage backups",
	"settings_theme": "Theme",
	"settings_theme_auto": "auto",
	"settings_theme_light": "light",
	"settings_theme_dark": "dark",
	"settings_language": "Language",
	"settings_version": "Notchy v0.1.0",
	"categories_title": "Categories",
	"categories_add_tag": "+ Add tag",
	"categories_uncategorise": "Uncategorise (mark as deleted)",
	"categories_merge_into": "Merge into:",
	"categories_system": "system",
	"categories_tag_updated": "Tag updated.",
	"categories_tag_created": "Tag created.",
	"categories_tag_deleted": "Tag deleted.",
	"categories_delete_confirm_title": "Delete tag?",
	"categories_delete_confirm_body": "This tag has no transactions. It will be soft-deleted.",
	"layout_search_placeholder": "Search transactions, payees…",
	"layout_menu": "Menu",
	"layout_home": "Home",
	"layout_trans": "Trans",
	"layout_budget": "Budget",
	"layout_reports": "Reports",
	"layout_warming_up": "Warming up",
	"layout_add_transaction": "Add transaction"
```

Add to `vi.json`:
```json
	"settings_title": "Cài đặt",
	"settings_categories": "Nhãn",
	"settings_categories_desc": "Quản lý nhóm và nhãn",
	"settings_backup": "Sao lưu & Dữ liệu",
	"settings_backup_desc": "Xuất, nhập và quản lý bản sao lưu",
	"settings_theme": "Giao diện",
	"settings_theme_auto": "tự động",
	"settings_theme_light": "sáng",
	"settings_theme_dark": "tối",
	"settings_language": "Ngôn ngữ",
	"settings_version": "Notchy v0.1.0",
	"categories_title": "Nhãn",
	"categories_add_tag": "+ Thêm nhãn",
	"categories_uncategorise": "Bỏ phân loại (đánh dấu xoá)",
	"categories_merge_into": "Gộp vào:",
	"categories_system": "hệ thống",
	"categories_tag_updated": "Đã cập nhật nhãn.",
	"categories_tag_created": "Đã tạo nhãn.",
	"categories_tag_deleted": "Đã xoá nhãn.",
	"categories_delete_confirm_title": "Xoá nhãn?",
	"categories_delete_confirm_body": "Nhãn này không có giao dịch. Nó sẽ bị xoá mềm.",
	"layout_search_placeholder": "Tìm giao dịch, người nhận…",
	"layout_menu": "Menu",
	"layout_home": "Trang chính",
	"layout_trans": "Giao dịch",
	"layout_budget": "Ngân sách",
	"layout_reports": "Báo cáo",
	"layout_warming_up": "Đang khởi động",
	"layout_add_transaction": "Thêm giao dịch"
```

> Complete remaining literals via the migration loop.

- [ ] **Step 4: Regenerate**

Run: `pnpm exec paraglide-js compile --project ./project.inlang --outdir ./src/lib/paraglide`

- [ ] **Step 5: Replace markup in all Wave 5 files**

- In `onboarding/+page.svelte`: **remove every `{locale === 'vi' ? '…' : '…'}` inline conditional** and replace with `m.onboarding_*()` calls. For each conditional, add the corresponding `onboarding_*` key (en + vi) using the value already present in the conditional as the source text, then call it.
- In `+layout.svelte`: replace `Warming up` → `{m.layout_warming_up()}` and the Modal `title="Add transaction"` → `title={m.layout_add_transaction()}`.
- In layout components: replace `Home`/`Trans`/`Budget`/`Reports` (BottomNav), search placeholders (TopBar), etc.

- [ ] **Step 6: Move date helper vi literals to message keys**

In `src/lib/utils/date.ts`, `formatDateRelative` returns hardcoded `'Hôm nay'`/`'Hôm qua'`/`'Today'`/`'Yesterday'`. Refactor to read from messages:

```ts
import * as m from '$lib/paraglide/messages';

export function formatDateRelative(dateStr: string, locale: Locale): string {
	// ... existing same-day / prior-day logic ...
	// setLanguageTag is synced to settings.locale in SettingsStore, so the
	// active message tag already matches the locale these messages need to
	// render in. Return the message directly — no locale branch required.
	if (isToday) return m.common_today();
	if (isYesterday) return m.common_yesterday();
	...
}
```

> The `locale` param is kept in the signature so call sites don't need touching, even though it's no longer used inside this branch. (It may still drive the full-date format fallback elsewhere in the function.) The existing `formatDateRelative` tests assert `'Hôm nay'`/`'Today'` — they still pass because the message values match and `setLanguageTag('vi')`/`('en')` is called in the test setup. Run `pnpm test` to confirm.

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
grep -rnE "['\"](Save|Cancel|Delete|Edit|Add|Settings|Dashboard|Transactions|Accounts|Goals|Debts|Reports|Budgets)['\"]" src/routes src/lib/components --include='*.svelte'
```
This matches both single- and double-quoted literals (svelte markup uses both). Expected: no user-facing literal matches (ignore matches inside `m.*()` calls, `import` paths, or non-user contexts like `data-*` keys / CSS classes). Any remaining literal → add a key and replace.

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

- **Spec coverage:** §1 plumbing → Task 1. §1.2 namespacing → Task 1 + used throughout (underscore-prefix convention). §1.3 plurals/interpolation → Task 3 (`transactions_count`). §2 waves → Tasks 2–6. §3 formatting verification → Task 6 Step 6 (date literals) + Task 7. §4 testing → every task has a failing-test step; linters enforced in Task 7. §5 scope (out-of-scope items) → none implemented. All spec sections covered.
- **Key-naming premise verified:** Paraglide 1.11.8 rejects dotted IDs (reproduced); keys are flat underscore identifiers grouped by feature prefix. 2.x upgrade rejected (bracket-access, not nested) — see Global Constraints ADR.
- **Type consistency:** message function names match the JSON keys verbatim (`nav_dashboard`, `transactions_count`, `goals_status_on_track`); `setLanguageTag`/`m` import paths identical across tasks. `Locale` type unchanged. Goal status enum handled via `goals_status_*` naming + explicit switch.
- **Placeholder scan:** migration loops intentionally defer exhaustive literal enumeration to the implementer reading each file (the file is the source of truth and hand-listing 560 strings would be stale/plausible-but-wrong). Every task still ships concrete seed keys, a representative test, the exact regen command, and the replacement pattern. No "TBD"/"add error handling" language.
