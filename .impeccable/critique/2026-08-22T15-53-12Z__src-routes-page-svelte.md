---
target: the dashboard (src/routes/+page.svelte)
total_score: 32
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
timestamp: 2026-08-22T15-53-12Z
slug: src-routes-page-svelte
---
⚠️ DEGRADED: single-context (Assessment A sub-agent returned truncated output twice; fell back to inline review)

Method: degraded inline (A: inline · B: CLI detector — 0 findings, no browser overlay this run)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Loading text, save/undo toasts, ErrorState+retry, budget progress; transaction delete is silent, loading stays plain text |
| 2 | Match Between System and Real World | 4 | Adding-machine metaphor coherent and finance-native; teaching states speak plainly |
| 3 | User Control and Freedom | 3 | Esc everywhere, cancel buttons, undo on archive + repeat; transaction delete is confirm-only, no undo |
| 4 | Consistency and Standards | 3 | Token system cohesive, `role="group"`+`aria-pressed` now correct; delete feedback differs across pages, ContextMenu trigger name is a concatenated blob |
| 5 | Error Prevention | 3 | Confirm dialogs on both deletes, transfer source≠dest guard, amount validation, draft recovery; account-delete impact unstated |
| 6 | Recognition Rather Than Recall | 4 | Payee/tag autocomplete, frequent-repeat chips, draft, last-used account, auto-tag indicator |
| 7 | Flexibility and Efficiency of Use | 3 | `n` opens tx modal, `/` focuses search, quick-add tray, duplicate, frequent repeat; no bulk actions |
| 8 | Aesthetic and Minimalist Design | 4 | Distinctive VFD identity; balanced 2-col grid; no wasted pixels |
| 9 | Error Recovery | 3 | ErrorState+retry everywhere, mapError human strings, inline form errors preserve input |
| 10 | Help and Documentation | 2 | Replayable tour + teaching empty states; transaction kinds unglossed, no tooltips, no shortcut reference |
| **Total** | | **32/40** | **Good** |

## Design Specificity Verdict

**Highly specific.** The VFD adding-machine metaphor is embedded at the component level — segmented progress bars, phosphor glow with a keypress flash keyframe, `plate` micro-labels, oxblood debit, warm near-black casing, quick-add terminal window. Token names (`ink`, `tape`, `ledger`, `line`, `phosphor`, `debit`) are named after the physical metaphor, not generic UI roles. The sample-budget teaching state is scaled to the user's currency — the only app I've seen that does that. A different product could not adopt this look without a fundamental redesign.

**Deterministic scan:** CLI detector found 0 issues. No browser overlay this run (degraded — no browser step executed).

## Overall Impression

The gap the last critique flagged — "UI looks production-grade but fails gracefully in a pre-alpha way" — is closed. Error handling is now genuinely production-grade: every list page has a structured ErrorState with retry, errors are mapped to human strings, and inline form errors preserve input. Destructive actions got real protection. The design identity was already the strong suit and it still is. What now holds the score below "excellent" is depth: help for the advanced transaction kinds, and honesty at the edge cases (account-delete impact, import invalid-row reasons). Those are polish problems, not structural ones — the app is now coherent end to end.

## What's Working

**1. Error handling now matches the design identity.** ErrorState (`role="alert"` + `aria-live="assertive"`, icon, headline, description, retry) on every list page; `mapError` turns store errors into plain-language messages; inline form errors set `error` without wiping the form. This was the P0 a run ago — it's solved.

**2. Destructive actions got genuine protection.** ConfirmDialog before both deletes, undo toasts on account archive and frequent-repeat (with exact-row deletion on undo — not "most recent"), Esc + focus-trap in dialog, modal, and context menu. Recovery is now a real design language, not an afterthought.

**3. Progressive disclosure where load was highest.** The kind toggle defaults to expense/income with a "More" toggle (aria-expanded), and the dashboard moved from a flat single-column stack to a hero + 2-column grid + goals hierarchy. Both cut cognitive load at the two most-attended screens.

## Priority Issues

### [P1] Account deletion is a black box
`accounts.delete(id)` fires from a generic ConfirmDialog that says nothing about linked transactions. If delete cascades, the user silently loses transaction history; if it's blocked by the DB, `mapError` gives a toast that doesn't say why.
**Why it matters:** This is the single most data-destructive action in the app, and the confirmation treats it like renaming a file.
**Fix:** Query the transaction count for the account before confirming; show "This will delete 143 transactions" in the dialog, with a hard double-confirm (type-the-name or explicit second step).
**Suggested command:** `/impeccable harden`

