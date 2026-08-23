---
target: app (all pages)
total_score: 30
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 1
timestamp: 2026-08-22T12-27-18Z
slug: src-routes-page-svelte
---
Method: dual-agent (A: a80d54ba6a0f32500 · B: CLI detector — 0 findings, no browser overlay available)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Loading/error states present but minimal (plain text, no skeleton/spinner) |
| 2 | Match Between System and Real World | 4 | Adding-machine metaphor is coherent and finance-native throughout |
| 3 | User Control and Freedom | 3 | Escape closes modals; undo on FrequentTransactions; but transaction delete has no undo |
| 4 | Consistency and Standards | 3 | Mostly consistent; `aria-pressed` on radiogroup children is technically wrong |
| 5 | Error Prevention | 2 | No confirmation on transaction delete; no inline amount validation |
| 6 | Recognition Rather Than Recall | 4 | FrequentTransactions, auto-tags, draft persistence, default account memory |
| 7 | Flexibility and Efficiency of Use | 3 | Quick-add shortcut, keyboard nav in modals; no bulk actions, no multi-select |
| 8 | Aesthetic and Minimalist Design | 4 | Distinctive adding-machine identity; 7 color tokens; purposeful typography |
| 9 | Error Recovery | 2 | Raw error strings with no retry, no guidance, no expandable detail |
| 10 | Help and Documentation | 2 | Tour only; no tooltips, no inline help, no keyboard shortcut reference |
| **Total** | | **30/40** | **Good** |

## Design Specificity Verdict

**Highly specific.** The adding-machine metaphor is architecturally embedded — segmented VFD progress bars, phosphor glow, `plate` micro-labels, oxblood debit accent, warm near-black casing, quick-add terminal aesthetic. A different product could not adopt this without fundamental redesign. Color tokens (`ink`, `tape`, `ledger`, `dim`, `line`, `phosphor`, `debit`) are named after the physical metaphor, not generic UI roles.

The one exception: Settings page cards use a generic `bg-tape rounded-lg border border-line` pattern that reads as a standard card list — the least identity-bearing surface.

**Deterministic scan:** CLI detector found 0 issues across `src/routes/` and `src/lib/components/`. No browser overlay available (automation not exposed this session).

## Overall Impression

The adding-machine metaphor is genuinely product-specific — rare for a side project at this maturity. The visual identity is tight, the color palette is disciplined, and the empty-state teaching is above-average. The biggest gap between identity quality and interaction quality is in error handling: the UI looks production-grade but fails gracefully in a pre-alpha way (raw strings, no retry, no guidance). Closing that gap would materially change how "finished" the product feels.

## What's Working

**1. The identity is real, not cosmetic.** The segmented progress bar is not a styled `<div>` — it's a discrete-cell component that reinforces the adding-machine metaphor. `plate` labels appear at consistent weight across nav, sections, and metadata. `figures-glow` carries a resting phosphor bloom. This is design at the component level, not a skin.

**2. Empty-state teaching.** The dashboard's budget section replaces a blank card with illustrative sample data using real `Progress` components. The `EmptyState` primitive with `▮▯▯▯` VFD-block icon is visually coherent. This is better than most finance apps.

**3. Session memory reduces friction at key moments.** Draft persistence, last-used account/date, default account resolution on window focus, and FrequentTransactions one-tap repeat all reduce cognitive load at the most common action points.

## Priority Issues

### [P0] Error states are undiagnosable
All four main pages display raw store error strings with no structure, no retry mechanism, and no "what to do next." A user seeing "database_update_required" on quick-add has no path to resolution.
**Fix:** Create an `ErrorState` component with icon, headline, description, and optional retry action. Map known error codes (`database_update_required`, `account_not_found`) to human-readable guidance with suggested next steps.
**Suggested command:** `/impeccable harden`

### [P1] No confirmation or undo on destructive actions
Transaction delete fires immediately with no confirmation. Account archive has no undo. Budget allocation saves with no revert path. Only FrequentTransactions has toast-based undo.
**Fix:** Add `ConfirmDialog` to transaction delete (pattern already exists on accounts page). Add undo toast to archive/delete operations.
**Suggested command:** `/impeccable harden`

### [P2] TransactionForm kind radiogroup presents 5 equal-weight options
"Refund" and "adjustment" are infrequent but given equal visual weight as expense/income. On small screens these wrap to two rows.
**Fix:** Progressive disclosure — default to expense/income with a "More kinds" toggle. Or visually group common kinds vs. advanced.
**Suggested command:** `/impeccable distill`

### [P3] Dashboard information hierarchy is flat
Five sections stacked at equal visual weight. Net position (the most important signal) and FrequentTransactions (a shortcut) look the same.
**Fix:** Elevate net position with larger padding. Demote FrequentTransactions below the fold. Consider a hero + two-column layout.
**Suggested command:** `/impeccable layout`

### [P3] ARIA radiogroup semantics are wrong
TransactionForm and Settings use `role="radiogroup"` with `aria-pressed` on children. The correct pairing is `role="radio"` with `aria-checked`, or `role="group"` with `aria-pressed` on plain buttons.
**Fix:** Either change to `role="radio"` + `aria-checked`, or change container to `role="group"`.
**Suggested command:** `/impeccable harden`

## Persona Red Flags

### Alex (Power User)
- No keyboard shortcut for transaction delete (context-menu only)
- No bulk select or batch operations on transactions list
- Transaction list is paged at 50 with no infinite scroll or search-and-jump
- Budget edit has no keyboard shortcut to open (click input, type, Enter)

### Jordan (First-Timer)
- "Adjustment" and "refund" transaction kinds have no inline explanation
- Error messages are raw technical strings ("database_update_required")
- No tooltip or help icon anywhere in Settings
- Quick-add "ESC" label is unexplained

### Sam (Accessibility-Dependent)
- `aria-pressed` on radiogroup children is semantically incorrect
- Loading state is plain text with no ARIA live region announcement
- Mobile sidebar is completely hidden — no hamburger menu or bottom nav
- Budget month navigation has no bounds — can navigate to empty months with no warning

## Minor Observations

- Transaction date display is inconsistent: transactions page uses `formatDateRelative()`, dashboard shows raw `{tx.date}`
- FrequentTransactions threshold is `items.length >= 3` — users with 1-2 frequent payees see nothing
- Budget page month navigation has no bounds check — can go to any month
- `bg-tape` vs `surface` class duplication exists — a future token change requires updating both
- Loading states are uniform plain text — no skeleton/spinner on any page
- Sample budget ratios (rent > groceries > savings) are culturally specific, not universal

## Questions to Consider

1. Is the flat dashboard optimized for scanning or for building? The single-column stack is easy to maintain but forces users to scroll past shortcuts to reach information.
2. Could quick-add be an inline slide-out panel instead of a separate Tauri window? This would serve the same purpose with less cognitive overhead.
3. Should the undo pattern (currently only on FrequentTransactions) be standardized across all destructive actions?
