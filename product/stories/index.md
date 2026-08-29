# User Story Inventory

> Source of truth for **what** Notchy is for. Numbered, need-shaped, evidence-anchored.
> See [README.md](./README.md) for the rules. A spec/plan without a `Serves:` trace is a defect.

Legend — **Status:** `shipped` (a user can do this today) / `planned` (spec'd, not yet shipped) / `backlog` (real need, no spec). **Evidence:** the anchor that makes it a real need, not a wish.

| ID | Story name | Need (JtBD) | Motivation | Evidence | Status | Serves |
| --- | --- | --- | --- | --- | --- | --- |
| STORY-001 | The native app must actually work | I open Notchy as a desktop app and my saves/loads go through, on the real Rust path | The shipped product runs `NativeDatabaseClient` (70 Rust commands); if that seam silently breaks, correctness is fake — UI green but data lost | Bug inventory row 9: native seam has **zero** correctness coverage; only `native-client.test.ts` proves error-propagation | **backlog** | — |
| STORY-002 | Fast entry won't lose me | I add a transaction from the quick-capture tray while the main window is also open, and the entry is never dropped | "no such savepoint" contention cost a real entry; a lost financial record is the worst kind of bug | Bug row 1 (quick-add DB contention) — `feeb31a` | **shipped** | `2026-08-19-quick-add-ux-polish` (planned) |
| STORY-003 | My app won't brick on boot | I open Notchy twice (or two windows boot together) and it starts, not "duplicate column name" | A migration race that bricks boot is fatal — I can't reach my own money | Bug row 2 (migration idempotency) — `feeb31a` | **shipped** | `2026-08-15-quality-gate-stabilization` |
| STORY-004 | The payee I type is the payee saved | I type a brand-new payee name and it persists | A silently-dropped value corrupts a month's history with no notice | Bug row 3 (autocomplete `allowFreeText`) — `8a48997` | **shipped** | `2026-07-01-v0.1.x-quality-of-life` |
| STORY-005 | "50k" means 50,000 | I type shorthand amounts in any locale and the stored number equals what I meant | Locale-aware `parseAmount` is the contract; a pre-expanding tokenizer double-counts | Bug row 7 (tokenizer must NOT expand `k`/`m`) | **shipped** | `2026-06-29-vietnamese-locale` + `quick_parse` |
| STORY-006 | Import won't double my money | I import a CSV bank export and the same transaction never lands twice | Double-imports poison every downstream report and reconciliation | Actual→Notchy: CSV import + strict dedup spec — plan `2026-07-22-csv-import-dedup` | **shipped** | `2026-07-22-csv-import-dedup` |
| STORY-007 | My transactions sort themselves | I want past spending auto-categorized so I don't re-tag the same (coffee shop, gas) every week | Highest daily-UX-impact lift; recurring manual categorization is the #1 chore | Actual→Notchy: rules/auto-categorize spec; needs migration 005 | **planned** | `2026-07-06-categorize-rules-engine` |
| STORY-008 | I can see where the money went | I want a month's spending composition and net-worth-over-time at a glance | Answers "is this month draining me?" before it's too late; Actual's crown-jewel report depth | Actual→Notchy: reporting-depth spec; needs Layercake dep | **planned** | `2026-07-06-reporting-depth` |
| STORY-009 | Recurring bills happen once | I set up rent once and it reappears monthly, with a rollover to-budget pool | Memory + trust; the rollover asymmetry (income-from-kind) is a real subtlety Actual gets right | Actual→Notchy: scheduled txns + rollover spec; needs migration 006 | **planned** | `2026-07-06-scheduled-transactions-and-rollover-pool` |

## New-story workflow

1. Write the row with a numbered id **next available** (e.g. `STORY-010`).
2. Fill **all four** fields; if you cannot write an **Evidence** pointer, stop — it is not a story yet.
3. A spec is only written once a story says so. Add the spec to the row's `Serves:` as soon as the spec exists.
4. When the plan's final task ships, flip `Status` → `shipped`. The roadmap rollup reports untraced and unserved health.

## Health (what `pnpm test:roadmap` should report after wiring)

- Untraced specs (no `Serves:`): **22 of 23 existing** — retrofit is the transition backlog. None are real defects yet; they predate the inventory.
- Unserved **backlog** stories (real need, no spec): **1** — STORY-001 (native seam) is the sharpest relevance gap in the product today.
- Unserved **planned** stories: STORY-007/008/009 are spec'd but 0% implemented (Actual roadmap status, verified 2026-07-26).