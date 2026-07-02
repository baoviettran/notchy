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

<!-- Feature sections 1–11 are appended below by subsequent tasks. -->

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
