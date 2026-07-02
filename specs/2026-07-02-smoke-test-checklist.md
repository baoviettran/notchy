# Notchy — Pre-Release Smoke Test Checklist

**Date run:** _______________
**Tester:** _______________
**App version:** v0.1.2
**Spec:** `specs/2026-07-02-smoke-test-checklist-design.md`

## How to use this checklist

1. Run `pnpm tauri dev` for sections 0–10. Run `pnpm tauri build` for section 11.
2. Work top to bottom. For each item, perform the **bold action** and confirm the _italicised expected outcome_.
3. On pass, leave the `🐛 BUG:` line blank. On failure, fill in what happened vs. what was expected.
4. **Two ways to report bugs:**
   - **Inline (batch):** fill `🐛 BUG:` as you go; say "done" in chat at the end and the assistant reads this file.
   - **Interrupt (one now):** copy the **Quick Bug Report Template** at the bottom of this file, fill it, paste into chat for an immediate fix without finishing the run.
5. Every feature section (1–9) includes cross-cutting checks: **dark mode** (default), **Vietnamese locale**, **light mode**, **empty state**, **error state**. Switch theme/locale via Settings.

---

## Section 0 — Pre-flight (≈5 min)

Automated gates must be green before manual testing begins.

- [ ] **`pnpm install` completes with no errors** — _Dependencies resolve cleanly._
  - 🐛 BUG:
- [ ] **`pnpm test` — all unit/component tests pass** — _Expected: 297/297 passing (Vitest)._
  - 🐛 BUG:
- [ ] **`pnpm check` — type check clean** — _Expected: 0 errors, 0 warnings (svelte-check)._
  - 🐛 BUG:
- [ ] **`pnpm test:e2e` — all Playwright tests pass** — _Expected: 22/22 passing._
  - 🐛 BUG:
- [ ] **`pnpm tauri dev` launches the desktop app** — _Main window opens, no errors in the dev console (open devtools), app loads on the dashboard or onboarding._
  - 🐛 BUG:

---

## Section 1 — Onboarding (≈10 min)

Fresh-start path. To reach onboarding, wipe the app data (delete the Tauri app-data DB / use a clean install) so the app has no accounts, then relaunch `pnpm tauri dev`.

- [ ] **With no existing data, the app opens on the onboarding flow** — _First screen asks to choose a language (English / Tiếng Việt)._
  - 🐛 BUG:
- [ ] **Choose English → choose a currency → create the first account (e.g. a checking account)** — _Onboarding completes and the app lands on the dashboard (`/`) with the new account visible._
  - 🐛 BUG:
- [ ] **Vietnamese path: wipe data, relaunch, choose Tiếng Việt** — _All onboarding step labels, buttons, and placeholders render in Vietnamese (no English fallback strings)._
  - 🐛 BUG:
- [ ] **Vietnamese path: complete onboarding (currency → first account)** — _Completes and lands on the dashboard with Vietnamese labels._
  - 🐛 BUG:
- [ ] **Light mode: switch theme to Light (Settings → Light), then re-run onboarding** — _Onboarding screens are readable in light mode (correct contrast, no dark-on-dark text)._
  - 🐛 BUG:
- [ ] **Empty state: fresh launch with no data** — _Onboarding is the only screen offered; no empty dashboard or broken nav is reachable before the first account is created._
  - 🐛 BUG:
- [ ] **Error state: try to advance past the currency/account step without making a selection** — _The Continue/Next button is disabled or shows a validation error; the app does not proceed with empty required fields._
  - 🐛 BUG:
- [ ] **Error state: enter an invalid account name (e.g. whitespace-only) or invalid opening balance** — _Input is rejected with a clear error message; no account is created with bad data._
  - 🐛 BUG:

## Section 2 — Dashboard (≈5 min)

Route: `/` (the app shell landing).

- [ ] **Dashboard loads with widgets visible** — _Account-balance summary, recent-transactions list, and any budget/goal status widgets render with real values from the data created in Section 1._
  - 🐛 BUG:
- [ ] **Dark mode (default): dashboard renders in the dark theme** — _Phosphor/amber accents, tape background, readable ledger text._
  - 🐛 BUG:
- [ ] **Vietnamese: switch locale to Tiếng Việt (Settings → Tiếng Việt)** — _Dashboard headings, widget labels, and navigation items render in Vietnamese._
  - 🐛 BUG:
- [ ] **Light mode: switch theme to Light** — _Dashboard is readable: good contrast, no washed-out text, charts/widgets legible._
  - 🐛 BUG:
- [ ] **Navigation: click each nav item (Transactions, Accounts, Budgets, Goals, Debts, Reports, Settings)** — _Each route loads without error and shows its own header/content._
  - 🐛 BUG:
- [ ] **Empty state: with a fresh DB (only the onboarding account, no transactions/budgets/goals/debts)** — _Dashboard shows sensible empty states (e.g. "no recent transactions") rather than blank panels or `undefined`._
  - 🐛 BUG:
- [ ] **Error state: malformed/missing data — delete the DB file while the app is running, then trigger a dashboard refetch (e.g. window focus / add a transaction)** — _App handles the missing DB gracefully (re-onboards or shows an error), does not crash to a white screen._
  - 🐛 BUG:

## Results Summary

Fill in after completing all sections.

- Sections passed: ___ / 12
- Total check items: ___
- Items passed: ___
- Items failed: ___
- Total bugs logged: ___

---

## Quick Bug Report Template

(Appended in the final task.)
