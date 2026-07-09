# First-run product tour (spotlight coachmarks)

**Date:** 2026-07-09  
**Status:** Approved for implementation

## Problem

Setup onboarding (`/onboarding`: language → currency → first account) leaves users on the dashboard with no introduction to the app shell. New users need a short guided map of primary controls.

## Goals

- Spotlight coachmarks on real UI (overlay + highlight), 4–6 core steps, under ~1 minute.
- Auto-start once after setup; **Replay tour** in Settings.
- Shell-anchored: stay on `/` / shell chrome; no mid-tour route changes.
- i18n (`en` + `vi`); accessible (dialog, Escape to dismiss).
- Existing upgraded installs must **not** be interrupted by the tour.

## Non-goals

- Interactive “create a real expense” tutorial
- Multi-route walkthrough
- Dashboard checklist widget
- Tour inside the quick-add window

## Design

### State

| Meta key | Meaning |
|----------|---------|
| `first_run_complete` | Setup wizard done (existing) |
| `tour_complete` | Product tour finished or skipped (new) |

**Grandfather rule:** On tour load, if `first_run_complete=1` and `tour_complete` is missing → set `tour_complete=1`. New onboarding finish does **not** set `tour_complete`, so the tour auto-starts.

### Flow

1. Onboarding finish → `first_run_complete=1` → `goto('/')`.
2. Main layout: if `firstRunComplete && !tourComplete` → start tour.
3. Next / Back / Skip / Escape → skip or finish sets `tour_complete=1`.
4. Settings → Replay: `goto('/')` if needed, `start({ force: true })`.

### Steps

| id | Targets (`data-tour`) | Intent |
|----|----------------------|--------|
| `net` | `net` | Dashboard net position |
| `add` | `add` | FAB — add transaction (mention **N**) |
| `transactions` | `transactions` | Nav (sidebar or bottom) |
| `budgets` | `budgets` | Nav (sidebar or bottom) |
| `more` | `accounts` then `settings` | Accounts (desktop) or Settings gear (mobile) |

When multiple elements share a `data-tour` id (sidebar + bottom nav), pick the **visible** one. For `more`, try targets in order until one is visible; if none, show a centered tip.

### Architecture

- `src/lib/tour/steps.ts` — step definitions
- `src/lib/stores/tour.svelte.ts` — runes store
- `src/lib/components/tour/TourOverlay.svelte` — overlay UI
- `meta.isTourComplete` / `setTourComplete` / `ensureTourGrandfathered`
- `data-tour` on dashboard, FAB, Sidebar, BottomNav, TopBar settings link

### UX

- Modal overlay blocks app interaction; Escape = skip.
- Progress “n / 5”; Back disabled on first step.
- Re-measure on resize/scroll; reduced-motion: no animation.
- Do not open the transaction modal during the tour.

## Testing

- Unit: meta helpers, store start/next/back/skip/finish, grandfather, force replay.
- Optional component smoke for TourOverlay.
- Manual: fresh onboarding path + Settings replay + mobile/desktop targets.
