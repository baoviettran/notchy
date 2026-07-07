# UX Friction Reduction — Phase 1 Audit

**Date:** 2026-07-07
**Status:** Design — pending implementation plan
**Scope:** Behavioral UX audit of the current UI, identifying friction points and proposing phased fixes. No new features. Pure UX polish.

---

## Motivation

Notchy's visual design system is strong: the "Adding Machine" aesthetic (warm near-black casing, amber phosphor figures, oxblood debit) is distinctive and consistent. The design tokens, typography (IBM Plex Mono for figures, system sans for body), and component primitives are well-implemented.

But the **behavioral UX** — how the interface responds to human intent — has accumulated friction. This audit identifies the top 5 cognitive-load violations and proposes a phased fix. The goal is not to change the look, but to make the app *feel* like a precision instrument: every interaction should be fast, discoverable, and confidence-inspiring.

---

## Audit: Top 5 Friction Points

### 1. Dashboard Cognitive Overload (Miller's Law)

**Problem:** The dashboard presents 6 distinct information blocks in a single vertical scroll:
- Net position + month flow
- Budget progress (this month)
- Quick entry (inline TransactionForm)
- Frequent transactions (repeatable)
- Recent transactions (last 5)
- Goals (conditional)

**Psychological violation:** Miller's Law (7±2 chunks). The dashboard forces 6+ chunks into working memory simultaneously. Users can't quickly answer "How am I doing this month?" because the answer is scattered across multiple cards with different visual weights.

**Downstream effect:** Decision paralysis. Users scan but don't absorb. The dashboard becomes a wall of information instead of a clear signal.

**Conceptual solution:** Collapse into a **3-tier hierarchy**:
1. **Signature readout** (net position + month flow) — single card, prominent
2. **Budget progress** (this month) — single card, action-oriented
3. **Recent activity** (last 5 transactions) — single card, scrollable

Remove the inline `TransactionForm mode="quick"` from the dashboard. The FAB already opens the modal. Move frequent transactions into the FAB modal as a "Quick repeat" section above the form fields. This keeps the dashboard focused on readouts and moves the capture workflow into the modal where it belongs.

---

### 2. Transaction Form Field Ordering (Fitts's Law)

**Problem:** The transaction form presents: kind toggles → amount → tag/account → payee → date/description. But the most frequent action (entering an amount) requires first selecting a kind, then tabbing to amount. For expense (80%+ of entries), the kind toggle is a wasted interaction.

**Psychological violation:** Fitts's Law (interaction cost proportional to frequency). The kind selector is always visible but rarely changed after the first few uses.

**Downstream effect:** Transaction anxiety. Each entry feels like a multi-step form instead of a quick capture. Users rush and make errors.

**Conceptual solution:** Default to "expense" on open. Move amount to the top as the primary input. Make kind a secondary toggle (or auto-infer from context: if payee matches a previous income, suggest income). The quick-add window already does this right — it's a single input. The modal form should learn from it.

**Implementation:**
- Add `autofocus` prop to `Input.svelte`
- Reorder `TransactionForm.svelte` fields: amount → kind → account/tag → payee → date/description
- Amount input gets `autofocus` on modal open

---

### 3. Navigation — Dead Mobile Menu + Secondary Items Unreachable (Hick's Law + Affordance)

**Problem (two parts):**

**(a) Dead hamburger button.** `TopBar.svelte` renders a hamburger button wired to `onMenuToggle`, but `+layout.svelte` renders `<TopBar />` **without passing that prop** — so the handler is the no-op default. Tapping it does nothing. The Sidebar it was meant to reveal is `hidden md:flex`, so on mobile there is no drawer.

**(b) Secondary nav unreachable on mobile.** `BottomNav.svelte` holds only the 4 primary tabs (dashboard, transactions, budgets, reports). The 4 secondary items — accounts, goals, debts, settings — live only in the Sidebar, which mobile never shows. Combined with the dead hamburger, **goals, debts, and settings have no mobile entry point at all** on mobile. (Accounts is reachable via the dashboard net-position card link; the other three are not.)

**Psychological violation:** Hick's Law (the user searches an unproductive place — the dead hamburger — before concluding there's no way there) and Affordance (a visible control that does nothing erodes trust in every other control).

**Downstream effect:** Users can't reach goals/debts/settings on mobile. Worse, the dead hamburger teaches them that controls may silently fail, lowering confidence in the whole interface.

**Conceptual solution:** Give mobile a working path to all 8 destinations:
- **Fix the BottomNav** to carry all navigation on mobile (primary items as the 4 tabs + a "More" entry that opens a sheet listing the 4 secondary items), OR
- **Wire the hamburger** to a real slide-in Sidebar drawer that mirrors the desktop Sidebar.

Recommended: the BottomNav + "More" sheet. It keeps the thumb-zone canonical and avoids a drawer that competes with the existing BottomNav. The dead hamburger button is removed from TopBar regardless.

On desktop, consolidate the TopBar into a **utility bar** (search + language toggle + settings shortcut) and drop the duplicate logo (already in the Sidebar). You never see three nav surfaces on one device — but today you see two that both show a logo, which reads as noise.

**Implementation:**
- `TopBar.svelte`: remove logo and hamburger entirely; keep search (desktop), language toggle, settings shortcut
- `BottomNav.svelte`: add a 5th slot — "More" — that opens a bottom sheet (reuse `Modal` or a new `Sheet.svelte`) listing accounts, goals, debts, settings
- Remove the now-unused `onMenuToggle` prop from `TopBar.svelte`
- Update any E2E specs that navigate to accounts/goals/debts/settings on mobile to use the "More" sheet

