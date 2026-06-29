# Light Machine Rollout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the Adding Machine design system across the whole app and make it consistent in both light and dark modes, with light as the primary surface.

**Architecture:** Move the existing Tailwind color tokens (`ink`, `tape`, `ledger`, `dim`, `line`, `phosphor`, `phosphor-bright`, `debit`) from hardcoded dark hexes to CSS variables defined on `:root` (dark) and overridden under `html.light`. The Tailwind token *names* stay identical, so the already-migrated shell/dashboard/forms/components keep working unchanged — only the variable values flip per mode. The 7 still-unmigrated primitives and 11 route pages then convert from `zinc`/`emerald`/`red` Tailwind defaults to those same token classes, one mechanical mapping per element.

**Tech Stack:** SvelteKit 5, Svelte 5 runes, Tailwind CSS 3 (`darkMode: 'class'`), CSS custom properties, Vitest + @testing-library/svelte.

**Spec:** `specs/2026-06-29-light-machine-rollout-design.md`

## Global Constraints

- **Token names are immutable.** Use exactly these Tailwind classes (already defined in `tailwind.config.ts`): `bg-ink`, `bg-tape`, `bg-ledger`, `bg-dim`, `bg-line`, `bg-phosphor`, `bg-phosphor-bright`, `bg-debit`, and the `text-*` / `border-*` / `divide-*` equivalents. Do NOT rename `ink`→`casing` or `tape`→`surface` as the spec's table suggests — the names stay; only their hex values move behind variables.
- **Color semantics:** positive/income = `phosphor`; negative/expense = `debit`; neutral/secondary = `dim`. This matches the dashboard (`src/routes/+page.svelte:152`). Apply everywhere.
- **No new dependencies.** Pure CSS-variables + Tailwind config edit.
- **No DB/store-repo changes.** Theme persistence to the DB is explicitly OUT of scope (spec). Only the in-memory `settings.theme` default and class application on load change.
- **TDD:** every testable unit gets a failing test first. Pure-CSS/visual changes (route markup, app.css, tailwind config) are the "configuration files" exception in CLAUDE.md — they are verified by `pnpm check` + visual sweep, not unit tests. Component behavioral changes DO get tests.
- **Commit prefix:** `refactor:` for migrations, `feat:` for the token system + light mode, `fix:` if a test regresses.
- **Glow is dark-only.** `.figures-glow` must apply its text-shadow only when `html` lacks `.light`.

## File Structure

**Modify (token system — Task 1):**
- `tailwind.config.ts` — re-point the 8 color tokens to `var(--*)` CSS variables; add `surface` variable reference.
- `src/app.css` — define `:root` (dark) and `html.light` variable blocks; rewrite `.figures`, `.figures-glow`, `.plate`, `.surface`, `.hairline`, `::selection`, `:focus-visible`, `html` background to use variables; scope glow to dark.

**Modify (theme apply on load — Task 2):**
- `src/lib/stores/settings.svelte.ts` — default `theme` to `'light'`; apply the class in `load()` so a cold boot renders the chosen theme.

**Modify (primitives — Task 3):**
- `src/lib/components/primitives/Select.svelte` — `zinc`/`emerald` → tokens.
- `src/lib/components/primitives/Autocomplete.svelte` — `zinc`/`emerald` → tokens.
- `src/lib/components/primitives/ConfirmDialog.svelte` — `bg-white dark:bg-zinc-800` etc → tokens.
- `src/lib/components/primitives/Skeleton.svelte` — `bg-zinc-200 dark:bg-zinc-700` → `bg-line`.
- `src/lib/components/primitives/Toast.svelte` — `bg-zinc-800` → `bg-tape`.
- `src/lib/components/primitives/GlobalToast.svelte` — `bg-zinc-800` → `bg-tape`; `emerald` action → `phosphor`.
- `src/lib/components/charts/DonutChart.svelte` — legend text + inner-circle fill → tokens.

**Modify (route pages — Tasks 4–8):**
- `src/routes/accounts/+page.svelte`
- `src/routes/transactions/+page.svelte`
- `src/routes/budgets/+page.svelte`
- `src/routes/goals/+page.svelte`
- `src/routes/debts/+page.svelte`
- `src/routes/reports/+page.svelte`, `src/routes/reports/trend/+page.svelte`, `src/routes/reports/compare/+page.svelte`
- `src/routes/settings/+page.svelte`, `src/routes/settings/categories/+page.svelte`, `src/routes/settings/backup/+page.svelte`

**New test (Task 2):**
- `src/tests/unit/stores/settings.theme.test.ts` — pins default-theme and class-application behavior.

---

## Task 1: Dual-mode token system (CSS variables + Tailwind wiring)

This is the foundation. Everything else depends on it. The Tailwind token *names* do not change — only their values move behind CSS variables that flip with the `html.light` class. After this task, `bg-ink` renders dark on `:root` and paper-bone under `html.light`.

**Files:**
- Modify: `tailwind.config.ts` (full rewrite of the `colors` block)
- Modify: `src/app.css` (base layer rewrite)

**Interfaces:**
- Consumes: the existing `html.light` / `html.dark` class toggle from `settings.setTheme`.
- Produces: all 8 color tokens now resolve per-mode; `.figures`, `.plate`, `.surface`, `.hairline`, `::selection`, `:focus-visible` flip with mode; `.figures-glow` glows in dark only.

This is a configuration/CSS change (CLAUDE.md "configuration files" exception — verified by `pnpm check` + visual sweep, not unit tests).

- [ ] **Step 1: Rewrite the color tokens in `tailwind.config.ts`**

Replace the entire `colors` object inside `theme.extend` with variable-backed tokens. The `fontFamily` block stays untouched.

```ts
import type { Config } from 'tailwindcss';

export default {
	content: ['./src/**/*.{html,js,svelte,ts}'],
	darkMode: 'class',
	theme: {
		extend: {
			colors: {
				// Adding Machine palette — values are CSS variables defined in app.css,
				// so each token flips with the html.light / html.dark class.
				ink: 'var(--ink)',
				tape: 'var(--tape)',
				ledger: 'var(--ledger)',
				dim: 'var(--dim)',
				line: 'var(--line)',
				phosphor: 'var(--phosphor)',
				'phosphor-bright': 'var(--phosphor-bright)',
				debit: 'var(--debit)'
			},
			fontFamily: {
				mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
				sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif']
			}
		}
	},
	plugins: []
} satisfies Config;
```

- [ ] **Step 2: Rewrite the base + components layer of `src/app.css`**

Replace everything from `/* ===...` down through the end of `@layer components { ... }` (the `@layer utilities` block and the `@keyframes` + `@media (prefers-reduced-motion)` blocks at the bottom stay untouched). The new version defines the variable blocks and re-points every hardcoded hex at a variable.

