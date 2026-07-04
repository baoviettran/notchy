# Notchy — Smoke Test Coverage Map

**Companion to:** `specs/2026-07-02-smoke-test-checklist.md`
**Purpose:** Tells you, for every one of the 136 checklist items, whether a computer already proves it, whether I can automate it, or whether only your eyes can judge it — and gives step-by-step instructions for the eyes-only ones.

## Legend

| Tag | Meaning | Who does it |
|---|---|---|
| ✅ **DONE** | Already covered by existing E2E/unit tests (verified green this session). Tick the box. | Nobody — just tick it. |
| 🤖 **AUTO** | Not yet automated, but I can write an E2E test for it. Say the word. | I write a test; computer runs it forever. |
| 👀 **EYES** | Only a human can judge it (visual contrast, diacritics, OS desktop features, release binary). | **You**, following the steps in this doc. |

**Rough split:** ~24 DONE · ~61 AUTO (I can convert) · ~51 EYES (you, but I've collapsed them into ~8 short passes).

---

## The 51 EYES-only items, collapsed into 8 passes

The full checklist scatters "dark mode / light mode / Vietnamese / empty / error" across every section. Testing them one-at-a-time as you read down is exhausting and slow. Instead do **8 passes**. Each pass is one setting + one walk through the app. This covers ~40 of the 51 eyes-only items in under an hour.

> **Prerequisite for every pass:** `pnpm tauri dev` running, app open. You need a DB with some data in it (if you just ran onboarding in §1, you have an account; add a couple transactions, a budget, a goal, a debt first so the screens aren't empty — or run the "seed" suggestion below).

### Pass A — Fresh start / Onboarding (covers §1)
**Setup:** wipe app data so the app has no accounts.
- Linux: `rm -rf ~/.local/share/com.notchy.app/notchy.db` (or wherever `appDataDir` resolves — check the path in the toast if unsure), then relaunch `pnpm tauri dev`.

1. App opens on onboarding → first screen offers **English / Tiếng Việt**. ✅ §1 item 1
2. Click **English → pick a currency → create a checking account** → lands on dashboard with the account visible. ✅ §1 item 2
3. **Error check:** on the account step, leave the name empty → **Finish/Continue is disabled**. Type only spaces → still disabled / rejected. Type a valid name, put letters in the opening balance → rejected with a clear error. ✅ §1 items 8–9
4. **Empty-state check:** before creating the first account, you cannot reach the dashboard/nav. ✅ §1 item 7

### Pass B — Vietnamese sweep (covers the "🇻🇳 VI" item in §1, §2, §3, §4, §5, §6, §7, §8, §9)
**Setup:** app running with data. Settings → click **Tiếng Việt**.

1. Click through **every** nav item: Dashboard, Transactions, Accounts (open one detail), Budgets, Goals, Debts, Reports (overview + trend + compare), Settings (+ categories + backup).
2. **What to look for on each screen:** every label, button, heading is in Vietnamese. Flag any English fallback string, any `undefined`/`{key}`-looking text, any missing or wrong diacritic.
3. **Transactions specifically:** add `1.5tr lương` (expense) and `+50k lương` (income). Confirm: amount parses to 1,500,000 and 50,000; the payee **lương** is saved with diacritics intact (not `luong` or `lu?ng`). ✅ §3 VI items
4. That single walk ticks the VI box for sections 1–9.

### Pass C — Light-mode sweep (covers the "☀️ Light" item in §1–§9)
**Setup:** Settings → click **Light**.

1. Click through every nav item (same list as Pass B).
2. **What to look for:** washed-out/grey-on-white text, low-contrast buttons, chart series you can't tell apart, dark-on-dark. The app is dark by default, so light mode is where contrast bugs hide.
3. Ticks the Light box for sections 1–9.

### Pass D — Dark-mode sweep (covers the "🌙 Dark" item in §1–§9)
**Setup:** Settings → click **Dark** (the default).

1. Same walk. This should look normal — you're catching regressions where something was hardcoded for light mode.
2. Ticks the Dark box for sections 1–9.

> After B/C/D: switch locale back to English and theme to Dark to restore defaults.

### Pass E — Tauri desktop features (covers all of §10, 12 items)
**This is the biggest manual section — OS-level features Playwright cannot touch.** `pnpm tauri dev` running.

1. **Tray icon** exists in your system tray area. ✅ §10.1
2. **Left-click** the tray icon → quick-add window appears (small, ~360×200, no title bar decoration, "tape" style). ✅ §10.2
3. **Right-click** the tray icon → menu shows **Quick Add / Show Notchy / Quit**. ✅ §10.3–5 partially
   - Click **Quick Add** → quick-add window opens. ✅ §10.3
   - Click **Show Notchy** → main window focuses/shows. ✅ §10.4
   - Click **Quit** → app exits cleanly (no leftover process). ✅ §10.5
4. **Global shortcut `Ctrl+Shift+N`** → quick-add window opens.
   - If it does nothing: another app may own the combo. Check the dev console — the app should log the failure and **not crash**. ✅ §10.6
5. In the quick-add window, type **`50k coffee`**, press **Enter**:
   - Window hides. ✅
   - Focus the main window → the expense row appears in `/transactions`, balance reduced. ✅ §10.7
6. Type **`1.5tr lương`**, Enter → saves 1,500,000, payee **lương** with diacritics intact, row appears. ✅ §10.8
7. Type **`+50k salary`**, Enter → saves as **income** (not expense), balance increases. ✅ §10.9
8. Open quick-add, **press Escape** → window hides without saving anything. ✅ §10.11
9. In quick-add, try a transfer/refund shorthand (e.g. `>account 50k` or whatever the transfer syntax is) → it must **not** create a transfer/refund (quick-add is expense+income only) and must **not crash**. ✅ §10.12
10. **Cross-window refresh:** with main window visible, do a quick-add save → main transaction list updates **without a manual reload** (this is the `transaction:saved` event). ✅ §10.10

### Pass F — Release build (covers all of §11, 5 items)
**Setup:** `pnpm tauri build` (I can run this for you — it takes a few minutes). Then launch the produced binary from the Tauri output dir.

1. Build completes, no errors, binary produced. ✅ §11.1 (I can verify this part)
2. **Launch the binary** → opens to dashboard/onboarding, no crash. ✅ §11.2
3. Settings/About → version string shows **v0.1.2** (no leftover `v0.1.0`). ✅ §11.3
4. **No dev artifacts:** no devtools auto-opens, no source maps visible in the UI, no "development build" banner, no console errors shown to the user. ✅ §11.4
5. **Core round-trip in the binary:** add an account → add a transaction → see it on dashboard → export a backup. All works, no errors. ✅ §11.5

### Pass G — File-dialog cancels & CSV eyeball (covers §9 leftovers)
1. Settings → Backup → click **CSV export** → **cancel** the OS file dialog → app returns to backup page, no error, no partial file. ✅ §9 cancel item
2. Same for **SQLite export** cancel, and **SQLite import** cancel. ✅
3. Actually **export CSV** → open the `.csv` in a spreadsheet/text editor → confirm rows look right and amounts are formatted for your locale (e.g. `1.500.000` not `1500000`). ✅ §9 CSV export item (the locale formatting is the eyes part)

### Pass H — Dashboard DB-gone error state (§2 item 7)
The one fiddly manual error check:
1. App running, dashboard visible.
2. Delete/move the `notchy.db` file out from under the running app.
3. Trigger a refetch (focus/unfocus the window, or add a transaction).
4. **Expect:** app handles it gracefully — re-onboards or shows an error — and does **not** white-screen/crash.
5. Restore the DB file (or accept re-onboarding) before continuing.

---

## Full item-by-item map

### §0 Pre-flight (5)
| # | Item | Status | Note |
|---|---|---|---|
| 1 | `pnpm install` clean | ✅ DONE | Deps installed (tests ran). |
| 2 | `pnpm test` all pass | ✅ DONE | **297/297** this session. |
| 3 | `pnpm check` clean | ✅ DONE | **0 errors, 0 warnings**. |
| 4 | `pnpm test:e2e` all pass | ✅ DONE | **22/22** this session. |
| 5 | `pnpm tauri dev` launches | 👀 EYES | Launch it; open devtools; confirm no errors; lands on dashboard or onboarding. (Needed for every pass below anyway.) |

### §1 Onboarding (9)
| # | Item | Status | Note |
|---|---|---|---|
| 1 | Fresh data → onboarding + lang choice | ✅ DONE | `onboarding.spec.ts` covers flow. |
| 2 | EN → currency → account → dashboard | ✅ DONE | `onboarding → dashboard → add transaction` E2E. |
| 3 | VI path, all labels Vietnamese | 👀 EYES | Pass B. |
| 4 | VI path completes → dashboard VI | 👀 EYES | Pass B. |
| 5 | Light mode onboarding readable | 👀 EYES | Pass C (re-run onboarding in light). |
| 6 | Dark mode onboarding readable | 👀 EYES | Pass D. |
| 7 | Empty state: only onboarding reachable | 👀 EYES | Pass A step 4. (Could be 🤖 — route-guard assertion.) |
| 8 | Error: advance without selection | ✅/🤖 | "Finish disabled until account name" E2E covers account step; currency-step guard 🤖-able. |
| 9 | Error: invalid name / opening balance | 🤖 AUTO | parseAmount rejection — easily asserted. |

### §2 Dashboard (7)
| # | Item | Status | Note |
|---|---|---|---|
| 1 | Widgets load with real values | ✅ DONE | E2E lands on dashboard post-onboarding. |
| 2 | Dark mode | 👀 EYES | Pass D. |
| 3 | VI labels | 👀 EYES | Pass B. |
| 4 | Light mode | 👀 EYES | Pass C. |
| 5 | Nav: each item loads | 🤖 AUTO | Assert each route mounts without console error (reports sub-pages already E2E). |
| 6 | Empty state (only onboarding account) | 🤖 AUTO | Render with no transactions/budgets/goals/debts, assert no `undefined`. |
| 7 | Error: DB deleted mid-run | 👀 EYES | Pass H. |

### §3 Transactions (20)
| # | Item | Status | Note |
|---|---|---|---|
| 1 | Add expense | ✅ DONE | `transactions.spec.ts`. |
| 2 | Add income | ✅ DONE | Same. |
| 3 | Add transfer (single row, both balances) | ✅ DONE | Same. |
| 4 | Add refund | 🤖 AUTO | No E2E for refund kind. |
| 5 | Add adjustment | 🤖 AUTO | No E2E for adjustment kind. |
| 6 | Edit transaction | ✅ DONE | `edit a transaction changes the amount`. |
| 7 | Delete transaction | ✅ DONE | `delete a transaction removes it`. |
| 8 | Tag a transaction + filter by tag | 🤖 AUTO | Tag UI exists; no E2E asserting filter. |
| 9 | Search box | 🤖 AUTO | Search input wired; no E2E. |
| 10 | Filter by kind | 🤖 AUTO | No E2E. |
| 11 | Payee autocomplete | 🤖 AUTO | Autocomplete component; no E2E. |
| 12 | Dark mode | 👀 EYES | Pass D. |
| 13 | VI `1.5tr lương` (diacritics) | 👀 EYES | Pass B step 3 — diacritics are the eyes part; parsing is unit-tested. |
| 14 | VI `50k` / `+50k` | 🤖 AUTO | Parsing unit-tested in `quick_parse`; E2E can assert amounts. |
| 15 | Light mode | 👀 EYES | Pass C. |
| 16 | Empty state | 🤖 AUTO | No-tx message. |
| 17 | Error: missing required field | 🤖 AUTO | Form validation. |
| 18 | Error: negative amount | 🤖 AUTO | parseAmount heavily unit-tested; add E2E. |
| 19 | Edge: `2tr` large amount | 🤖 AUTO | |
| 20 | Edge: self-transfer rejected | 🤖 AUTO | |

### §4 Accounts & Reconciliation (15)
| # | Item | Status | Note |
|---|---|---|---|
| 1 | Accounts list loads, balances match | ✅ DONE | `accounts.spec.ts`. |
| 2 | Create all 6 types | 🤖 AUTO | Onboarding only exposes 4; the full AccountForm has 6 (incl. `loan_to_person`/`loan_from_person`). |
| 3 | Edit account | 🤖 AUTO | |
| 4 | Delete account (no transactions) | 🤖 AUTO | |
| 5 | Delete account (with transactions) | 🤖 AUTO | Block-or-confirm behaviour. |
| 6 | Open account detail | ✅ DONE | `create an account and open its detail`. |
| 7 | Reconcile + out-of-balance adjustment | ✅/🤖 | Happy path + large-discrepancy warn are E2E; the **adjustment-creation** close-out 🤖-able. |
| 8 | Reconcile cancel/restart | 🤖 AUTO | No leftover state. |
| 9 | Liability balance sign (negative) | 🤖 AUTO | Assert credit-card/loan-from-person render negative. |
| 10 | Loan-type validation (counterparty, no type flip) | 🤖 AUTO | Assert `account_type_loan` rejection. |
| 11 | Dark mode | 👀 EYES | Pass D. |
| 12 | VI | 👀 EYES | Pass B. |
| 13 | Light mode | 👀 EYES | Pass C. |
| 14 | Empty state (single account) | 🤖 AUTO | |
| 15 | Error: invalid opening balance / empty name | 🤖 AUTO | |

### §5 Budgets (10)
| # | Item | Status | Note |
|---|---|---|---|
| 1 | Create envelope + allocate | ✅ DONE | `budgets.spec.ts`. |
| 2 | Spend against budget updates live | 🤖 AUTO | |
| 3 | Prev/next month nav | ✅ DONE | `prev/next month navigation`. |
| 4 | Roll-over into N+1 | 🤖 AUTO | v0.1.1 rules; no E2E. |
| 5 | Dark mode | 👀 EYES | Pass D. |
| 6 | VI | 👀 EYES | Pass B. |
| 7 | Light mode | 👀 EYES | Pass C. |
| 8 | Empty state | 🤖 AUTO | |
| 9 | Error: negative allocation | 🤖 AUTO | |
| 10 | Edge: over-allocate | 🤖 AUTO | |

### §6 Goals (11)
| # | Item | Status | Note |
|---|---|---|---|
| 1 | Create goal | ✅ DONE | `goals.spec.ts`. |
| 2 | Contribute | 🤖 AUTO | |
| 3 | Velocity tracking | 🤖 AUTO | |
| 4 | Complete lifecycle | 🤖 AUTO | |
| 5 | Edit goal | 🤖 AUTO | |
| 6 | Delete goal | 🤖 AUTO | |
| 7 | Dark mode | 👀 EYES | Pass D. |
| 8 | VI | 👀 EYES | Pass B. |
| 9 | Light mode | 👀 EYES | Pass C. |
| 10 | Empty state | 🤖 AUTO | |
| 11 | Error: invalid target / past date | 🤖 AUTO | |

### §7 Debts (11)
| # | Item | Status | Note |
|---|---|---|---|
| 1 | Create "I owe" | ✅ DONE | `debts.spec.ts` (loan surfaces under "I Owe"). |
| 2 | Create "Owed to me" | 🤖 AUTO | |
| 3 | Record payment | 🤖 AUTO | |
| 4 | Mark settled | 🤖 AUTO | |
| 5 | Edit debt | 🤖 AUTO | |
| 6 | Delete debt | 🤖 AUTO | |
| 7 | Dark mode | 👀 EYES | Pass D. |
| 8 | VI | 👀 EYES | Pass B. |
| 9 | Light mode | 👀 EYES | Pass C. |
| 10 | Empty state | 🤖 AUTO | |
| 11 | Error: invalid amount / empty counterparty | 🤖 AUTO | |

### §8 Reports (10)
| # | Item | Status | Note |
|---|---|---|---|
| 1 | Overview loads | ✅ DONE | `reports.spec.ts` (sub-pages load, no console errors). |
| 2 | Trend loads | ✅ DONE | Same. |
| 3 | Compare loads | ✅ DONE | Same. |
| 4 | Change range updates charts | 🤖 AUTO | |
| 5 | Dark mode | 👀 EYES | Pass D. |
| 6 | VI | 👀 EYES | Pass B. |
| 7 | Light mode | 👀 EYES | Pass C. |
| 8 | Empty state (no tx in range) | 🤖 AUTO | |
| 9 | Error: invalid range | 🤖 AUTO | |
| 10 | Edge: single transaction in range | 🤖 AUTO | |

### §9 Settings (21)
| # | Item | Status | Note |
|---|---|---|---|
| 1 | Page loads, version `v0.1.2` | 🤖 AUTO | Assert version string. |
| 2 | Theme Auto follows OS | 🤖/👀 | Logic unit-tested (`settings.theme`); OS-match is 👀. |
| 3 | Theme Light/Dark persists across reload | 🤖 AUTO | |
| 4 | Language EN/VI persists across reload | 🤖 AUTO | |
| 5 | Categories: create/rename/move tag | ✅/🤖 | Tag create E2E-covered; rename + move-bucket 🤖-able. |
| 6 | Delete tag → Uncategorise | 🤖 AUTO | |
| 7 | Delete tag → Merge into | ✅ DONE | `categories.spec.ts` (merge into another). |
| 8 | CSV export (locale-formatted) | 👀 EYES | Pass G — eyeball the rows. |
| 9 | SQLite export | 🤖 AUTO | |
| 10 | SQLite import round-trip | ✅ DONE | `backup -> diverge -> restore`. |
| 11 | SQLite import schema-version mismatch | ✅ DONE | `schema-version mismatch is rejected`. |
| 12 | Auto-backup on launch | ✅ DONE | `writes a backup file to the virtual FS`. |
| 13 | Quick-add account picker + reload | 🤖 AUTO | |
| 14 | Quick-add picker "None" | 🤖 AUTO | |
| 15 | Keyboard shortcuts | 👀 EYES | Desktop — manual. |
| 16 | Dark mode | 👀 EYES | Pass D. |
| 17 | VI | 👀 EYES | Pass B. |
| 18 | Light mode | 👀 EYES | Pass C. |
| 19 | Empty state (no categories) | 🤖 AUTO | |
| 20 | Error: corrupt SQLite import | ✅ DONE | `corrupt import is rejected`. |
| 21 | Error: cancel file dialog | 👀 EYES | Pass G. |

### §10 Tauri Desktop (12) — 👀 ALL EYES
See **Pass E** for full step-by-step. The *logic* of quick-add expense/income saving is E2E-covered (`tray-quick-capture.spec.ts`), but the OS-level surface (tray icon, global shortcut, window show/hide, cross-window event) is not exercisable by Playwright.

### §11 Release Build (5) — 👀 ALL EYES
See **Pass F**. (`pnpm tauri build` itself I can run for you.)

---

## Recommended order

1. **Now:** I write E2E tests for the ~61 🤖 AUTO items → run them → they become ✅ DONE. (Biggest win, permanent.)
2. **Then you** do Passes A → H in order. Each is self-contained; stop/resume anytime.
3. **Report bugs** as you find them: paste the Quick Bug Report template from the checklist, or just tell me "Pass B, budgets screen, header is in English" and I'll fix it.

## Seed-data suggestion (so the screens aren't empty during passes B–H)
Before Pass B, spend 5 minutes creating: 2 accounts (one checking, one credit card), 4–5 transactions across categories, 1 budget with allocations, 1 goal, 1 debt. This makes empty-state bugs visible-vs-invisible and lets the theme/locale sweeps actually show data. (Or: I can write a tiny seed script that populates the test DB — ask.)