### [P1] Transaction kinds are unglossed — Refund/Adjustment are guessed at
The kind toggle reveals transfer/refund/adjustment behind "More," but nothing explains what they mean or when to use them. A first-timer picking between Refund and Adjustment is making a coin flip that mislabels a transaction.
**Why it matters:** Misclassified transactions corrupt every downstream view (budget, net position, reports) without the user knowing they chose wrong.
**Fix:** One-line description under each advanced kind when revealed, or a tooltip on the toggle. The tour covers the main flow but not kind semantics.
**Suggested command:** `/impeccable clarify`

### [P2] Transaction delete has no success feedback and no undo — inconsistent with account delete
Transactions: confirm → row vanishes, no toast, no undo. Accounts: confirm → toast with result. Two deletes, two recovery models.
**Why it matters:** Users learn one recovery language and get a different one for the same action elsewhere; an accidental transaction delete is silently permanent.
**Fix:** Add a success toast to transaction delete, and give it the same undo treatment as archive/repeat (delete is reversible via re-create — the undo can reinsert the row from the deleted payload).
**Suggested command:** `/impeccable harden`

### [P2] Import: invalid rows don't say why, and the summary and commit numbers disagree
Invalid rows render dimmed with a status word, but no per-row reason (missing date? unparseable amount? negative?). Meanwhile the summary line shows `new/dup/invalid` while the commit button shows `included` — two different counts on one screen.
**Why it matters:** Users can't fix their CSV without guessing, and the two numbers make it look like rows will be dropped.
**Fix:** Per-row reason text on invalid rows (the store knows why — surface it), and align the summary with the included count.
**Suggested command:** `/impeccable harden`

### [P2] Learned rules are invisible and unmanageable
`rules.learnRule(payee, tagId)` fires silently on every save. The only signal is a small "Auto" caption under the tag field; there's no surface to view, edit, or delete learned rules, so a wrong rule persists until the user notices and manually overrides.
**Why it matters:** Auto-categorization the user can't see or correct erodes trust in the numbers — a user who catches a mis-categorization wonders how many others they missed.
**Fix:** A rules management surface in settings (list rules, toggle off, delete), and make the "Auto" indicator clickable to reveal which rule matched.
**Suggested command:** `/impeccable onboard`

## Persona Red Flags

**Alex (Power User)**
- Good: `n` opens the transaction modal, `/` focuses search, quick-add tray, duplicate action, frequent-repeat chips, last-used account/date memory.
- Flags: No bulk select/batch edit on the transactions list; pagination is fixed at 50 with no page-size control; no keyboard shortcut for delete (context menu only); duplicate fires without confirm — a double-click duplicates twice.

**Sam (Accessibility-Dependent)**
- Good: `role="group"` + `aria-pressed` pairing now correct; ErrorState announces via `aria-live`; modal/menu focus traps and arrow-key nav in ContextMenu; amount color is always paired with a −/+ symbol.
- Flags: The ContextMenu trigger's accessible name on transactions is a concatenated blob — `m.transactions_duplicate() + ' · ' + m.common_delete()` reads as "Duplicate · Delete" in one string. Loading states are plain text with no `aria-live`, so a screen-reader user hears nothing during load.

**Riley (Stress Tester)**
- Flags: Account-delete impact uncommunicated (would cascade? blocked?); transaction delete is permanent after confirm; import invalid rows give no reason; payee has no maxlength (description caps at 1024); duplicate double-fire risk.

## Minor Observations

- Transactions count row has a dead branch: `{displayItems.length === 0 ? m.transactions_count_none() : ...}` sits inside `{#if displayItems.length > 0}` — the `count_none` string is unreachable.
- Date display inconsistency persists: dashboard recent list shows raw ISO `{tx.date}`, transactions page uses `formatDateRelative()`.
- FrequentTransactions card only renders at ≥3 frequent payees — users with 1-2 see nothing and get no hint the feature exists.
- The repeat undo toast is 5s — tight for an undo users often reach for after the fact.
- Sample budget "savings" bucket implies a savings mechanic the app doesn't act on.

## Questions to Consider

1. Deleting an account with N transactions is the most data-destructive action in the app — what if the confirm showed "This will delete 143 transactions" and required a hard second step instead of a generic dialog?
2. Rules learn invisibly on every save — what if learned rules were a first-class, editable surface instead of a silent side effect?
3. The undo toast on repeat lasts 5s and transaction delete has no undo at all — what if undo were standardized across every destructive action so users never learn two recovery models?
