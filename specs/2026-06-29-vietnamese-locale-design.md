# Vietnamese Locale — Full Bilingual Design

**Date:** 2026-06-29
**Status:** Approved (pending implementation plan)
**Goal:** Make the app work fully in both English and Vietnamese (`en` + `vi`), with Vietnamese as a first-class, complete, fully-translated locale.

## Problem Statement

Paraglide JS i18n is wired up but **barely used**. Findings from exploration:

- `messages/en.json` and `messages/vi.json` hold ~24 flat keys (nav labels + onboarding).
- **None of those message functions are called anywhere in the codebase.** Every page (`dashboard`, `transactions`, `budgets`, `reports`, `accounts`, `goals`, `debts`, `settings`, `settings/categories`) and every form (`TransactionForm`, `AccountForm`, `GoalForm`) hardcodes ~560 user-facing strings as plain English.
- The `onboarding` page is the worst: ~40 strings via inline `{locale === 'vi' ? 'vi text' : 'en text'}` conditionals that bypass Paraglide entirely.
- **`setLanguageTag` is never called.** Paraglide's module-level active locale defaults to `en` and nothing syncs `settings.locale` into it — so even where messages existed, they could never have rendered in Vietnamese at runtime.
- Number/currency/date formatting and amount parsing are **already locale-aware and tested** (`vi-VN`/`en-US`, `"1.5tr"` parsing) — these are fine.

Net effect: switching to Vietnamese flips only the nav labels; everything else stays English.

## Decisions

- **End goal:** Full bilingual (`en` + `vi`). English stays complete; Vietnamese becomes complete and high-quality.
- **Default language:** `en` (unchanged). No OS-locale auto-detection; users pick `vi` in onboarding/settings, persisted in DB via `meta` as today.
- **Translation ownership:** Implementation writes both `en` and `vi`; user reviews the complete `vi.json` in one pass at the end.
- **Key layout:** Namespaced by feature (dot-notation key strings in the existing inlang message JSON format). Old flat keys removed.
- **Approach:** Page-by-page migration with an early shared namespace — atomic, reviewable, testable per wave.

## Section 1 — Plumbing (foundation)

### 1.1 Paraglide runtime sync

Paraglide holds its active locale in a module-level `languageTag` (`src/lib/paraglide/runtime.js`) defaulting to `en`. Sync `settings.locale` into it via explicit calls at every write site:

- In `SettingsStore` (`src/lib/stores/settings.svelte.ts`), call `setLanguageTag(locale)` at the end of `load()` (boot) and inside `setLocale()` (user change). These two sites are the complete set of `this.locale` mutations, so they fully cover the sync.
- Do **not** use a constructor `$effect`: Svelte 5 effects only run inside a component/effect-root context, which a plain class instance is not. It would never fire, and it would react to nothing the two explicit calls don't already cover.

### 1.2 Namespaced key layout

Replace the flat 24-key layout with namespaces. The JSON message format is unchanged (inlang message format); namespaces are a dot-notation key convention, e.g. `{ "common.save": "Save" }` / `{ "common.save": "Lưu" }`.

Namespaces:

- `common.*` — shared words: save, cancel, delete, edit, add, undo, search, amount, date, description, name, none, optional, today, yesterday, daysAgo
- `nav.*` — dashboard, transactions, budgets, reports, accounts, goals, debts, settings
- `actions.*` — action verbs reused across pages
- `transactions.*`, `budgets.*`, `reports.*`, `accounts.*`, `goals.*`, `debts.*`, `settings.*`, `categories.*`, `onboarding.*` — per-feature strings
- `forms.*` — form labels shared across TransactionForm/AccountForm/GoalForm (type labels, field labels, button labels)
- `validation.*` — form validation/error messages

The current flat keys (`nav_dashboard`, `action_save`, `onboarding_*`, `lang_*`, `app_name`) are renamed into namespaces and the old keys removed (nothing references them yet).

### 1.3 Plurals & interpolation

Use inlang/ICU MessageFormat for dynamic strings:

- Plural: `{count, plural, =0 {No transactions} one {# transaction} other {# transactions}}`
- Interpolation: `Paid {name} {amount}`

Paraglide compiles these to typed functions: `m.transactions.count({ count: 5 })`, `m.transactions.paid({ name, amount })`. Used for the ~handful of dynamic strings ("N transactions", "N days left", "You have {amount} left", "Delete {name}?").

## Section 2 — Migration Plan (waves)

Wave order is chosen so shared foundations come first; each page leans on what's already wired.

### Wave 0 — Plumbing + shared keys
- Add Paraglide runtime sync (§1.1).
- Define `common.*`, `nav.*`, `actions.*`; write en + vi for all shared words and the 7 nav labels.
- Delete old flat keys.
- TDD: write a test asserting `setLanguageTag('vi')` makes `m.nav.dashboard()` return `'Tổng quan'`; watch it fail, then implement plumbing.

### Wave 1 — Forms (shared by all pages)
- `TransactionForm`, `AccountForm`, `GoalForm`. ~135 strings.
- Defines `forms.*` (Expense/Income/Transfer/Refund/Adjustment; Checking/Savings/Cash/Credit Card/Loan to Person/Loan from Person; Savings/Debt Payoff/Net Worth) and `validation.*` (errors: "Counterparty is required for loans", "Source and destination must differ", "Name is required", etc.).

