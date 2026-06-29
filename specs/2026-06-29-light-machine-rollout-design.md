# Light Machine — Design System Rollout (Light-first, Dual-mode)

**Date:** 2026-06-29
**Status:** Approved (design)
**Supersedes the visual layer of:** commit `d317035` (Machine design system — dark only)

## Goal

Finish the Adding Machine design system across the whole app and make it consistent in both light and dark modes. Light is the primary surface (the user prefers light over dark); dark is its mirrored variant. The existing `auto / light / dark` toggle stays functional and meaningful.

## Background & current state

The Adding Machine system (`d317035`) ships only a **dark** skin. It covers the shell, dashboard, and onboarding. Seven route pages still use the old default palette (`zinc-900 dark:zinc-50`, `emerald` accents), so the app reads as two different products.

`src/app.css` hardcodes `color-scheme: dark` and `html { background: #14110c }`. The glow / plate classes assume phosphor-on-ink. **There is no light variant** — the code comment calls light "the paper fallback," but it was never built. The theme toggle (`src/lib/stores/settings.svelte.ts`) flips a `.light` / `.dark` class on `<html>`; `auto` follows `prefers-color-scheme`. In practice, selecting `light` today produces an unstyled page.

Route pages NOT yet using Machine tokens:

- `src/routes/accounts/+page.svelte`
- `src/routes/budgets/+page.svelte`
- `src/routes/debts/+page.svelte`
- `src/routes/goals/+page.svelte`
- `src/routes/reports/+page.svelte` (+ `reports/trend`, `reports/compare`)
- `src/routes/settings/+page.svelte` (+ `settings/categories`, `settings/backup`)
- `src/routes/transactions/+page.svelte`

Already on Machine tokens: shell (`TopBar`, `Sidebar`, `BottomNav`, `FAB`), primitives (`Button`, `Input`, `Modal`, `Progress`), `TransactionForm`, `FrequentTransactions`, `+layout.svelte`, `+page.svelte` (dashboard), `onboarding/+page.svelte`.

## Approach

**A — Light is the hero, dark mirrors it.** Tokens flip with mode via CSS variables on `:root` (dark) and `.light`. Tailwind token names reference the variables, so a single class set (`bg-casing text-ledger`) works in both modes. This is the only path to a consistent app without removing the theme toggle.

## Token system (dual-mode)

Machine DNA is unchanged: mono VFD numerals (`.figures`), engraved faceplate micro-labels (`.plate`), ledger tape, segmented magnitude ladder. Only the palette is reworked for light and made dual-mode.

| Token | Dark | Light | Role |
|---|---|---|---|
| `casing` | `#14110C` | `#F4EFE2` (paper-bone) | page background |
| `surface` | `#1C1812` (tape) | `#FBF8F1` (lifted card) | cards, tape, inputs |
| `ledger` | `#D6CFC0` | `#1F1B14` (warm ink) | primary text, figures |
| `dim` | `#8A8170` | `#6B6353` | secondary text |
| `line` | `#2A2419` | `#E2DAC8` | hairline rules |
| `phosphor` | `#FFB454` | `#B8721A` (ochre) | figures, accents, focus |
| `phosphor-bright` | `#FFD79A` (glow) | n/a | VFD glow, dark only |
| `debit` | `#E5484D` | `#C23B3F` | negatives |

**Accent:** ochre `#B8721A` for light — same amber family as dark phosphor, deepened for contrast on cream. The visual risk is spent in the typography (mono throughout), not the palette.

### Glow handling

`.figures-glow` (the text-shadow phosphor bloom) renders **dark only**. On paper, figures use solid ochre ink with no text-shadow — a glow on a bright ground reads muddy and loses legibility.

### CSS variable structure

```css
:root {
  color-scheme: dark;
  --casing: #14110C;
  --surface: #1C1812;
  --ledger: #D6CFC0;
  --dim: #8A8170;
  --line: #2A2419;
  --phosphor: #FFB454;
  --phosphor-bright: #FFD79A;
  --debit: #E5484D;
}
html.light {
  color-scheme: light;
  --casing: #F4EFE2;
  --surface: #FBF8F1;
  --ledger: #1F1B14;
  --dim: #6B6353;
  --line: #E2DAC8;
  --phosphor: #B8721A;
  /* phosphor-bright unused in light */
  --debit: #C23B3F;
}
```