```css
/* ===========================================================
   Notchy — Adding Machine design system
   Warm near-black casing, amber-phosphor figures, oxblood debit.
   Dark is the native surface; light is the paper variant.
   Token hexes live in CSS variables so each flips with the
   html.light / html.dark class on <html>.
   =========================================================== */

@layer base {
	:root {
		/* Dark (default): warm near-black casing + amber phosphor. */
		color-scheme: dark;
		--ink: #14110C;
		--tape: #1C1812;
		--ledger: #D6CFC0;
		--dim: #8A8170;
		--line: #2A2419;
		--phosphor: #FFB454;
		--phosphor-bright: #FFD79A;
		--debit: #E5484D;
	}

	html.light {
		/* Light: warm paper-bone + ochre phosphor (deepened for contrast). */
		color-scheme: light;
		--ink: #F4EFE2;
		--tape: #FBF8F1;
		--ledger: #1F1B14;
		--dim: #6B6353;
		--line: #E2DAC8;
		--phosphor: #B8721A;
		--phosphor-bright: #D99935;
		--debit: #C23B3F;
	}

	html {
		background-color: var(--ink);
	}

	body {
		font-family: theme('fontFamily.sans');
		font-variant-numeric: tabular-nums lining-nums;
		-webkit-font-smoothing: antialiased;
		text-rendering: optimizeLegibility;
	}

	/* Phosphor VFD numerals: the adding-machine display. */
	.figures {
		font-family: theme('fontFamily.mono');
		font-variant-numeric: tabular-nums lining-nums;
		letter-spacing: -0.01em;
	}

	/* Glow renders dark-only: a bloom on paper reads muddy and loses legibility. */
	:root:not(.light) .figures-glow {
		font-family: theme('fontFamily.mono');
		font-variant-numeric: tabular-nums lining-nums;
		color: var(--phosphor-bright);
		text-shadow: 0 0 8px rgba(255, 180, 84, 0.45), 0 0 22px rgba(255, 180, 84, 0.18);
	}
	html.light .figures-glow {
		font-family: theme('fontFamily.mono');
		font-variant-numeric: tabular-nums lining-nums;
		color: var(--phosphor);
		text-shadow: none;
	}

	/* Engraved faceplate micro-label. */
	.plate {
		font-family: theme('fontFamily.mono');
		text-transform: uppercase;
		letter-spacing: 0.18em;
		font-size: 0.6875rem; /* 11px */
		color: var(--dim);
	}

	::selection {
		background: rgba(255, 180, 84, 0.28);
		color: var(--phosphor-bright);
	}

	/* Quiet phosphor focus ring — visible against either casing. */
	:focus-visible {
		outline: none;
		box-shadow: 0 0 0 2px var(--ink), 0 0 0 3px var(--phosphor);
	}
}

@layer components {
	/* Single card recipe so hierarchy is consistent across screens. */
	.surface {
		background-color: var(--tape);
		border: 1px solid var(--line);
	}
	.hairline {
		border-color: var(--line);
	}
}
```

Note: the existing `@keyframes flash` keyframes hardcode amber RGBA — leave them (dark-only animation; acceptable since `.animate-flash` is only used on the loading splash in dark-first contexts). Do not touch the `@layer utilities` or reduced-motion blocks.

- [ ] **Step 3: Verify TypeScript + build still pass**

Run: `pnpm check`
Expected: no errors (config + CSS are not type-checked, but this confirms nothing else broke).

- [ ] **Step 4: Run the existing component tests to confirm no regressions**

Run: `pnpm test`
Expected: all pass. The tests assert class *names* (`bg-phosphor`, `bg-debit`, Modal `aria-label="Close"`), which are unchanged.

- [ ] **Step 5: Commit**

```bash
git add tailwind.config.ts src/app.css
git commit -m "feat: dual-mode Machine tokens — CSS variables flip per theme

Move the 8 color tokens behind CSS variables on :root (dark) and
html.light (paper-bone + ochre phosphor). Token names are unchanged,
so migrated surfaces keep working; only the values flip with the
theme class. Glow is scoped dark-only."
```

---

## Task 2: Default to light theme and apply it on load

Today `settings.theme` defaults to `'auto'` and no class is ever applied on boot — so the app always renders dark. The user prefers light. Change the default to `'light'` and apply the class during `load()` so a cold boot renders the chosen theme.

This is a behavioral change to a store with logic, so it gets a unit test (TDD). Theme persistence to the DB is explicitly OUT of scope.

**Files:**
- Modify: `src/lib/stores/settings.svelte.ts` (lines 9, 11–16, and `setTheme` at 37–43)
- Test: `src/tests/unit/stores/settings.theme.test.ts` (new)

**Interfaces:**
- Consumes: `meta.getMeta` / `setMeta` (existing) — unchanged.
- Produces: `settings.theme` initial value is `'light'`; `settings.load()` applies the `html.light`/`html.dark` class; `settings.setTheme(t)` sets state and applies the class (existing behavior, preserved).

- [ ] **Step 1: Write the failing test**

Create `src/tests/unit/stores/settings.theme.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { settings } from '$lib/stores/settings.svelte';

describe('settings theme', () => {
	beforeEach(() => {
		document.documentElement.classList.remove('light', 'dark');
	});

	it('defaults to light', () => {
		expect(settings.theme).toBe('light');
	});

	it('applies the light class on setTheme("light")', () => {
		settings.setTheme('light');
		expect(document.documentElement.classList.contains('light')).toBe(true);
		expect(document.documentElement.classList.contains('dark')).toBe(false);
	});

	it('applies the dark class on setTheme("dark")', () => {
		settings.setTheme('dark');
		expect(document.documentElement.classList.contains('dark')).toBe(true);
		expect(document.documentElement.classList.contains('light')).toBe(false);
	});

	it('clears both classes on setTheme("auto")', () => {
		settings.setTheme('dark');
		settings.setTheme('auto');
		expect(document.documentElement.classList.contains('light')).toBe(false);
		expect(document.documentElement.classList.contains('dark')).toBe(false);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/tests/unit/stores/settings.theme.test.ts`
Expected: FAIL — `defaults to light` fails because the current default is `'auto'`.

- [ ] **Step 3: Change the default and apply the class on load**

In `src/lib/stores/settings.svelte.ts`, change line 9 from:

```ts
	theme = $state<'auto' | 'light' | 'dark'>('auto');
```

to:

```ts
	theme = $state<'auto' | 'light' | 'dark'>('light');
```

Then add an `applyThemeClass` helper and call it from `load()` and `setTheme()`. Replace the `load()` method (lines 11–16) with:

```ts
	async load(): Promise<void> {
		const db = await getDb();
		this.locale = (await meta.getLocale(db)) as Locale;
		this.currency = await meta.getCurrency(db);
		this.firstRunComplete = await meta.isFirstRunComplete(db);
		this.applyThemeClass();
	}
```

Replace the `setTheme` method (lines 37–43) with:

```ts
	setTheme(theme: 'auto' | 'light' | 'dark'): void {
		this.theme = theme;
		this.applyThemeClass();
	}

	private applyThemeClass(): void {
		if (typeof document === 'undefined') return;
		document.documentElement.classList.remove('light', 'dark');
		if (this.theme !== 'auto') document.documentElement.classList.add(this.theme);
	}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/tests/unit/stores/settings.theme.test.ts`
Expected: PASS — all four cases green.

- [ ] **Step 5: Run the full suite to confirm no regressions**

Run: `pnpm test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/stores/settings.svelte.ts src/tests/unit/stores/settings.theme.test.ts
git commit -m "feat: default theme to light and apply it on load"
```

---

## Task 3: Migrate the 7 remaining primitives + chart to Machine tokens

These primitives still use `zinc`/`emerald`/`red` Tailwind defaults. Convert each to the same token classes the already-migrated components use, following the global color semantics (positive = phosphor, negative = debit, neutral = dim). Focus-ring work is handled by the global `:focus-visible` in app.css, so per-element `focus:ring-emerald-500` is removed.

These are markup-only changes (no behavioral/API change), so they are verified by `pnpm check` + `pnpm test` (the existing `Select.test.ts` and `Input.test.ts` assert behavior, not classes). No new tests needed.

**Files:**
- Modify: `src/lib/components/primitives/Select.svelte`
- Modify: `src/lib/components/primitives/Autocomplete.svelte`
- Modify: `src/lib/components/primitives/ConfirmDialog.svelte`
- Modify: `src/lib/components/primitives/Skeleton.svelte`
- Modify: `src/lib/components/primitives/Toast.svelte`
- Modify: `src/lib/components/primitives/GlobalToast.svelte`
- Modify: `src/lib/components/charts/DonutChart.svelte`