### Wave 2 — Core read pages
- `dashboard` (~30), then `transactions` (~40). Largest user surface.

### Wave 3 — Planning pages
- `budgets` (~25), `reports` (~50), `goals` (~35).

### Wave 4 — Account/debt management
- `accounts` (~45), `debts` (~50).

### Wave 5 — Settings + onboarding
- `settings` page + `settings/categories` (~65 combined).
- `onboarding` (~40): **replace all `{locale === 'vi' ? … : …}` inline conditionals** with `m.onboarding.*()` calls.
- Shared layout components (`TopBar`, `BottomNav`, `FAB`, `Sidebar`, `GlobalToast`) woven into whichever wave they naturally belong.

### Per-wave discipline
1. Extract strings → namespaced keys (en + vi together).
2. Replace markup with `m.feature.key()`.
3. Run `pnpm test`; add a small i18n test per feature asserting a representative vi string.
4. Commit per wave (`feat:`/`refactor:`).

### Vietnamese quality
Implementation writes natural finance terminology (giao dịch, ngân sách, báo cáo, tài khoản, mục tiêu, công nợ, thu/chi, chuyển khoản, hoàn tiền, điều chỉnh), not literal word-for-word. User reviews the complete `vi.json` in one pass at the end.

## Section 3 — Number / Currency / Date Formatting (verify, don't rebuild)

Formatting is already locale-aware and tested — this is verification, not new work.

- `formatCurrency` (`src/lib/utils/currency.ts`) branches on currency (`VND` 0 decimals / `USD` 2 decimals) via `Intl.NumberFormat`. Keyed off currency, not locale — correct (a Vietnamese user with a USD account wants `$` formatting). Keep as-is.
- `formatNumber` — `Intl.NumberFormat` with locale separators. Verify it receives the current locale.
- `formatDate` / `formatDateRelative` (`src/lib/utils/date.ts`) — already maps `vi-VN` → `dd/mm/yyyy` + `Hôm nay`/`Hôm qua`, `en-US` → `mm/dd/yyyy` + `Today`/`Yesterday`. During the wave that touches dates, migrate the relative labels (`Hôm nay`, `Hôm qua`, `X ngày trước`) into `common.*` Paraglide keys. Same for any other in-code vi literals.
- `parseAmount` — handles vi shortcuts (`"1.5tr"`). No change.
- Existing `src/tests/unit/i18n.test.ts` already covers both locales.

**Action item:** audit these helpers to confirm they read locale from `settings.locale` (now synced to Paraglide), and move any hardcoded vi literals into message keys during the relevant wave.

## Section 4 — Testing Strategy

TDD per the project discipline: add a failing test before wiring each wave, then make it pass.

- **Existing tests:** extend `src/tests/unit/i18n.test.ts`; don't duplicate.
- **Plumbing test (Wave 0):** `setLanguageTag('vi')` → `m.nav.dashboard()` returns `'Tổng quan'`. Written first, fails, then plumbing passes.
- **Per-feature coverage:** one representative vi-string assertion per feature (wiring is mechanical; parity is enforced by linters, below).
- **Linters guard parity:** `project.inlang/settings.json` loads `message-lint-rule-empty-pattern` and `message-lint-rule-missing-translation` — these flag any en key missing a vi translation (or vice versa). This is the safety net for 560-string parity.
- **Component tests:** update asserted hardcoded English to localized values where tests assert on rendered text.
- **E2E:** optional smoke test ("switch to vi → page shows Vietnamese heading"). Marked YAGNI unless requested.

## Section 5 — Scope Boundaries

### In scope
- Paraglide runtime sync.
- Namespaced key layout; old flat keys removed.
- Migrate all ~560 hardcoded strings → `m.*()` (en + vi) across all pages, forms, layout components.
- Replace onboarding inline conditionals with Paraglide messages.
- Plurals + interpolation via ICU for dynamic strings.
- Move in-code vi literals into message keys.
- Verify number/currency/date helpers read the synced locale.
- Per-wave tests + inlang linters guarding parity.

### Out of scope
- OS-locale auto-detection (default stays `en`).
- Changing default language to `vi`.
- New locales beyond en/vi.
- Changing currency set or formatting logic (already correct).
- Right-to-left layout (vi is LTR).
- Changing locale persistence mechanism (stays DB via `meta`).
- Third-party translation tooling / Sherlock / Fink editor integration (edit JSON directly).

## Risks

- **Mechanical volume:** ~560 strings × manual extraction is the main effort. Mitigated by wave commits; each independently shippable.
- **ICU syntax:** plural syntax must match Paraglide's compiler exactly. Verify with a tiny key first in Wave 0 before broad use.
- **Late vi review:** terminology drift would touch many keys late — low risk since en and vi are written consistently in the same pass.

## Success Criteria

1. Switching to Vietnamese flips the entire app — every visible string, no English leftovers.
2. `en.json` and `vi.json` have identical key sets (linters enforce).
3. All existing tests pass; new per-wave tests pass.
4. Dynamic strings (counts, dates, names) interpolate correctly in both languages.