Tailwind tokens reference the variables, e.g. `casing: 'var(--casing)'`, so `bg-casing`, `text-ledger`, `border-line`, `text-phosphor` resolve per mode. `.light` also drops the glow shadow.

### app.css changes

- Move hardcoded dark hexes behind the variables above.
- `html.light { color-scheme: light }` so native controls match.
- `.figures-glow` scoped to `:root:not(.light)` (no glow on paper).
- `.plate`, `:focus-visible`, `::selection` reference `var(--phosphor)` so they flip.
- `html` background uses `var(--casing)`.
- `setTheme` (`settings.svelte.ts`) already adds `.light` / `.dark` on `<html>`; first-run default changes to favor light (see Theme defaults below).

### Theme defaults

The user prefers light. The **first-run default** is `light` (not `auto`), so a fresh install opens on the hero surface. `auto` continues to follow `prefers-color-scheme` if the user later selects it.

## Component migration — 7 route pages (+ sub-routes)

Each page converts from `zinc/emerald` defaults to Machine tokens. Mechanical mapping:

| Old | New |
|---|---|
| `bg-white dark:bg-zinc-800/900` | `bg-surface` |
| `text-zinc-900 dark:text-zinc-50` | `text-ledger` |
| `text-zinc-500 dark:text-zinc-400` | `text-dim` |
| `border-zinc-200 dark:border-zinc-700` | `border-line` |
| `divide-zinc-100 dark:divide-zinc-700` | `divide-line` |
| `emerald-500/600/700` (accent) | `phosphor` |
| page `h1` | `.figures` ledger heading |
| section labels | `.plate` micro-label |

Pages: `accounts`, `transactions`, `budgets`, `goals`, `debts`, `reports` (+ `trend`, `compare`), `settings` (+ `categories`, `backup`).

### Settings theme control

The `auto/light/dark` selector in `settings/+page.svelte` swaps its `emerald` active state to `phosphor` tokens so it matches the system.

## Scope (in / out)

**In:**
- Dual-mode token system (CSS vars + Tailwind tokens).
- `app.css` light variant + glow scoping.
- First-run default → light.
- Migration of all 7 route pages (+ 5 sub-routes) to Machine tokens.
- Verifying primitives and already-migrated shell still render correctly in light.

**Out:**
- New features or layout restructures.
- Changes to data, stores, repos, DB.
- Removing the dark mode toggle.

## Testing

Per project TDD discipline (CLAUDE.md), color is visual, not unit-testable — but token *application* is. Approach:

- **Component tests:** existing tests pin old classes (`bg-phosphor`, `bg-debit`, Modal `aria-label`). Update assertions for any class-name changes from the token refactor; assert token classes still apply. No new behavioral tests unless a component's API changes.
- **Visual verification:** `pnpm tauri dev` (or `pnpm dev`) — screenshot each route in light and dark, confirm consistency. The `run` skill drives this.
- **`pnpm check`** must pass (TS).
- **`pnpm test`** must pass (no regressions).

## Migration / rollout order

1. Tokens: CSS variables in `app.css` + Tailwind config wiring.
2. `app.css` glow/plate/focus/selection → variables; light variant.
3. First-run default → light.
4. Migrate route pages one at a time (accounts → transactions → budgets → goals → debts → reports → settings + sub-routes).
5. Visual sweep both modes; fix primitives if light breaks them.
6. `pnpm check` + `pnpm test`.

## Risks

- **Selector specificity:** `app.css` type/element rules vs component class rules can cancel (padding/margin between sections). Scope carefully.
- **Already-migrated components** (shell, primitives) may have dark-only assumptions baked into class usage (e.g. literal `bg-ink` instead of token). Audit during step 2; replace literals with tokens.
- **`phosphor-bright` glow** appearing in light — must scope to `:not(.light)`.
- **Glow-on-paper legibility** — deliberately removed; confirm figures remain crisp in light.

## Open questions

None. Accent = ochre `#B8721A` (approved). Shape = A (approved).
