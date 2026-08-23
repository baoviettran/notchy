# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The developer themself, dogfooding daily on Linux as a personal money tracker. Public releases exist (GitHub binaries for Debian/Fedora/AppImage), but the primary user whose needs decide design trade-offs is the author: a privacy-conscious individual managing VND/USD personal finances across checking, savings, cash, and credit-card accounts.

## Product Purpose

Notchy is a local-first personal finance application: track transactions, envelope budgets, goals, and personal debts entirely on-device. No cloud, no accounts, no subscriptions, no telemetry. Success means the author actually uses it every day for years, trusting it with their complete financial record.

## Positioning

Data outlives the application. SQLite is the single source of truth, readable by any tool in any era (`RECOVERY.md` documents how), with auto-backup on every launch and full export/import. A cloud fintech app could copy the features but could not truthfully claim "your data stays on your device, forever readable, no network required."

## Operating Context

- Daily quick-capture: keyboard shortcut `n` opens the transaction form (amount first); a system-tray "tape" window (global shortcut) allows one-line entry with amount shortcuts like `50k`, `1.5tr`, `50k+30k`.
- `/` focuses global search; most-used transactions surface as one-tap dashboard cards.
- Monthly rituals: envelope budget review, reconciliation with adjustments, report reading (overview / trend / compare).
- Auto-categorization rules learn from behavior (3+ consistent transactions) with Vietnamese diacritic normalization.
- Runs as a Tauri v2 desktop app on Linux today; browser build planned for v0.2, file-based sync v0.3, P2P sync v0.4.

## Capabilities and Constraints

- One currency per database (VND or USD); all amounts are integers in smallest currency units — never floating point.
- 6 account types; 5 transaction kinds (expense, income, transfer, refund, adjustment).
- Envelope budgets per category with optional roll-overs; goals with velocity tracking; personal debts (I owe / owed to me).
- Bilingual English/Vietnamese via Paraglide flat keys in `messages/en.json` + `messages/vi.json`; Vietnamese is a first-class locale (diacritic legibility, ~15–30% longer strings).
- Built for a decade: pinned dependencies, reproducible builds, small and shippable releases (v0.1.x line).
- Filtering happens in SQL (`TransactionFilter`), never client-side.
- Undecided: whether macOS/Windows builds ship (planned but unbuilt).

## Brand Commitments

None locked. The "mechanical adding machine" visual world (documented in `docs/DESIGN.md`) and the plain ledger voice (*Pay, Receive, Write off*) describe the shipped implementation and are strong defaults, explicitly not binding — future work may propose alternatives through the normal new-work flow.

## Evidence on Hand

- Shipped app with real usage by the author (dogfooding since v0.1.0).
- `docs/DESIGN.md`: measured design-system documentation of the incumbent visual world.
- `README.md` / `README.vi.md`: user-facing product story in both locales.
- `SCHEMA.md`, `RECOVERY.md`: data-layer references proving the durability claim.
- `specs/`: dated design documents per feature; `specs/STATUS.md`, `ROADMAP.md`.
- Absences future work must not fabricate: no testimonials, no press, no customer evidence, no marketing assets beyond the app icon.

## Product Principles

1. **Data outlives the app.** Every feature must keep the SQLite file the source of truth, portable and readable without the app.
2. **Local-first means local-only.** No cloud, no telemetry, no required network — ever.
3. **Friction-free capture.** Recording a transaction must take seconds: amount first, smart parsing, tray quick-add, rules that learn.
4. **Built for a decade.** Prefer boring, pinned, reproducible technology over novelty.
5. **Small and shippable.** Minimal intentional scope per release; quality gates over ambition.

## Accessibility & Inclusion

WCAG AA text contrast (the incumbent palette was corrected after measurement). Keyboard-first operation is core (`n`, `/`, Escape). Hover-revealed UI must also reveal on focus and be visible on coarse pointers; color never carries meaning alone; reduced-motion disables animation and glow effects.