**Interfaces:** unchanged (same props, same snippets).

- [ ] **Step 1: `Select.svelte`**

Replace the label class and the `<select>` class.

Label (line 6) — from:
```svelte
		<label for={selectId} class="block text-sm font-medium text-zinc-700 dark:text-zinc-300">{label}</label>
```
to:
```svelte
		<label for={selectId} class="plate block">{label}</label>
```

`<select>` (line 15) — from:
```svelte
		class="w-full px-3 py-2 text-base rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-emerald-500"
```
to:
```svelte
		class="w-full px-3 py-2 text-base rounded-md border border-line bg-ink text-ledger"
```

- [ ] **Step 2: `Autocomplete.svelte`**

Label (line 35) — from `text-zinc-700 dark:text-zinc-300` to:
```svelte
		<label for={inputId} class="plate block">{label}</label>
```

`<input>` (lines 47–48) — from:
```svelte
		class="w-full px-3 py-2 text-base rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-emerald-500"
```
to:
```svelte
		class="w-full px-3 py-2 text-base rounded-md border border-line bg-ink text-ledger"
```

Listbox `<ul>` (line 49) — from:
```svelte
		<ul id={listboxId} class="absolute z-20 w-full mt-1 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-lg max-h-48 overflow-y-auto animate-scale-in" role="listbox">
```
to:
```svelte
		<ul id={listboxId} class="absolute z-20 w-full mt-1 bg-tape border border-line rounded-lg shadow-lg max-h-48 overflow-y-auto animate-scale-in" role="listbox">
```

Option `<button>` (line 53) — from:
```svelte
					class="w-full text-left px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors {opt.value === value ? 'text-emerald-600 font-medium' : 'text-zinc-900 dark:text-zinc-50'}"
```
to:
```svelte
					class="w-full text-left px-3 py-2 text-sm hover:bg-line/40 transition-colors {opt.value === value ? 'text-phosphor font-medium' : 'text-ledger'}"
```

- [ ] **Step 3: `ConfirmDialog.svelte`**

Backdrop `<div>` (line 16) — keep `bg-black/40 backdrop-blur-sm` (a scrim over content; mode-neutral). Leave it.

Panel `<div>` (line 17) — from:
```svelte
		<div class="relative bg-white dark:bg-zinc-800 rounded-xl shadow-xl w-full max-w-sm p-6 space-y-4 animate-scale-in">
```
to:
```svelte
		<div class="relative bg-tape border border-line rounded-xl shadow-xl w-full max-w-sm p-6 space-y-4 animate-scale-in">
```

Title `<h2>` (line 18) — from `text-lg font-semibold text-zinc-900 dark:text-zinc-50` to:
```svelte
			<h2 class="figures text-lg text-ledger tracking-wide">{title}</h2>
```

Message `<p>` (line 20) — from `text-sm text-zinc-500` to `text-sm text-dim`:
```svelte
			<p class="text-sm text-dim">{message}</p>
```

- [ ] **Step 4: `Skeleton.svelte`**

Line 7 — from:
```svelte
		<div class="{height} bg-zinc-200 dark:bg-zinc-700 rounded"></div>
```
to:
```svelte
		<div class="{height} bg-line rounded"></div>
```

- [ ] **Step 5: `Toast.svelte`**

Line 15 — from:
```svelte
	<div class="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 md:left-6 md:translate-x-0 z-50 bg-zinc-800 dark:bg-zinc-700 text-white px-4 py-3 rounded-lg shadow-md flex items-center gap-3 text-sm">
```
to:
```svelte
	<div class="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 md:left-6 md:translate-x-0 z-50 bg-tape border border-line text-ledger px-4 py-3 rounded-lg shadow-md flex items-center gap-3 text-sm">
```

Action button (line 18) — from `text-emerald-400 hover:text-emerald-300` to:
```svelte
		<button onclick={onaction} class="font-semibold text-phosphor hover:text-phosphor-bright uppercase text-xs">{action}</button>
```

- [ ] **Step 6: `GlobalToast.svelte`**

Container (line 6) — from:
```svelte
	<div class="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 md:left-6 md:translate-x-0 z-50 bg-zinc-800 dark:bg-zinc-700 text-white px-4 py-3 rounded-lg shadow-md flex items-center gap-3 text-sm animate-slide-up">
```
to:
```svelte
	<div class="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 md:left-6 md:translate-x-0 z-50 bg-tape border border-line text-ledger px-4 py-3 rounded-lg shadow-md flex items-center gap-3 text-sm animate-slide-up">
```

Action button (lines 9–12) — from `text-emerald-400 hover:text-emerald-300` to `text-phosphor hover:text-phosphor-bright`:
```svelte
			<button
				onclick={() => { toast.current?.onaction?.(); toast.dismiss(); }}
				class="font-semibold text-phosphor hover:text-phosphor-bright uppercase text-xs shrink-0"
			>{toast.current.action}</button>
```

Dismiss button (line 14) — from `text-zinc-400 hover:text-white` to:
```svelte
		<button onclick={() => toast.dismiss()} class="text-dim hover:text-ledger ml-2 text-xs">✕</button>
```

- [ ] **Step 7: `DonutChart.svelte`**

Inner circle (line in the `<svg>`) — from `class="fill-white dark:fill-zinc-800"` to:
```svelte
			<circle cx="50" cy="50" r="25" class="fill-tape" />
```
(`fill-tape` works because Tailwind generates `fill-*` from the same color tokens.)

Legend label (in the legend `<div>`) — from `text-zinc-600 dark:text-zinc-400` to:
```svelte
				<span class="text-dim">{item.label}</span>
```

- [ ] **Step 8: Verify no remaining `zinc`/`emerald`/`red` literals in primitives**

Run: `grep -rnE "zinc|emerald|red-[0-9]|bg-white|text-white" src/lib/components/primitives src/lib/components/charts`
Expected: no matches (or only the deliberate `bg-black/40` scrim in ConfirmDialog, which is not matched by this grep).

- [ ] **Step 9: Run type check + tests**

Run: `pnpm check && pnpm test`
Expected: pass. `Select.test.ts` and `Input.test.ts` assert behavior (render label, render options, disabled), not color classes — they stay green.

- [ ] **Step 10: Commit**

```bash
git add src/lib/components/primitives src/lib/components/charts
git commit -m "refactor: migrate remaining primitives + donut chart to Machine tokens"
```

---

## Task 4: Migrate Accounts pages (list + detail)

Markup-only conversion. Mechanical mapping per the global constraints:
- `bg-white dark:bg-zinc-800` → `bg-tape`
- `text-zinc-900 dark:text-zinc-50` → `text-ledger`
- `text-zinc-500` / `text-zinc-400` → `text-dim`
- `border-zinc-200 dark:border-zinc-700` → `border-line`
- `divide-zinc-100 dark:divide-zinc-700` → `divide-line`
- `text-red-500` (a liability/negative balance) → `text-debit`
- `hover:text-emerald-600` (the Edit action) → `hover:text-phosphor`
- `hover:text-amber-600` (Archive) → `hover:text-phosphor` (consolidate onto the system accent)
- `hover:text-red-500` (Delete) → `hover:text-debit`
- `text-emerald-600` (Unarchive link) → `text-phosphor`
- page `<h1>` → add `figures` + `text-ledger`
- section `<h2>` labels → `plate` micro-labels

Verified by `pnpm check` + visual sweep (configuration/markup exception).

**Files:**
- Modify: `src/routes/accounts/+page.svelte`
- Modify: `src/routes/accounts/[id]/+page.svelte`