---

### 4. Hover-Reveal Actions (Discoverability)

**Problem:** Action buttons (edit, delete, archive) are hidden until hover (`opacity-0 group-hover:opacity-100`). This works on desktop but fails on touch devices and violates discoverability: users can't see what actions are available until they accidentally hover.

**Psychological violation:** Discoverability (affordances must be visible). Hidden actions = invisible capabilities.

**Downstream effect:** Users don't realize they can edit/delete transactions or accounts. They create duplicates instead of editing.

**Conceptual solution:** Always show a **context menu icon** (⋮) on each row. Click/tap opens a dropdown with actions. On desktop, hover can still reveal inline buttons for speed, but the menu icon is always visible as a fallback.

**Implementation:**
- Add `ContextMenu.svelte` primitive (dropdown menu with backdrop click-to-close)
- Transactions list: desktop shows inline buttons on hover; mobile shows context menu icon always visible
- Accounts list: same pattern

---

### 5. Inconsistent Empty States (The River Principle)

**Problem:** Empty states are inconsistent: some show placeholder text ("No transactions yet"), some show emoji (📋), some show nothing. The dashboard shows "▮▯▯▯" (phosphor glow) for empty recent transactions, but the transactions list shows 📋. This breaks the visual language.

**Psychological violation:** The River Principle (continuous visual flow). Inconsistent empty states feel like different apps.

**Downstream effect:** Users feel uncertain: "Is this a bug? Is data loading? Should I do something?"

**Conceptual solution:** Define a **single empty-state recipe**: phosphor glow glyph + action-oriented text + optional CTA. Drop emoji entirely (📋 breaks the visual language). Use the phosphor glyph consistently (▮▯▯▯ for data, or custom SVGs matching the VFD aesthetic). Example: "No transactions yet. Press N to add one." (with the keyboard shortcut as a hint).

**Implementation:**
- Add `EmptyState.svelte` component (icon, message, optional action snippet)
- Replace all empty states with this component
- Use phosphor glow icons consistently (▮▯▯▯ for data, or custom SVGs)

---

## Phased Implementation

### Phase 1: Critical Fixes (this sprint)

1. **Dashboard hierarchy refactor** — remove inline quick-entry, consolidate cards
2. **Transaction form reorder** — amount first, autofocus
3. **Navigation consolidation** — TopBar becomes utility bar
4. **Discoverable row actions** — context menu for mobile, inline buttons for desktop
5. **Unified empty state component** — replace all empty states

**Estimated effort:** 2-3 days of focused work.

**Success criteria:**
- Dashboard loads in < 500ms, shows 3 clear cards
- Transaction form opens with amount field focused
- TopBar shows only search + utilities (no logo, no nav)
- Row actions are discoverable on mobile (context menu icon always visible)
- Empty states use consistent phosphor glow icon + action text

---

### Phase 2: Polish (next sprint)

1. **Skeleton loading states** — dashboard cards show skeleton while loading
2. **Keyboard shortcut hints** — show "Press N to add" on first visit (dismissible)
3. **Phosphor glow extension** — cards flash phosphor glow on save
4. **Progress bar fill animation** — segments fill with 300ms ease-out

**Estimated effort:** 1-2 days.

**Success criteria:**
- Dashboard cards show skeleton during initial load
- Keyboard shortcut hint appears on first dashboard visit, dismissible
- Saving a transaction triggers a subtle phosphor glow on the dashboard card
- Progress bars animate smoothly when budget updates

---

### Phase 3: Motion Layer (future)

1. **Modal open/close refinement** — 180ms ease-out, translateY(8px)
2. **Button press feedback** — 80ms scale(0.98) on active
3. **Toast notification refinement** — 200ms ease-out in, 150ms ease-in out
4. **Row hover timing refinement** — 150ms ease-out on action buttons

**Estimated effort:** 1 day.

**Success criteria:**
- Modal feels weighty (180ms, not instant)
- Button press feels responsive (80ms feedback)
- Toast slides in smoothly, exits quickly
- Row actions appear smoothly on hover

---

## Out of Scope

- **New features** — this is pure UX polish, no new functionality
- **Visual design changes** — the Adding Machine aesthetic is strong; we're refining behavior, not looks
- **Performance optimization** — out of scope (separate audit)
- **Accessibility audit** — out of scope (separate audit)

---

## Risks & Mitigations

**Risk:** Removing the inline quick-entry from the dashboard might feel like a regression.
**Mitigation:** The FAB already opens the modal. Users who prefer inline entry can use the quick-add window (separate Tauri window). Track usage for 1 week; if users complain, restore as an optional toggle.

**Risk:** Changing the transaction form field order might confuse existing users.
**Mitigation:** The new order (amount first) matches the quick-add window. Users who prefer the old order can provide feedback; we'll track for 1 week.

**Risk:** Consolidating navigation might make secondary items (accounts/goals/debts/settings) harder to find on mobile.
**Mitigation:** The BottomNav already shows the 4 primary items. Secondary items are reachable via dashboard deep-links. If users struggle, add a "More" menu to the BottomNav.

---

## Success Metrics

- **Task completion time** — measure time to add a transaction (before/after)
- **Error rate** — measure form submission errors (before/after)
- **User satisfaction** — qualitative feedback after 1 week of use

---

## References

- Miller's Law: 7±2 chunks in working memory
- Fitts's Law: interaction cost proportional to frequency
- Hick's Law: decision time increases with number of choices
- The River Principle: continuous visual flow, no jarring transitions
- Discoverability: affordances must be visible
