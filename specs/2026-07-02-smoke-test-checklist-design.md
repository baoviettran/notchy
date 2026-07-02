# Smoke Test Checklist — Design

**Date:** 2026-07-02
**Goal:** A comprehensive manual deep-regression smoke test checklist for pre-release verification of Notchy, plus a bug-report workflow the tester uses to report findings back to the AI assistant for fixing.
**Tester role:** Human at `pnpm tauri dev` (and `pnpm tauri build` for release binary).

## Context & Decisions

### What exists today

- **297 unit/component tests** (Vitest, all green) — cover repos, utilities, stores, components
- **22 E2E tests** (Playwright, all green) — cover every route with smoke + depth on transactions/accounts/budgets/backup-restore
- **Short manual smoke note** at `specs/notes/2026-07-01-v0.1.2.md` — covers only the tray/quick-capture desktop features added in v0.1.2

### What's missing

- No systematic, end-to-end manual verification across all features
- No dark-mode / light-mode visual check across all routes
- No Vietnamese locale check across all routes
- No edge-case/error-state manual verification (empty states, validation errors, large datasets)
- No release-build verification (binary compiles, launches, no dev artifacts visible)
- No structured way to report findings back for collaborative fixing

### Design Decisions

1. **Checklist format: Section-per-feature walkthrough (Sequential Feature Tour).** Each section covers one feature area with checks for: happy path, Vietnamese locale, light mode, empty states, error states, and edge cases. This is more natural for a human than a matrix or two-pass approach.

2. **File location: `specs/2026-07-02-smoke-test-checklist.md`.** Lives in `specs/` per project convention (NOT `docs/superpowers/specs/` — `docs/` is a git submodule). This file is the artifact the tester fills in and commits.

3. **Bug report workflow: Inline + template.** Each check item has an inline `🐛 BUG:` field for a brief one-line note on any failure (filled as the tester goes). Separately, at the end of the file sits a fuller Quick Bug Report Template for pasting a single urgent issue into chat mid-run when the tester wants an immediate fix without finishing the whole checklist. The two serve different modes: inline = batch (report all at the end), template = interrupt (fix one now).

4. **Scope: All v0.1 features + v0.1.2 tray.** Covers every route and feature listed in ROADMAP.md § "v0.1.0 Delivered" plus the v0.1.2 tray quick-capture.

### What's explicitly OUT

- Automated test additions (this is a manual verification spec)
- v0.2 web-build checks (the checklist runs against Tauri desktop)
- Performance benchmarking
- Accessibility audit (WCAG)
- Cross-platform testing matrix (the tester runs on their current OS only)

## Checklist Structure

### Section order

| # | Section | Time est. |
|---|---------|-----------|
| 0 | Pre-flight (build checks, automated tests) | 5 min |
| 1 | Onboarding (fresh start path, en + vi, error states) | 10 min |
| 2 | Dashboard (widgets, navigation, mode/locale) | 5 min |
| 3 | Transactions (CRUD, transfers, refunds, adjustments, edge cases) | 15 min |
| 4 | Accounts & Reconciliation | 10 min |
| 5 | Budgets (envelope allocation, month nav, roll-over) | 10 min |
| 6 | Goals (create, progress, lifecycle, velocity) | 10 min |
| 7 | Debts (I owe / owed to me, counterparty) | 10 min |
| 8 | Reports (overview, trend, compare) | 10 min |
| 9 | Settings (categories, backup, quick-add account, mode, locale, shortcuts) | 15 min |
| 10 | Tauri Desktop Smoke (tray, shortcut, cross-window, quick-add) | 10 min |
| 11 | Release Build (binary compilation, launch, version, no dev artifacts) | 5 min |

**Total estimate: ~2 hours**

### Item format

Every check follows this template:

```markdown
- [ ] **Action description** — _Expected outcome_
  - 🐛 BUG:
```

The `🐛 BUG:` line stays blank on pass. On failure, the tester fills in what happened vs. what was expected.

### Cross-cutting checks per section

Every feature section (1–9) includes checks for:
- **Dark mode** (default) — the standard path
- **Vietnamese locale** — switch via Settings, verify labels and data rendering
- **Light mode** — switch via Settings, verify readability and contrast
- **Empty state** — what the page looks like with no data
- **Error state** — validation errors, rejected inputs, boundary conditions

Sections 10 (Tauri Desktop) and 11 (Release Build) are desktop/OS-specific; they do not have mode/locale sub-checks (those are already covered in sections 1–9).

## File Format

The checklist file includes:

1. **Header** — title, date, tester name field, instructions
2. **Section 0: Pre-flight** — automated test + build gates
3. **Sections 1–11** — detailed checklist items
4. **Results Summary** — pass/fail counts, total bugs
5. **Quick Bug Report Template** — for pasting individual issues into chat

## Bug Report Workflow

### During the checklist run

The tester fills `🐛 BUG:` inline for any failing item. They can:
- **Continue** — finish the checklist, then report all bugs at once
- **Interrupt** — paste a single urgent bug into chat for immediate fixing

### Quick Bug Report Template

```
**Section:** [section number and name]
**Check item:** [the failing check]
**What happened:** [observed behavior]
**What was expected:** [expected behavior per the check]
**Screenshot (if helpful):** [paste or describe]
```

### After the run

The tester says "done" or "ready for review" in chat. The AI assistant reads `specs/2026-07-02-smoke-test-checklist.md`, processes all `🐛 BUG:` entries, and works through fixes one at a time.

## Testing

This spec has no automated tests — it *is* the test artifact. It is validated by running it against the app and confirming all items can be checked off.