- [ ] **Step 1: Rewrite `src/routes/accounts/+page.svelte`**

Full file. The `<script>` block is unchanged; only the template classes change. Replace the entire `<div class="space-y-6">…</div>` template (lines 40–112) with:

```svelte
<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h1 class="figures text-xl text-ledger tracking-wide">Accounts</h1>
		<Button size="sm" onclick={openCreate}>+ Add account</Button>
	</div>

	<section>
		<h2 class="plate mb-2">Assets</h2>
		{#if accounts.assets.length === 0}
			<div class="bg-tape rounded-lg border border-line p-6 text-center text-dim">
				<p class="text-sm">No asset accounts.</p>
			</div>
		{:else}
			<div class="bg-tape rounded-lg border border-line divide-y divide-line">
				{#each accounts.assets as acc}
					<div class="flex items-center justify-between p-4 group">
						<a href="/accounts/{acc.id}" class="flex-1">
							<div class="text-sm font-medium text-ledger">{acc.name}</div>
							<div class="text-xs text-dim">{acc.type}{acc.counterparty ? ` · ${acc.counterparty}` : ''}</div>
						</a>
						<span class="figures text-sm text-ledger mr-3">{formatCurrency(acc.balance, settings.currency, settings.locale)}</span>
						<div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
							<button onclick={() => openEdit(acc)} class="text-xs text-dim hover:text-phosphor px-2">Edit</button>
							<button onclick={() => archiveAccount(acc)} class="text-xs text-dim hover:text-phosphor px-2">Archive</button>
							<button onclick={() => confirmDelete = acc} class="text-xs text-dim hover:text-debit px-2">Delete</button>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</section>

	<section>
		<h2 class="plate mb-2">Liabilities</h2>
		{#if accounts.liabilities.length === 0}
			<div class="bg-tape rounded-lg border border-line p-6 text-center text-dim">
				<p class="text-sm">No liability accounts.</p>
			</div>
		{:else}
			<div class="bg-tape rounded-lg border border-line divide-y divide-line">
				{#each accounts.liabilities as acc}
					<div class="flex items-center justify-between p-4 group">
						<a href="/accounts/{acc.id}" class="flex-1">
							<div class="text-sm font-medium text-ledger">{acc.name}</div>
							<div class="text-xs text-dim">{acc.type}{acc.counterparty ? ` · ${acc.counterparty}` : ''}</div>
						</a>
						<span class="figures text-sm text-debit mr-3">{formatCurrency(Math.abs(acc.balance), settings.currency, settings.locale)}</span>
						<div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
							<button onclick={() => openEdit(acc)} class="text-xs text-dim hover:text-phosphor px-2">Edit</button>
							<button onclick={() => confirmDelete = acc} class="text-xs text-dim hover:text-debit px-2">Delete</button>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</section>

	{#if accounts.archived.length > 0}
		<section>
			<h2 class="plate mb-2">Archived</h2>
			<div class="bg-tape rounded-lg border border-line divide-y divide-line">
				{#each accounts.archived as acc}
					<div class="flex items-center justify-between p-4">
						<div class="flex-1">
							<div class="text-sm text-dim">{acc.name}</div>
						</div>
						<button onclick={() => archiveAccount(acc)} class="text-xs text-phosphor hover:underline">Unarchive</button>
					</div>
				{/each}
			</div>
		</section>
	{/if}
</div>
```

Leave the two `<Modal>` / `<ConfirmDialog>` blocks at the bottom (lines 114–124) untouched.

- [ ] **Step 2: Rewrite `src/routes/accounts/[id]/+page.svelte` template (lines 73–132)**

The `<script>` (lines 1–71) and the `<Modal>` / `<ConfirmDialog>` blocks (lines 134–155) are unchanged. Replace the `<div class="space-y-6">…</div>` template. Note the amount-color ternary and the reconciliation delta: `text-red-500` (expense) → `text-debit`; `text-emerald-500` (income) → `text-phosphor`; `text-zinc-500` (transfer) → `text-dim`. The reconciliation `Δ` is green when balanced (`text-emerald-600` → `text-phosphor`) and amber when off (`text-amber-600` → `text-phosphor` too — consolidate on the system accent; both are "informational", and phosphor is readable either way).

```svelte
<div class="space-y-6">
	{#if account}
		<div class="flex items-center justify-between">
			<div>
				<h1 class="figures text-xl text-ledger tracking-wide">{account.name}</h1>
				<p class="text-sm text-dim">{account.type}{account.counterparty ? ` · ${account.counterparty}` : ''}</p>
			</div>
			<Button size="sm" variant="secondary" onclick={() => { showReconcile = true; actualBalance = String(account!.balance); }}>Reconcile</Button>
		</div>

		<div class="bg-tape rounded-lg border border-line p-4">
			<p class="figures text-2xl text-ledger">{formatCurrency(account.balance, settings.currency, settings.locale)}</p>
			<p class="plate mt-1">Current balance</p>
		</div>

		<section>
			<h2 class="plate mb-2">Transactions</h2>
			{#if txns.length === 0}
				<div class="bg-tape rounded-lg border border-line p-6 text-center text-dim">
					<p class="text-sm">No transactions for this account.</p>
				</div>
			{:else}
				<div class="bg-tape rounded-lg border border-line divide-y divide-line">
					{#each txns as tx}
						<div class="p-3 flex items-center justify-between text-sm">
							<div>
								<div class="text-ledger">{tx.payee || tx.kind}</div>
								<div class="text-xs text-dim">{formatDateRelative(tx.date, settings.locale)}</div>
							</div>
							<span class="figures {tx.kind === 'expense' ? 'text-debit' : tx.kind === 'income' ? 'text-phosphor' : 'text-dim'}">
								{tx.kind === 'expense' ? '-' : ''}{formatCurrency(tx.amount, settings.currency, settings.locale)}
							</span>
						</div>
					{/each}
				</div>
			{/if}
		</section>

		{#if history.length > 0}
			<section>
				<h2 class="plate mb-2">Reconciliation History</h2>
				<div class="bg-tape rounded-lg border border-line divide-y divide-line">
					{#each history as h}
						<div class="p-3 flex items-center justify-between text-sm">
							<div>
								<div class="text-ledger">{h.date}</div>
								<div class="text-xs text-dim">Expected {formatCurrency(h.expected_balance, settings.currency, settings.locale)} · Actual {formatCurrency(h.actual_balance, settings.currency, settings.locale)}</div>
							</div>
							<span class="figures text-xs text-phosphor">
								Δ {formatCurrency(h.actual_balance - h.expected_balance, settings.currency, settings.locale)}
							</span>
						</div>
					{/each}
				</div>
			</section>
		{/if}
	{:else}
		<p class="text-dim">Loading...</p>
	{/if}
</div>
```

- [ ] **Step 3: Type check**

Run: `pnpm check`
Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add src/routes/accounts/+page.svelte src/routes/accounts/[id]/+page.svelte
git commit -m "refactor: migrate Accounts pages to Machine tokens"
```

---

## Task 5: Migrate Transactions page

Same mapping as Task 4. Specifics for this page:
- `bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400` "Future" chip → `bg-phosphor/15 text-phosphor` (amber is the phosphor family; tint it lightly).
- the amount color ternary `text-red-500` (expense) → `text-debit`; `text-emerald-500` (income) → `text-phosphor`; `text-zinc-500` (transfer) → `text-dim`.
- `hover:text-emerald-600` (duplicate ↻) → `hover:text-phosphor`; `hover:text-red-500` (delete ✕) → `hover:text-debit`.

**Files:**
- Modify: `src/routes/transactions/+page.svelte`

- [ ] **Step 1: Rewrite the template of `src/routes/transactions/+page.svelte`**

Replace the template (lines 191–236). The `<script>` and final `<Modal>` are unchanged.

```svelte
<div class="space-y-4">
	<h1 class="figures text-xl text-ledger tracking-wide">Transactions</h1>

	<div class="flex gap-2">
		<div class="flex-1">
			<Input type="search" placeholder="Search payee, description..." bind:value={search} />
		</div>
		<Button size="sm" onclick={onSearch}>Search</Button>
	</div>

	<div class="bg-tape rounded-lg border border-line divide-y divide-line">
		{#if displayItems.length === 0}
			<div class="text-center py-12 text-dim">
				<p class="text-3xl mb-2">📋</p>
				<p class="text-sm">No transactions found.</p>
			</div>
		{:else}
			{#each displayItems as tx}
				<div class="p-4 flex items-center justify-between group">
					<button onclick={() => openEdit(tx)} class="flex-1 text-left">
						<div class="text-sm text-ledger flex items-center gap-2">
							{tx.payee || tx.kind}
							{#if tx.date > today}
								<span class="text-[10px] px-1.5 py-0.5 rounded bg-phosphor/15 text-phosphor font-medium uppercase">Future</span>
							{/if}
						</div>
						<div class="text-xs text-dim">{formatDateRelative(tx.date, settings.locale)} · {tx.kind}</div>
					</button>
					<span class="figures text-sm mr-3 {tx.kind === 'expense' ? 'text-debit' : tx.kind === 'income' ? 'text-phosphor' : 'text-dim'}">
						{tx.kind === 'expense' ? '-' : ''}{formatCurrency(tx.amount, settings.currency, settings.locale)}
					</span>
					<div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
						<button onclick={() => doDuplicate(tx)} class="text-xs text-dim hover:text-phosphor px-2" title="Duplicate">↻</button>
						<button onclick={() => doDelete(tx)} class="text-xs text-dim hover:text-debit px-2" title="Delete">✕</button>
					</div>
				</div>
			{/each}
		{/if}
	</div>

	<div class="flex justify-between items-center text-sm">
		<Button variant="ghost" size="sm" disabled={page === 0} onclick={prevPage}>← Previous</Button>
		<span class="text-dim">Page {page + 1}</span>
		<Button variant="ghost" size="sm" disabled={!hasNextPage} onclick={nextPage}>Next →</Button>
	</div>
</div>
```

- [ ] **Step 2: Type check**

Run: `pnpm check`
Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add src/routes/transactions/+page.svelte
git commit -m "refactor: migrate Transactions page to Machine tokens"
```

---

## Task 6: Migrate Budgets, Goals, Debts pages

Three list pages, same mapping. Grouped because they share the identical primitive swap and each is small.

**Files:**
- Modify: `src/routes/budgets/+page.svelte`
- Modify: `src/routes/goals/+page.svelte`
- Modify: `src/routes/debts/+page.svelte`

- [ ] **Step 1: Rewrite `src/routes/budgets/+page.svelte` template (lines 298–350)**

```svelte
<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h1 class="figures text-xl text-ledger tracking-wide">Budgets</h1>
		<div class="flex items-center gap-2 text-sm">
			<button onclick={prevMonth} class="p-1 text-dim hover:text-ledger">◀</button>
			<span class="figures font-medium text-ledger">{budgets.month}</span>
			<button onclick={nextMonth} class="p-1 text-dim hover:text-ledger">▶</button>
		</div>
	</div>

	{#if !budgets.hasAllocations}
		<div class="bg-phosphor/10 border border-phosphor/30 rounded-lg p-4 flex items-center justify-between">
			<p class="text-sm text-phosphor">No budget set for this month.</p>
			<Button size="sm" variant="secondary" onclick={() => budgets.copyFromPrevious()}>Copy from previous</Button>
		</div>
	{/if}

	<div class="space-y-4">
		{#each budgetableBuckets as bucket}
			{@const b = getBudget(bucket.id)}
			{@const allocated = b?.allocated ?? 0}
			{@const spent = b?.spent ?? 0}
			{@const remaining = allocated - spent}
			{@const pct = allocated > 0 ? Math.round((spent / allocated) * 100) : 0}
			<div class="bg-tape rounded-lg border border-line p-4 space-y-2">
				<div class="flex items-center justify-between">
					<h3 class="text-sm font-medium text-ledger">{bucket.name}</h3>
					{#if editing === bucket.id}
						<div class="flex gap-2 items-center">
							<input
								bind:value={editValue}
								onkeydown={(e) => { if (e.key === 'Enter') saveEdit(bucket.id); if (e.key === 'Escape') editing = null; }}
								placeholder="0"
								class="figures w-32 px-2 py-1 text-xs rounded border border-line bg-ink text-ledger text-right"
							/>
							<button onclick={() => saveEdit(bucket.id)} class="text-xs text-phosphor">✓</button>
							<button onclick={() => editing = null} class="text-xs text-dim">✕</button>
						</div>
					{:else}
						<button onclick={() => startEdit(bucket.id, allocated)} class="figures text-xs text-dim hover:text-phosphor">
							{formatCurrency(spent, settings.currency, settings.locale)} / {formatCurrency(allocated, settings.currency, settings.locale)}
						</button>
					{/if}
				</div>
				<Progress value={pct} max={100} size="sm" />
				<div class="flex justify-between text-xs text-dim">
					<span>{pct}% used</span>
					<span>{formatCurrency(remaining, settings.currency, settings.locale)} remaining</span>
				</div>
			</div>
		{/each}
	</div>
</div>
```

- [ ] **Step 2: Rewrite `src/routes/goals/+page.svelte` template (lines 385–436)**

```svelte
<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h1 class="figures text-xl text-ledger tracking-wide">Goals</h1>
		<Button size="sm" onclick={openCreate}>+ Add goal</Button>
	</div>

	<section>
		<h2 class="plate mb-2">Active</h2>
		{#if goals.active.length === 0}
			<div class="bg-tape rounded-lg border border-line p-6 text-center text-dim">
				<p class="text-sm">No active goals. <button onclick={openCreate} class="text-phosphor hover:underline">Create your first goal</button></p>
			</div>
		{:else}
			<div class="space-y-3">
				{#each goals.active as g}
					<div class="bg-tape rounded-lg border border-line p-4 space-y-2 group">
						<div class="flex items-center justify-between">
							<button onclick={() => openEdit(g)} class="figures text-sm font-medium text-ledger text-left">{g.name}</button>
							<span class="text-xs text-dim">{statusIcons[g.velocity_status] ?? ''} {g.velocity_status.replace('_', ' ')}</span>
						</div>
						<Progress value={g.progress_pct} max={100} size="sm" />
						<div class="flex justify-between text-xs text-dim">
							<span>{formatCurrency(g.current_amount, settings.currency, settings.locale)} / {formatCurrency(g.target_amount, settings.currency, settings.locale)}</span>
							<span>{g.progress_pct}% · due {g.target_date}</span>
						</div>
						{#if g.velocity_status === 'overdue'}
							<div class="flex gap-2 pt-2 border-t border-line">
								<button onclick={() => openEdit(g)} class="text-xs text-phosphor hover:underline">Extend date</button>
								<button onclick={() => markComplete(g)} class="text-xs text-phosphor hover:underline">Mark complete</button>
								<button onclick={() => markAbandoned(g)} class="text-xs text-dim hover:underline">Mark abandoned</button>
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</section>

	{#if goals.completed.length > 0}
		<section>
			<h2 class="plate mb-2">Completed</h2>
			<div class="space-y-2">
				{#each goals.completed as g}
					<div class="bg-tape rounded-lg border border-line p-3 flex items-center justify-between text-sm">
						<span class="text-dim">{g.name}</span>
						<span class="text-phosphor">✓ Complete</span>
					</div>
				{/each}
			</div>
		</section>
	{/if}
</div>
```

Leave the `<Modal>` (lines 438–440) untouched.

- [ ] **Step 3: Rewrite `src/routes/debts/+page.svelte` template (lines 510–566)**

Amount color semantics: a debt I owe is negative → `text-debit`; owed to me is positive → `text-phosphor`. `emerald` action links → `phosphor`.

```svelte
<div class="space-y-6">
	<h1 class="figures text-xl text-ledger tracking-wide">Debts</h1>

	<section>
		<h2 class="plate mb-2">I Owe</h2>
		{#if debts.i_owe.length === 0}
			<div class="bg-tape rounded-lg border border-line p-6 text-center text-dim">
				<p class="text-sm">No debts. You're debt-free! 🎉</p>
			</div>
		{:else}
			<div class="bg-tape rounded-lg border border-line divide-y divide-line">
				{#each debts.i_owe as d}
					<div class="p-4 flex items-center justify-between group">
						<div>
							<div class="text-sm font-medium text-ledger">{d.counterparty}</div>
							<div class="text-xs text-dim">{d.name}</div>
						</div>
						<div class="flex items-center gap-2">
							<span class="figures text-sm text-debit">{formatCurrency(Math.abs(d.balance), settings.currency, settings.locale)}</span>
							<div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
								<button onclick={() => openPayment(d)} class="text-xs text-phosphor hover:underline px-2">Pay</button>
								<button onclick={() => openWriteoff(d)} class="text-xs text-dim hover:underline px-2">Write off</button>
							</div>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</section>

	<section>
		<h2 class="plate mb-2">Owed to Me</h2>
		{#if debts.owed_to_me.length === 0}
			<div class="bg-tape rounded-lg border border-line p-6 text-center text-dim">
				<p class="text-sm">No one owes you money.</p>
			</div>
		{:else}
			<div class="bg-tape rounded-lg border border-line divide-y divide-line">
				{#each debts.owed_to_me as d}
					<div class="p-4 flex items-center justify-between group">
						<div>
							<div class="text-sm font-medium text-ledger">{d.counterparty}</div>
							<div class="text-xs text-dim">{d.name}</div>
						</div>
						<div class="flex items-center gap-2">
							<span class="figures text-sm text-phosphor">{formatCurrency(d.balance, settings.currency, settings.locale)}</span>
							<div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
								<button onclick={() => openPayment(d)} class="text-xs text-phosphor hover:underline px-2">Receive</button>
								<button onclick={() => openWriteoff(d)} class="text-xs text-dim hover:underline px-2">Write off</button>
							</div>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</section>
</div>
```

Leave the `<Modal>` at the bottom (lines 568–579) untouched.

- [ ] **Step 4: Type check**

Run: `pnpm check`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/routes/budgets/+page.svelte src/routes/goals/+page.svelte src/routes/debts/+page.svelte
git commit -m "refactor: migrate Budgets, Goals, Debts pages to Machine tokens"
```

---

## Task 7: Migrate Reports pages (overview, trend, compare)

Three report pages. Same mapping plus:
- tab pills: active `bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700` → `bg-phosphor/15 text-phosphor`; inactive `hover:bg-zinc-100 dark:hover:bg-zinc-800` → `hover:bg-line/40 text-dim`.
- stat cards: `bg-white dark:bg-zinc-800` → `bg-tape`; income `text-emerald-600` → `text-phosphor`; expense/net-negative `text-red-500` → `text-debit`.
- trend bars: `bg-emerald-400` (income) → `bg-phosphor`; `bg-red-400` (expense) → `bg-debit`. Legend swatches likewise.
- compare table: `text-red-500` (negative change = good, spending down) and `text-emerald-600` (positive change = bad, spending up) — keep the *semantic*, so: `row.change > 0` (more spending) → `text-debit`; `row.change < 0` (less spending) → `text-phosphor`.

**Files:**
- Modify: `src/routes/reports/+page.svelte`
- Modify: `src/routes/reports/trend/+page.svelte`
- Modify: `src/routes/reports/compare/+page.svelte`

- [ ] **Step 1: Rewrite `src/routes/reports/+page.svelte` template (lines 619–698)**

```svelte
<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h1 class="figures text-xl text-ledger tracking-wide">Reports</h1>
		<div class="flex gap-2 text-sm">
			<a href="/reports" class="px-3 py-1.5 rounded-md bg-phosphor/15 text-phosphor font-medium">Overview</a>
			<a href="/reports/trend" class="px-3 py-1.5 rounded-md text-dim hover:bg-line/40">Trend</a>
			<a href="/reports/compare" class="px-3 py-1.5 rounded-md text-dim hover:bg-line/40">Compare</a>
		</div>
	</div>

	<label class="flex items-center gap-2 text-sm text-dim">
		<input type="checkbox" bind:checked={includeAdjustments} class="rounded" />
		Include adjustments
	</label>

	{#if report}
		<div class="grid md:grid-cols-3 gap-4">
			<div class="bg-tape rounded-lg border border-line p-4">
				<p class="plate mb-1">Income</p>
				<p class="figures text-2xl text-phosphor">{formatCurrency(report.total_income, settings.currency, settings.locale)}</p>
			</div>
			<div class="bg-tape rounded-lg border border-line p-4">
				<p class="plate mb-1">Expenses</p>
				<p class="figures text-2xl text-debit">{formatCurrency(report.total_expense, settings.currency, settings.locale)}</p>
			</div>
			<div class="bg-tape rounded-lg border border-line p-4">
				<p class="plate mb-1">Net Cash Flow</p>
				<p class="figures text-2xl {report.net_cash_flow >= 0 ? 'text-phosphor' : 'text-debit'}">{formatCurrency(report.net_cash_flow, settings.currency, settings.locale)}</p>
			</div>
		</div>

		{#if report.spending_by_bucket.length > 0}
			<div class="bg-tape rounded-lg border border-line p-4">
				<h2 class="plate mb-3">Spending by Bucket</h2>
				<DonutChart data={donutData} />
				<div class="space-y-2 mt-4">
					{#each report.spending_by_bucket as b}
						<div class="flex items-center justify-between text-sm">
							<span class="text-ledger">{b.name}</span>
							<span class="figures text-dim">{formatCurrency(b.total, settings.currency, settings.locale)}</span>
						</div>
					{/each}
				</div>
			</div>
		{/if}

		{#if report.top_categories.length > 0}
			<div class="bg-tape rounded-lg border border-line p-4">
				<h2 class="plate mb-3">Top Categories</h2>
				<div class="space-y-2">
					{#each report.top_categories as c}
						<div class="flex items-center justify-between text-sm">
							<span class="text-ledger">{c.name}</span>
							<span class="figures text-dim">{formatCurrency(c.total, settings.currency, settings.locale)}</span>
						</div>
					{/each}
				</div>
			</div>
		{/if}

		{#if report.top_transactions.length > 0}
			<div class="bg-tape rounded-lg border border-line p-4">
				<h2 class="plate mb-3">Top Transactions</h2>
				<div class="space-y-2">
					{#each report.top_transactions as tx}
						<div class="flex items-center justify-between text-sm">
							<span class="text-ledger">{tx.payee || 'No payee'}</span>
							<span class="figures text-debit">{formatCurrency(tx.amount, settings.currency, settings.locale)}</span>
						</div>
					{/each}
				</div>
			</div>
		{/if}

		{#if report.spending_by_bucket.length === 0 && report.top_transactions.length === 0}
			<div class="bg-tape rounded-lg border border-line p-6 text-center text-dim">
				<p class="text-sm">No data for this month. Add transactions to see reports.</p>
			</div>
		{/if}
	{/if}
</div>
```

- [ ] **Step 2: Rewrite `src/routes/reports/trend/+page.svelte` template (lines 725–785)**

```svelte
<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h1 class="figures text-xl text-ledger tracking-wide">Reports</h1>
		<div class="flex gap-2 text-sm">
			<a href="/reports" class="px-3 py-1.5 rounded-md text-dim hover:bg-line/40">Overview</a>
			<a href="/reports/trend" class="px-3 py-1.5 rounded-md bg-phosphor/15 text-phosphor font-medium">Trend</a>
			<a href="/reports/compare" class="px-3 py-1.5 rounded-md text-dim hover:bg-line/40">Compare</a>
		</div>
	</div>

	<div class="flex items-center gap-4">
		<div class="flex gap-1 text-sm">
			{#each [6, 12, 24] as m}
				<button onclick={() => months = m}
					class="px-2 py-1 rounded {months === m ? 'bg-phosphor/15 text-phosphor font-medium' : 'text-dim'}"
				>{m}mo</button>
			{/each}
		</div>
		<label class="flex items-center gap-2 text-sm text-dim">
			<input type="checkbox" bind:checked={includeAdjustments} class="rounded" />
			Include adjustments
		</label>
	</div>

	{#if points.length > 0 && points.some((p) => p.income > 0 || p.expense > 0)}
		<div class="bg-tape rounded-lg border border-line p-4">
			<div class="flex items-end gap-1 h-48">
				{#each points as point}
					<div class="flex-1 flex flex-col items-center gap-1 h-full justify-end">
						<div class="w-full flex gap-0.5 items-end flex-1">
							<div class="flex-1 bg-phosphor rounded-t" style="height: {(point.income / maxValue) * 100}%"></div>
							<div class="flex-1 bg-debit rounded-t" style="height: {(point.expense / maxValue) * 100}%"></div>
						</div>
						<span class="text-[10px] text-dim">{point.month.slice(5)}</span>
					</div>
				{/each}
			</div>
			<div class="flex gap-4 mt-3 text-xs text-dim">
				<span class="flex items-center gap-1"><span class="w-3 h-3 rounded bg-phosphor"></span> Income</span>
				<span class="flex items-center gap-1"><span class="w-3 h-3 rounded bg-debit"></span> Expense</span>
			</div>
		</div>

		<div class="bg-tape rounded-lg border border-line divide-y divide-line">
			{#each points as point}
				<div class="p-3 flex items-center justify-between text-sm">
					<span class="text-dim">{point.month}</span>
					<div class="flex gap-4 figures">
						<span class="text-phosphor">{formatCurrency(point.income, settings.currency, settings.locale)}</span>
						<span class="text-debit">{formatCurrency(point.expense, settings.currency, settings.locale)}</span>
						<span class="{point.net >= 0 ? 'text-phosphor' : 'text-debit'}">{formatCurrency(point.net, settings.currency, settings.locale)}</span>
					</div>
				</div>
			{/each}
		</div>
	{:else}
		<div class="bg-tape rounded-lg border border-line p-6 text-center text-dim min-h-[200px] flex items-center justify-center">
			<p class="text-sm">No trend data yet. Add transactions across multiple months.</p>
		</div>
	{/if}
</div>
```

- [ ] **Step 3: Rewrite `src/routes/reports/compare/+page.svelte` template (lines 821–873)**

```svelte
<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h1 class="figures text-xl text-ledger tracking-wide">Reports</h1>
		<div class="flex gap-2 text-sm">
			<a href="/reports" class="px-3 py-1.5 rounded-md text-dim hover:bg-line/40">Overview</a>
			<a href="/reports/trend" class="px-3 py-1.5 rounded-md text-dim hover:bg-line/40">Trend</a>
			<a href="/reports/compare" class="px-3 py-1.5 rounded-md bg-phosphor/15 text-phosphor font-medium">Compare</a>
		</div>
	</div>

	<div class="flex items-center gap-4">
		<input type="month" bind:value={monthA} class="px-2 py-1 text-sm rounded border border-line bg-ink text-ledger" />
		<span class="text-dim">vs</span>
		<input type="month" bind:value={monthB} class="px-2 py-1 text-sm rounded border border-line bg-ink text-ledger" />
		<label class="flex items-center gap-2 text-sm text-dim">
			<input type="checkbox" bind:checked={includeAdjustments} class="rounded" />
			Adjustments
		</label>
	</div>

	{#if rows.length > 0}
		<div class="bg-tape rounded-lg border border-line overflow-hidden">
			<table class="w-full text-sm">
				<thead>
					<tr class="border-b border-line text-dim text-xs">
						<th class="text-left p-3 font-medium">Category</th>
						<th class="text-right p-3 font-medium">{monthA}</th>
						<th class="text-right p-3 font-medium">{monthB}</th>
						<th class="text-right p-3 font-medium">Change</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-line">
					{#each rows as row}
						<tr>
							<td class="p-3 text-ledger">{row.name}</td>
							<td class="p-3 text-right figures text-dim">{formatCurrency(row.month_a, settings.currency, settings.locale)}</td>
							<td class="p-3 text-right figures text-dim">{formatCurrency(row.month_b, settings.currency, settings.locale)}</td>
							<td class="p-3 text-right figures {row.change > 0 ? 'text-debit' : row.change < 0 ? 'text-phosphor' : 'text-dim'}">
								{row.change > 0 ? '+' : ''}{formatCurrency(row.change, settings.currency, settings.locale)}
								{#if row.change_pct !== null}
									<span class="text-xs ml-1">({row.change_pct > 0 ? '+' : ''}{Math.round(row.change_pct)}%)</span>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{:else}
		<div class="bg-tape rounded-lg border border-line p-6 text-center text-dim min-h-[200px] flex items-center justify-center">
			<p class="text-sm">No comparison data. Add expenses in both months to compare.</p>
		</div>
	{/if}
</div>
```

- [ ] **Step 4: Type check**

Run: `pnpm check`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/routes/reports
git commit -m "refactor: migrate Reports pages to Machine tokens"
```

---

## Task 8: Migrate Settings pages + final verification

The three settings pages. The theme selector is the one place accent matters most for this work — its active state moves to `phosphor`.

**Files:**
- Modify: `src/routes/settings/+page.svelte`
- Modify: `src/routes/settings/categories/+page.svelte`
- Modify: `src/routes/settings/backup/+page.svelte`

- [ ] **Step 1: Rewrite `src/routes/settings/+page.svelte` template (lines 886–925)**

The `<script>` (lines 877–883) is unchanged.

```svelte
<div class="space-y-6">
	<h1 class="figures text-xl text-ledger tracking-wide">Settings</h1>

	<div class="space-y-3">
		<a href="/settings/categories" class="block bg-tape rounded-lg border border-line p-4 hover:bg-line/30 transition-colors">
			<div class="font-medium text-ledger">Categories</div>
			<div class="text-sm text-dim">Manage buckets and tags</div>
		</a>
		<a href="/settings/backup" class="block bg-tape rounded-lg border border-line p-4 hover:bg-line/30 transition-colors">
			<div class="font-medium text-ledger">Backup & Data</div>
			<div class="text-sm text-dim">Export, import, and manage backups</div>
		</a>
		<div class="bg-tape rounded-lg border border-line p-4">
			<div class="plate mb-2">Theme</div>
			<div class="flex gap-2">
				{#each ['auto', 'light', 'dark'] as theme}
					<button
						onclick={() => setTheme(theme as any)}
						class="px-3 py-1.5 text-sm rounded-md border transition-colors capitalize {settings.theme === theme ? 'border-phosphor bg-phosphor/15 text-phosphor' : 'border-line text-dim'}"
					>{theme}</button>
				{/each}
			</div>
		</div>
		<div class="bg-tape rounded-lg border border-line p-4">
			<div class="plate mb-1">Language</div>
			<div class="flex gap-2">
				<button
					onclick={() => settings.setLocale('en')}
					class="px-3 py-1.5 text-sm rounded-md border transition-colors {settings.locale === 'en' ? 'border-phosphor bg-phosphor/15 text-phosphor' : 'border-line text-dim'}"
				>English</button>
				<button
					onclick={() => settings.setLocale('vi')}
					class="px-3 py-1.5 text-sm rounded-md border transition-colors {settings.locale === 'vi' ? 'border-phosphor bg-phosphor/15 text-phosphor' : 'border-line text-dim'}"
				>Tiếng Việt</button>
			</div>
		</div>
		<div class="bg-tape rounded-lg border border-line p-4">
			<div class="text-xs text-dim">Notchy v0.1.0</div>
		</div>
	</div>
</div>
```

- [ ] **Step 2: Rewrite `src/routes/settings/categories/+page.svelte` template (lines 1006–1038)**

The `<script>` and the two `<Modal>` blocks (lines 1040–1070) are unchanged.

```svelte
<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h1 class="figures text-xl text-ledger tracking-wide">Categories</h1>
		<Button size="sm" onclick={openCreate}>+ Add tag</Button>
	</div>

	{#each categories.buckets as bucket}
		{@const bucketTags = categories.tagsForBucket(bucket.id)}
		<section>
			<h2 class="plate mb-2">{bucket.name}</h2>
			<div class="bg-tape rounded-lg border border-line divide-y divide-line">
				{#if bucketTags.length === 0}
					<p class="p-4 text-sm text-dim">No tags yet.</p>
				{:else}
					{#each bucketTags as tag}
						<div class="p-3 flex items-center justify-between group">
							<div>
								<span class="text-sm text-ledger">{tag.name}</span>
								{#if tag.is_system}<span class="text-xs text-dim ml-2">system</span>{/if}
							</div>
							<div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
								<button onclick={() => openEdit(tag)} class="text-xs text-dim hover:text-phosphor px-2">Edit</button>
								{#if !tag.is_system}
									<button onclick={() => startDelete(tag)} class="text-xs text-dim hover:text-debit px-2">Delete</button>
								{/if}
							</div>
						</div>
					{/each}
				{/if}
			</div>
		</section>
	{/each}
</div>
```

Also update the delete-modal body text (line 1054) — from `text-sm text-zinc-600 dark:text-zinc-400` to `text-sm text-dim`:
```svelte
			<p class="text-sm text-dim">
```

- [ ] **Step 3: Rewrite `src/routes/settings/backup/+page.svelte` template (lines 1145–1170)**

The `<script>` and the `<ConfirmDialog>` (lines 1172–1178) are unchanged.

```svelte
<div class="space-y-6">
	<h1 class="figures text-xl text-ledger tracking-wide">Backup & Data</h1>

	<div class="space-y-4">
		<div class="bg-tape rounded-lg border border-line p-4 space-y-2">
			<h2 class="font-medium text-ledger">Export</h2>
			<p class="text-sm text-dim">Download your data as a SQLite file (most durable) or CSV per table.</p>
			<div class="flex gap-2">
				<Button size="sm" variant="secondary" disabled={busy} onclick={exportSqlite}>Export SQLite</Button>
				<Button size="sm" variant="secondary" disabled={busy} onclick={exportCsvFiles}>Export CSV</Button>
			</div>
		</div>

		<div class="bg-tape rounded-lg border border-line p-4 space-y-2">
			<h2 class="font-medium text-ledger">Import</h2>
			<p class="text-sm text-dim">Replace your database with an imported file. This cannot be undone.</p>
			<Button size="sm" variant="danger" onclick={() => confirmImport = true}>Import database</Button>
		</div>

		<div class="bg-tape rounded-lg border border-line p-4 space-y-2">
			<h2 class="font-medium text-ledger">Auto-backup</h2>
			<p class="text-sm text-dim">Backups are created automatically on every launch. The 10 most recent are retained.</p>
			<p class="text-xs text-dim">Location: same folder as the database file.</p>
		</div>
	</div>
</div>
```

- [ ] **Step 4: Verify no `zinc`/`emerald`/`red-` literals remain anywhere in routes**

Run: `grep -rnE "zinc|emerald|red-[0-9]|amber-[0-9]" src/routes src/lib/components`
Expected: no matches. (Any match is a missed element — fix it before committing.)

- [ ] **Step 5: Full type check + test suite**

Run: `pnpm check && pnpm test`
Expected: pass — `pnpm check` clean, all component tests green (class names unchanged; behavior assertions unaffected).

- [ ] **Step 6: Commit**

```bash
git add src/routes/settings
git commit -m "refactor: migrate Settings pages to Machine tokens"
```

---

## Task 9: Visual sweep both modes

The unit tests can't verify color contrast or visual consistency. This task is the human/agent verification gate. Use the `run` skill to launch the app, then screenshot each route in both themes.

- [ ] **Step 1: Launch the dev app**

Use the `run` skill (or `pnpm tauri dev`). Confirm the app boots in **light** (the new default).

- [ ] **Step 2: Sweep every route in light mode**

Navigate to each and confirm the palette is consistent (paper-bone ground, ochre figures, no stray white/dark cards, readable contrast):
`/` (dashboard), `/transactions`, `/accounts`, `/accounts/<id>`, `/budgets`, `/goals`, `/debts`, `/reports`, `/reports/trend`, `/reports/compare`, `/settings`, `/settings/categories`, `/settings/backup`.

- [ ] **Step 3: Toggle to dark and re-sweep**

In Settings → Theme → `dark`. Re-confirm each route reads as the original phosphor-on-ink Machine system (no muddy glow, figures crisp).

- [ ] **Step 4: Verify the theme toggle persists across navigation**

Pick `light`, navigate away and back to `/settings`; confirm the button still shows `light` active. (Note: theme is in-memory only — a full app restart resets to the `light` default, which is expected and in-scope.)

- [ ] **Step 5: Fix any visual regressions found**

If a route shows a stray default color or broken contrast, re-edit that file using the same mapping and re-commit with `fix:`.

- [ ] **Step 6: Final full-suite gate**

Run: `pnpm check && pnpm test`
Expected: pass.

(No commit needed if Steps 1–4 found nothing to fix.)

---

## Notes for the implementer

- **Token-name stability is the whole game.** Because the names (`ink`, `tape`, `ledger`, etc.) are unchanged, the already-migrated shell/dashboard/forms need zero edits — only their *values* flip. Do not "improve" the names mid-migration.
- **One mapping, applied everywhere.** Every `bg-white dark:bg-zinc-800` → `bg-tape`, every `text-zinc-500/400` → `text-dim`, every `emerald` → `phosphor`, every standalone `red-500` → `debit`. If you find a color class not covered by the mapping, apply the global semantics (positive=phosphor, negative=debit, neutral=dim) and note it in the commit.
- **The `bg-phosphor/15` opacity syntax** works because Tailwind generates `/15` opacity variants from any color token, including variable-backed ones.
- **`fill-tape`** (DonutChart) works because Tailwind's `fill-*` utilities read the same color config.
- **Glow scoping** (`:root:not(.light) .figures-glow`) is the only place a selector has to know about the mode directly — everything else flips via the variable values.
- **Commit per task** (or per logical group as the tasks specify). Keep the token-system commit (`Task 1`) atomic — it's the one other tasks build on.
