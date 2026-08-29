# UX Friction Reduction — Phase 1 Implementation Plan
**Serves:** STORY-010

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Reduce the top 5 behavioral UX friction points identified in the audit — dashboard overload, transaction form ordering, dead mobile nav, hidden row actions, inconsistent empty states — with pure UI changes and no new features.

**Architecture:** Svelte 5 runes components on top of the existing primitives. Five self-contained changes, each behind its own commit: (1) add an `autofocus` prop to `Input`, (2) add an `EmptyState` component, (3) add a `ContextMenu` component, (4) reorder the TransactionForm, (5) consolidate navigation + refactor the dashboard. Each task is independently testable; primitives land before the views that consume them.

**Tech Stack:** SvelteKit 5 (runes), Tailwind CSS (Adding-Machine design tokens), Paraglide JS i18n (`en`+`vi`, flat underscore keys), Vitest + @testing-library/svelte for component tests, Playwright for E2E.

**Spec:** `specs/2026-07-07-ux-friction-reduction-design.md` — Phase 1 section only. Phases 2 and 3 are out of scope for this plan.

## Global Constraints

- **TDD discipline** — write the failing test first, watch it fail, implement, watch it pass. No exceptions per `CLAUDE.md`.
- **i18n is flat underscore keys** — Paraglide 1.11.8 rejects dotted IDs. New strings go in BOTH `messages/en.json` and `messages/vi.json`, then `pnpm check` regenerates `src/lib/paraglide/messages/`.
- **Svelte 5 runes only** — `$props`, `$state`, `$derived`, `$bindable`, `$effect`. No legacy stores.
- **Component test location** — `src/tests/unit/components/<Component>.test.ts`, with `// @vitest-environment jsdom` directive (matches existing tests). Snippet children via the `snip` helper at `src/tests/unit/helpers/snippet.ts`.
- **Test commands** — `pnpm test` (unit + component, runs the vitest workspace), `pnpm check` (TS + Svelte + regenerates Paraglide), `pnpm test:e2e` (Playwright).
- **Design tokens** — `--ink`, `--tape`, `--ledger`, `--dim`, `--line`, `--phosphor`, `--phosphor-bright`, `--debit` (exposed as Tailwind colors `ink`/`tape`/`ledger`/`dim`/`line`/`phosphor`/`phosphor-bright`/`debit`). Reuse `.figures`, `.figures-glow`, `.plate`, `.surface` classes.
- **Commit prefix** — `feat:`, `fix:`, `refactor:`, `test:`, `chore:`, `docs:` (per `CLAUDE.md`).
- **All tests must pass before committing** — run `pnpm test` as the pre-commit check.

---

## File Structure

**Created:**
- `src/lib/components/primitives/EmptyState.svelte` — unified empty-state recipe (glyph + message + optional action snippet).
- `src/lib/components/primitives/ContextMenu.svelte` — dropdown menu with backdrop click-to-close, snippet children.
- `src/tests/unit/components/EmptyState.test.ts` — component tests for EmptyState.
- `src/tests/unit/components/ContextMenu.test.ts` — component tests for ContextMenu.

**Modified:**
- `src/lib/components/primitives/Input.svelte` — add `autofocus` prop.
- `src/tests/unit/components/Input.test.ts` — add autofocus test.
- `src/lib/components/forms/TransactionForm.svelte` — reorder fields (amount → kind → account/tag → payee → date/description), autofocus amount.
- `src/routes/+page.svelte` (dashboard) — remove inline quick-entry section; leave frequent-transactions below the fold.
- `src/lib/components/layout/TopBar.svelte` — remove logo + hamburger; become utility bar.
- `src/routes/+layout.svelte` — verify no `onMenuToggle` reference exists (Task 5 Step 5 grep check; no code change expected).
- `src/lib/components/layout/BottomNav.svelte` — add 5th "More" slot opening a sheet with secondary items.
- `src/tests/e2e/helpers/ui.ts` — update stale comment in `addTransaction` (no longer references inline quick form).

**No new i18n keys** — all required keys (`layout_more`, `nav_accounts/goals/debts/settings`, `transactions_empty_state`, `accounts_empty_assets/liabilities`, `dashboard_no_txns_yet`, etc.) already exist in `messages/en.json` and `messages/vi.json`.

**Interfaces:**
- `EmptyState` props: `{ icon?: string = '▮▯▯▯'; message: string; action?: Snippet }`
- `ContextMenu` props: `{ label?: string; children: Snippet }` — renders a trigger button (⋮); children are rendered inside the open dropdown.
- `Input` gains `autofocus?: boolean` (default `false`).

---

### Task 1: Add `autofocus` prop to `Input`

**Files:**
- Modify: `src/lib/components/primitives/Input.svelte`
- Test: `src/tests/unit/components/Input.test.ts`

**Interfaces:**
- Produces: `Input` accepts `autofocus?: boolean`. When `true`, the rendered `<input>` has the `autofocus` attribute. Consumed by TransactionForm in Task 4.

- [x] **Step 1: Write the failing test**

Add to `src/tests/unit/components/Input.test.ts`:

```typescript
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import Input from '$lib/components/primitives/Input.svelte';

describe('Input', () => {
	// ... existing tests stay ...

	it('does not autofocus by default', () => {
		render(Input, { label: 'Amount', value: '' });
		expect(screen.getByLabelText('Amount')).not.toHaveAttribute('autofocus');
	});

	it('sets autofocus attribute when autofocus=true', () => {
		render(Input, { label: 'Amount', value: '', autofocus: true });
		expect(screen.getByLabelText('Amount')).toHaveAttribute('autofocus');
	});
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm test -- Input.test.ts`
Expected: FAIL — the two new tests fail (Input does not accept `autofocus`, so the attribute is absent).

- [x] **Step 3: Implement the `autofocus` prop**

In `src/lib/components/primitives/Input.svelte`, add `autofocus` to the destructure and the `<input>`:

```svelte
<script lang="ts">
	let { label = '', value = $bindable(''), type = 'text', placeholder = '', error = '', disabled = false, id = '', maxlength = undefined, autofocus = false }: {
		label?: string; value?: string; type?: string; placeholder?: string; error?: string; disabled?: boolean; id?: string; maxlength?: number; autofocus?: boolean;
	} = $props();

	// Auto-assign a stable id when none is provided so <label for> associates.
	const inputId = id || `input-${Math.random().toString(36).slice(2, 9)}`;
</script>

<div class="space-y-1.5">
	{#if label}
		<label for={inputId} class="plate block">{label}</label>
	{/if}
	<input
		id={inputId} {type} {placeholder} {disabled} {maxlength} {autofocus} bind:value
		class="w-full px-3 py-2 text-base rounded-md border transition-colors
			{error ? 'border-debit' : 'border-line'}
			bg-ink text-ledger placeholder:text-dim/60
			disabled:opacity-50"
	/>
	{#if error}
		<p class="text-xs text-debit">{error}</p>
	{/if}
</div>
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm test -- Input.test.ts`
Expected: PASS — both new tests pass.

- [x] **Step 5: Commit**

```bash
git add src/lib/components/primitives/Input.svelte src/tests/unit/components/Input.test.ts
git commit -m "feat(forms): add autofocus prop to Input primitive"
```

---

### Task 2: Add `EmptyState` component

**Files:**
- Create: `src/lib/components/primitives/EmptyState.svelte`
- Test: `src/tests/unit/components/EmptyState.test.ts`

**Interfaces:**
- Produces: `<EmptyState icon="▮▯▯▯" message="No data" />` — renders a centered phosphor-glow glyph + message; optional `action` snippet renders a CTA below.
- Consumes: nothing (pure presentational). Consumed by Tasks 5 and the dashboard/transactions views.

- [x] **Step 1: Write the failing test**

Create `src/tests/unit/components/EmptyState.test.ts`:

```typescript
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import EmptyState from '$lib/components/primitives/EmptyState.svelte';
import { snip } from '../helpers/snippet';

describe('EmptyState', () => {
	it('renders the message text', () => {
		render(EmptyState, { message: 'No transactions yet.' });
		expect(screen.getByText('No transactions yet.')).toBeInTheDocument();
	});

	it('renders the default glyph when no icon given', () => {
		render(EmptyState, { message: 'Empty' });
		expect(screen.getByText('▮▯▯▯')).toBeInTheDocument();
	});

	it('renders a custom icon when provided', () => {
		render(EmptyState, { message: 'Empty', icon: '◈' });
		expect(screen.getByText('◈')).toBeInTheDocument();
		expect(screen.queryByText('▮▯▯▯')).not.toBeInTheDocument();
	});

	it('renders an action snippet when provided', () => {
		render(EmptyState, { message: 'Empty', action: snip('Add one') });
		expect(screen.getByText('Add one')).toBeInTheDocument();
	});

	it('does not render an action slot when none provided', () => {
		render(EmptyState, { message: 'Empty' });
		expect(screen.queryByRole('button')).not.toBeInTheDocument();
	});

	it('uses the figures-glow class on the glyph', () => {
		render(EmptyState, { message: 'Empty' });
		expect(screen.getByText('▮▯▯▯').className).toContain('figures-glow');
	});
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm test -- EmptyState.test.ts`
Expected: FAIL — module not found (`$lib/components/primitives/EmptyState.svelte` does not exist).

- [x] **Step 3: Implement EmptyState**

Create `src/lib/components/primitives/EmptyState.svelte`:

```svelte
<script lang="ts">
	import type { Snippet } from 'svelte';
	let { icon = '▮▯▯▯', message, action }: {
		icon?: string;
		message: string;
		action?: Snippet;
	} = $props();
</script>

<div class="text-center py-12">
	<p class="figures-glow text-2xl mb-2">{icon}</p>
	<p class="text-sm text-dim">{message}</p>
	{#if action}
		<div class="mt-4">
			{@render action()}
		</div>
	{/if}
</div>
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm test -- EmptyState.test.ts`
Expected: PASS — all six tests pass.

- [x] **Step 5: Commit**

```bash
git add src/lib/components/primitives/EmptyState.svelte src/tests/unit/components/EmptyState.test.ts
git commit -m "feat(primitives): add EmptyState component for unified empty states"
```

---

### Task 3: Add `ContextMenu` component

**Files:**
- Create: `src/lib/components/primitives/ContextMenu.svelte`
- Test: `src/tests/unit/components/ContextMenu.test.ts`

**Interfaces:**
- Produces: `<ContextMenu label="Actions">...menu items...</ContextMenu>` — renders a ⋮ trigger button; clicking it opens a dropdown containing the snippet children; clicking the backdrop or pressing Escape closes it.
- Consumes: nothing. Consumed by Task 5 (transaction/accounts row actions).

- [x] **Step 1: Write the failing test**

Create `src/tests/unit/components/ContextMenu.test.ts`:

```typescript
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import ContextMenu from '$lib/components/primitives/ContextMenu.svelte';
import { snip } from '../helpers/snippet';

describe('ContextMenu', () => {
	it('renders a trigger button', () => {
		render(ContextMenu, { children: snip('Item') });
		expect(screen.getByRole('button')).toBeInTheDocument();
	});

	it('hides the menu by default', () => {
		render(ContextMenu, { children: snip('Item') });
		// children only render when the menu is open
		expect(screen.queryByText('Item')).not.toBeInTheDocument();
	});

	it('opens the menu on trigger click', async () => {
		render(ContextMenu, { children: snip('Item') });
		await fireEvent.click(screen.getByRole('button'));
		expect(screen.getByText('Item')).toBeInTheDocument();
	});

	it('closes the menu on Escape', async () => {
		const { container } = render(ContextMenu, { children: snip('Item') });
		await fireEvent.click(screen.getByRole('button'));
		expect(screen.getByText('Item')).toBeInTheDocument();
		// Escape on the open container
		await fireEvent.keyDown(container, { key: 'Escape' });
		expect(screen.queryByText('Item')).not.toBeInTheDocument();
	});

	it('closes the menu on backdrop click', async () => {
		const { container } = render(ContextMenu, { children: snip('Item') });
		await fireEvent.click(screen.getByRole('button'));
		expect(screen.getByText('Item')).toBeInTheDocument();
		const backdrop = container.querySelector('[data-testid="menu-backdrop"]');
		expect(backdrop).toBeTruthy();
		await fireEvent.click(backdrop!);
		expect(screen.queryByText('Item')).not.toBeInTheDocument();
	});

	it('uses the provided aria-label on the trigger', () => {
		render(ContextMenu, { label: 'Row actions', children: snip('Item') });
		expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'Row actions');
	});
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm test -- ContextMenu.test.ts`
Expected: FAIL — module not found.

- [x] **Step 3: Implement ContextMenu**

Create `src/lib/components/primitives/ContextMenu.svelte`:

```svelte
<script lang="ts">
	import type { Snippet } from 'svelte';
	let { label = 'Actions', children }: {
		label?: string;
		children: Snippet;
	} = $props();

	let open = $state(false);

	function toggle() { open = !open; }
	function close() { open = false; }
</script>

<div class="relative">
	<button
		onclick={toggle}
		class="p-1 text-dim hover:text-ledger"
		aria-label={label}
		aria-expanded={open}
	>
		<svg viewBox="0 0 24 24" fill="currentColor" class="w-4 h-4">
			<circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" />
		</svg>
	</button>
	{#if open}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			data-testid="menu-backdrop"
			class="fixed inset-0 z-10"
			onclick={close}
			onkeydown={(e) => e.key === 'Escape' && close()}
		></div>
		<div
			class="absolute right-0 mt-1 w-40 bg-tape border border-line rounded-md shadow-lg z-20 animate-scale-in"
			role="menu"
			tabindex="-1"
			onkeydown={(e) => e.key === 'Escape' && close()}
		>
			{@render children()}
		</div>
	{/if}
</div>
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm test -- ContextMenu.test.ts`
Expected: PASS — all six tests pass.

- [x] **Step 5: Commit**

```bash
git add src/lib/components/primitives/ContextMenu.svelte src/tests/unit/components/ContextMenu.test.ts
git commit -m "feat(primitives): add ContextMenu dropdown component"
```

---

### Task 4: Reorder TransactionForm — amount first + autofocus

**Files:**
- Modify: `src/lib/components/forms/TransactionForm.svelte`
- Test: `src/tests/unit/components/TransactionForm.test.ts` (create if absent)

**Interfaces:**
- Consumes: `Input` with `autofocus` (Task 1).
- Produces: TransactionForm renders fields in order: error → amount (autofocus) → kind toggles → account/tag (or from/to accounts for transfer) → payee → date/description → buttons. No prop change.

**Note:** This is a visual reordering; the existing save logic, validation, and draft-restore behavior are unchanged. If `src/tests/unit/components/TransactionForm.test.ts` does not exist yet, this task creates it with a render-order test.

- [x] **Step 1: Write the failing test**

Create (or add to) `src/tests/unit/components/TransactionForm.test.ts`:

```typescript
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import TransactionForm from '$lib/components/forms/TransactionForm.svelte';

// Paraglide message functions import fine under the component-test workspace
// (conditions: ['browser']). Stores hit the in-memory DB fallback only in
// Tauri/E2E; in jsdom they resolve empty, which is enough to assert field
// order without a DB.
describe('TransactionForm', () => {
	it('renders the Amount input with autofocus before the kind toggles', () => {
		render(TransactionForm, { mode: 'full' });
		const amountInput = screen.getByLabelText('Amount');
		expect(amountInput).toHaveAttribute('autofocus');
		// The kind toggle labels exist (Expense, Income, Transfer, Refund, Adjustment)
		expect(screen.getByText('Expense')).toBeInTheDocument();
	});

	it('renders Amount before the Account select', () => {
		const { container } = render(TransactionForm, { mode: 'full' });
		const amountInput = container.querySelector('input#input-') ?? screen.getByLabelText('Amount');
		const accountSelect = screen.queryByLabelText('Account');
		expect(accountSelect).toBeInTheDocument();
		// Amount appears before Account in DOM order
		expect(amountInput.compareDocumentPosition(accountSelect!))
			.toBe(Node.DOCUMENT_POSITION_FOLLOWING);
	});
});
```

> Note on the second test: `input#input-` partial-id selector is unreliable; the `?? screen.getByLabelText('Amount')` fallback makes `amountInput` resolve to the real element. The assertion uses `compareDocumentPosition` to verify DOM order without depending on IDs.

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm test -- TransactionForm.test.ts`
Expected: FAIL — Amount does not have `autofocus` (current form has kind toggles first, then a non-autofocus amount input).

- [x] **Step 3: Reorder the form markup**

In `src/lib/components/forms/TransactionForm.svelte`, replace the `<div class="space-y-4">` block (the template, lines from `<div class="space-y-4">` through the closing `</div>` before `</script>`'s scope ends) with:

```svelte
<div class="space-y-4">
	{#if error}
		<p class="text-sm text-debit">{error}</p>
	{/if}

	<!-- AMOUNT: primary input, autofocus -->
	<Input label={m.common_amount()} bind:value={amount} placeholder={m.forms_amount_placeholder()} autofocus />

	<!-- KIND: secondary toggle -->
	<div class="flex flex-wrap gap-2">
		{#each kinds as k}
			<button onclick={() => kind = k.value as TransactionKind} disabled={isEdit}
				class="px-3 py-1.5 text-sm rounded-md border transition-colors {kind === k.value ? 'border-phosphor bg-phosphor/10 text-phosphor-bright font-medium' : 'border-line text-dim hover:text-ledger'} {isEdit ? 'cursor-not-allowed opacity-60' : ''}"
			>{k.label}</button>
		{/each}
	</div>

	<!-- ACCOUNT/TAG -->
	{#if kind === 'transfer'}
		<Select label={m.forms_from_account()} bind:value={accountId} options={accountOptions} disabled={isEdit} />
		<Select label={m.forms_to_account()} bind:value={transferAccountId} options={accountOptions} disabled={isEdit} />
	{:else}
		<Select label={m.forms_account()} bind:value={accountId} options={accountOptions} disabled={isEdit} />
		<Autocomplete label={m.forms_tag()} bind:value={tagId} options={tagOptions} placeholder={m.forms_search_tags_placeholder()} />
	{/if}

	<!-- PAYEE + DATE/DESCRIPTION (full mode only) -->
	{#if mode === 'full'}
		<Autocomplete label={m.forms_payee()} bind:value={payee} options={payeeOptions} allowFreeText={true} placeholder={m.forms_who_paid()} />
		<div class="grid grid-cols-2 gap-3">
			<Input label={m.common_date()} type="date" bind:value={date} />
			<Input label={m.common_description()} bind:value={description} placeholder={m.common_optional()} maxlength={1024} />
		</div>
	{/if}

	<div class="flex justify-end gap-2 pt-2">
		<Button variant="ghost" onclick={onclose}>{m.common_cancel()}</Button>
		<Button disabled={saving || !amount} onclick={save}>{saving ? m.forms_saving() : (isEdit ? m.forms_save_changes() : m.common_save())}</Button>
	</div>
</div>
```

The `<script>` block is unchanged — only the field order and the `autofocus` attribute on the amount `Input` change.

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm test -- TransactionForm.test.ts`
Expected: PASS.

- [x] **Step 5: Run the full suite + typecheck**

Run: `pnpm test && pnpm check`
Expected: all green. `pnpm check` also regenerates Paraglide (no new keys in this task, but confirms no breakage).

- [x] **Step 6: Commit**

```bash
git add src/lib/components/forms/TransactionForm.svelte src/tests/unit/components/TransactionForm.test.ts
git commit -m "refactor(forms): reorder TransactionForm — amount first with autofocus"
```

---

### Task 5: Consolidate navigation — TopBar utility bar + BottomNav "More" sheet

**Files:**
- Modify: `src/lib/components/layout/TopBar.svelte`
- Modify: `src/lib/components/layout/BottomNav.svelte`
- Test: `src/tests/unit/components/TopBar.test.ts` (create), `src/tests/unit/components/BottomNav.test.ts` (create)

**Interfaces:**
- Consumes: nothing new. `layout_more` i18n key already exists.
- Produces:
  - `TopBar` no longer accepts `onMenuToggle`; renders only search (desktop) + language toggle. No logo.
  - `BottomNav` renders 5 slots: the 4 primary tabs + a "More" button that opens a sheet listing accounts/goals/debts/settings.

**Testing caveat:** `BottomNav` imports `$app/stores` (the SvelteKit `page` store). In jsdom, this import fails because there's no SvelteKit runtime. The test file must mock `$app/stores` before importing BottomNav. This is a framework-store mock (not a DB-store mock), so it's acceptable per the "don't mock stores" rule — that rule targets DB stores, not framework stores.

**Why no new i18n keys:** `layout_more` exists; `nav_accounts/goals/debts/settings` exist. The "More" sheet reuses them.

- [x] **Step 1: Write the failing tests**

Create `src/tests/unit/components/TopBar.test.ts`:

```typescript
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import TopBar from '$lib/components/layout/TopBar.svelte';

describe('TopBar', () => {
	it('does not render the app name/logo (lives in Sidebar)', () => {
		render(TopBar);
		expect(screen.queryByRole('link', { name: 'Notchy' })).not.toBeInTheDocument();
	});

	it('does not render a hamburger menu button', () => {
		render(TopBar);
		expect(screen.queryByLabelText('Menu')).not.toBeInTheDocument();
	});

	it('renders the language toggle', () => {
		render(TopBar);
		expect(screen.getByText('EN')).toBeInTheDocument();
	});

	it('renders a search input', () => {
		render(TopBar);
		expect(screen.getByRole('searchbox')).toBeInTheDocument();
	});
});
```

Create `src/tests/unit/components/BottomNav.test.ts`:

```typescript
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

// Mock $app/stores before importing BottomNav (SvelteKit runtime unavailable in jsdom)
vi.mock('$app/stores', () => ({
	page: { subscribe: vi.fn(() => ({ url: { pathname: '/' } })) }
}));

import BottomNav from '$lib/components/layout/BottomNav.svelte';

describe('BottomNav', () => {
	it('renders the 4 primary nav links', () => {
		render(BottomNav);
		expect(screen.getByText('Home')).toBeInTheDocument();
		expect(screen.getByText('Trans')).toBeInTheDocument();
		expect(screen.getByText('Budget')).toBeInTheDocument();
		expect(screen.getByText('Reports')).toBeInTheDocument();
	});

	it('renders a More button that opens the secondary-item sheet', async () => {
		render(BottomNav);
		const moreBtn = screen.getByText('More');
		expect(moreBtn).toBeInTheDocument();
		expect(screen.queryByText('Accounts')).not.toBeInTheDocument();
		await fireEvent.click(moreBtn);
		expect(screen.getByText('Accounts')).toBeInTheDocument();
		expect(screen.getByText('Goals')).toBeInTheDocument();
		expect(screen.getByText('Debts')).toBeInTheDocument();
		expect(screen.getByText('Settings')).toBeInTheDocument();
	});

	it('closes the More sheet when a secondary link is clicked', async () => {
		render(BottomNav);
		await fireEvent.click(screen.getByText('More'));
		await fireEvent.click(screen.getByText('Goals'));
		expect(screen.queryByRole('link', { name: 'Goals' })).not.toBeInTheDocument();
	});
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- TopBar.test.ts BottomNav.test.ts`
Expected: FAIL — TopBar still renders the logo/hamburger; BottomNav has no "More" button or sheet.

- [x] **Step 3: Refactor TopBar into a utility bar**

Replace the entire contents of `src/lib/components/layout/TopBar.svelte`:

```svelte
<script lang="ts">
	import * as m from '$lib/paraglide/messages';
</script>

<!-- Utility bar: search + language toggle only. Navigation lives in Sidebar
     (desktop) and BottomNav (mobile); the brand mark lives in the Sidebar.
     The old hamburger (onMenuToggle) was a dead button — onMenuToggle was
     never passed from +layout.svelte, and the Sidebar it revealed is
     hidden md:flex. Removed entirely; BottomNav's "More" sheet now carries
     the secondary destinations on mobile. -->
<header class="h-14 flex items-center gap-3 px-4 border-b border-line bg-tape shrink-0">
	<label class="relative block flex-1 max-w-md mx-auto">
		<span class="sr-only">{m.layout_search()}</span>
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-dim pointer-events-none"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" stroke-linecap="round" /></svg>
		<input
			type="search"
			placeholder={m.layout_search_placeholder()}
			class="w-full pl-8 pr-3 py-1.5 text-sm rounded-md border border-line bg-ink text-ledger placeholder:text-dim/70"
		/>
	</label>
	<button class="plate px-2 py-1 rounded border border-line text-dim hover:text-ledger">{m.layout_lang_label_en()}</button>
</header>
```

- [x] **Step 4: Add the "More" sheet to BottomNav**

Replace the entire contents of `src/lib/components/layout/BottomNav.svelte`:

```svelte
<script lang="ts">
	import { page } from '$app/stores';
	import * as m from '$lib/paraglide/messages';

	const tabs = [
		{ href: '/', label: m.layout_home(), d: 'M3 12h7V3H3zM14 21h7v-9h-7zM14 3v6h7V3zM3 21h7v-3H3z' },
		{ href: '/transactions', label: m.layout_trans(), d: 'M4 6h16M4 12h16M4 18h10' },
		{ href: '/budgets', label: m.layout_budget(), d: 'M3 17l5-5 4 4 8-8M21 8v5h-5' },
		{ href: '/reports', label: m.nav_reports(), d: 'M4 20V10M10 20V4M16 20v-7M22 20H2' }
	];

	const more = [
		{ href: '/accounts', label: m.nav_accounts(), d: 'M3 7h18v12H3zM3 11h18M7 15h4' },
		{ href: '/goals', label: m.nav_goals(), d: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 7v5l3 2' },
		{ href: '/debts', label: m.nav_debts(), d: 'M3 12h13M11 7l5 5-5 5M19 4v16' },
		{ href: '/settings', label: m.nav_settings(), d: 'M12 9a3 3 0 100 6 3 3 0 000-6zM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2' }
	];

	let moreOpen = $state(false);
	function toggleMore() { moreOpen = !moreOpen; }
	function closeMore() { moreOpen = false; }

	function isActive(href: string, path: string): boolean {
		return href === '/' ? path === '/' : path === href || path.startsWith(href + '/');
	}
</script>

<nav class="md:hidden fixed bottom-0 left-0 right-0 h-16 bg-tape/95 backdrop-blur border-t border-line flex z-30 pb-[env(safe-area-inset-bottom)]">
	{#each tabs as tab}
		{@const active = isActive(tab.href, $page.url.pathname)}
		<a
			href={tab.href}
			aria-current={active ? 'page' : undefined}
			class="flex-1 flex flex-col items-center justify-center gap-1 text-[10px] transition-colors
				{active ? 'text-phosphor-bright' : 'text-dim'}"
		>
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5 {active ? 'text-phosphor' : ''}">
				<path d={tab.d} />
			</svg>
			<span class="tracking-wide">{tab.label}</span>
		</a>
	{/each}

	<button
		onclick={toggleMore}
		aria-expanded={moreOpen}
		class="flex-1 flex flex-col items-center justify-center gap-1 text-[10px] {moreOpen ? 'text-phosphor-bright' : 'text-dim'}"
	>
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" class="w-5 h-5 {moreOpen ? 'text-phosphor' : ''}">
			<path d="M4 6h16M4 12h16M4 18h16" />
		</svg>
		<span class="tracking-wide">{m.layout_more()}</span>
	</button>
</nav>

{#if moreOpen}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="md:hidden fixed inset-0 z-40 bg-black/70 backdrop-blur-sm" onclick={closeMore} onkeydown={(e) => e.key === 'Escape' && closeMore()}></div>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="md:hidden fixed bottom-16 left-0 right-0 z-50 bg-tape border-t border-line rounded-t-lg p-3 animate-slide-up">
		<div class="grid grid-cols-4 gap-2">
			{#each more as item}
				{@const active = isActive(item.href, $page.url.pathname)}
				<a
					href={item.href}
					onclick={closeMore}
					class="flex flex-col items-center justify-center gap-1 py-3 text-[10px] rounded-md {active ? 'text-phosphor-bright' : 'text-dim'}"
				>
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="w-6 h-6 {active ? 'text-phosphor' : ''}">
						<path d={item.d} />
					</svg>
					<span class="tracking-wide">{item.label}</span>
				</a>
			{/each}
		</div>
	</div>
{/if}
```

- [x] **Step 5: Verify the dead-hamburger fix**

The original bug: `TopBar` accepted `onMenuToggle` but `+layout.svelte` never passed it, so the hamburger was a no-op. After this task, TopBar takes no props, so the bug is fixed by elimination.

Run: `grep -n "onMenuToggle" src/routes/+layout.svelte src/lib/components/layout/TopBar.svelte`
Expected: no matches in either file. If matches appear, remove them — TopBar no longer accepts `onMenuToggle`.

- [x] **Step 6: Run tests to verify they pass**

Run: `pnpm test -- TopBar.test.ts BottomNav.test.ts`
Expected: PASS.

- [x] **Step 7: Run full suite + typecheck**

Run: `pnpm test && pnpm check`
Expected: all green.

- [x] **Step 8: Commit**

```bash
git add src/lib/components/layout/TopBar.svelte src/lib/components/layout/BottomNav.svelte src/tests/unit/components/TopBar.test.ts src/tests/unit/components/BottomNav.test.ts
git commit -m "refactor(nav): TopBar utility bar + BottomNav More sheet for mobile secondary nav"
```

---

### Task 6: Dashboard — remove inline quick-entry; adopt EmptyState

**Files:**
- Modify: `src/routes/+page.svelte`

**Interfaces:**
- Consumes: `EmptyState` (Task 2).
- Produces: dashboard renders net position → this month → recent (with EmptyState when empty) → goals. The inline "Quick entry" `<TransactionForm mode="quick">` section is removed; the FAB (in `+layout.svelte`) remains the capture entry point.

**Why:** Per the spec, the inline quick-entry card overloaded the dashboard (Miller's Law). The FAB already opens the full modal. Frequent transactions remains below the fold (unchanged in this task — moving it into the FAB modal is a separate follow-up; YAGNI for Phase 1).

**Spec deviation note:** The spec's success criterion states the dashboard should collapse to "3 clear cards." This task removes only the inline quick-entry (1 of 6 cards), leaving 5 cards (net position, budget, frequent transactions, recent, goals). This is a partial fix — the full 3-card collapse is deferred to Phase 2 or 3. The plan documents this as YAGNI for Phase 1, but it's a known gap from the spec's stated goal.

- [x] **Step 1: Write the failing test**

This is a route component. There is no existing dashboard component test; rather than stub the DB-backed stores (which `CLAUDE.md` forbids mocking), we verify the change structurally: the dashboard no longer mounts an inline TransactionForm in "quick" mode. Add a lightweight test that asserts the markup contract — but since the dashboard pulls from stores that need a DB, we instead assert via the source: **no behavioral test; document the manual/E2E verification.**

Skip the unit test (route components are DB-bound; mocking stores is forbidden). Document verification in Step 4 instead.

- [x] **Step 2: Remove the inline quick-entry section**

In `src/routes/+page.svelte`, delete the entire QUICK ENTRY block:

```svelte
	<!-- QUICK ENTRY: the keypad. -->
	<section class="surface rounded-lg p-5">
		<h2 class="plate mb-3">{m.dashboard_quick_entry()}</h2>
		<TransactionForm mode="quick" onclose={() => {}} onsave={async () => { await transactions.load({ limit: 5 }); }} />
	</section>
```

Also remove the now-unused imports: `TransactionForm` is no longer used directly by the dashboard. Remove this import line:

```typescript
import TransactionForm from '$lib/components/forms/TransactionForm.svelte';
```

Add the `EmptyState` import:

```typescript
import EmptyState from '$lib/components/primitives/EmptyState.svelte';
```

- [x] **Step 3: Adopt EmptyState for the empty recent-txns block**

Replace the empty-state branch of the RECENT section:

Find:
```svelte
			{#if recentTxns.length === 0}
				<div class="px-5 pb-6 pt-2 text-dim">
					<p class="figures-glow text-xl mb-1">▮▯▯▯</p>
					<p class="text-sm">{m.dashboard_no_txns_yet({ shortcut: 'N' })}</p>
				</div>
			{:else}
```

Replace with:
```svelte
			{#if recentTxns.length === 0}
				<div class="px-5 pb-2">
					<EmptyState message={m.dashboard_no_txns_yet({ shortcut: 'N' })} icon="▮▯▯▯" />
				</div>
			{:else}
```

- [x] **Step 4: Update the stale E2E helper comment**

In `src/tests/e2e/helpers/ui.ts`, the `addTransaction` function has a JSDoc comment referencing "the dashboard also has an inline quick form with its own Amount/Save controls" as the reason for scoping via `getByRole('dialog')`. After Step 2, that inline form no longer exists. Update the comment to reflect reality (the dialog scoping is still good practice, but the rationale changed).

Find (in the `addTransaction` JSDoc):
```typescript
 * The modal is scoped via getByRole('dialog') because the dashboard also has an
 * inline quick form with its own Amount/Save controls.
```

Replace with:
```typescript
 * The modal is scoped via getByRole('dialog') to isolate the Amount/Save
 * controls in case other dialogs or inputs appear on the page.
```

- [x] **Step 5: Verify (typecheck + E2E smoke)**

Run: `pnpm check`
Expected: green — confirms the removed `TransactionForm` import and unused `dashboard_quick_entry` don't break compilation (unused i18n keys are fine).

Run: `pnpm test:e2e -- onboarding-dashboard`
Expected: PASS — the dashboard still renders; the FAB still opens the transaction modal. (If a dashboard E2E asserted the inline quick-entry form exists, update it to use the FAB modal instead.)

- [x] **Step 6: Commit**

```bash
git add src/routes/+page.svelte src/tests/e2e/helpers/ui.ts
git commit -m "refactor(dashboard): remove inline quick-entry, adopt EmptyState for recent list"
```

---

### Task 7: Adopt EmptyState + ContextMenu across the lists (transactions, accounts)

**Files:**
- Modify: `src/routes/transactions/+page.svelte`
- Modify: `src/routes/accounts/+page.svelte`

**Interfaces:**
- Consumes: `EmptyState` (Task 2), `ContextMenu` (Task 3).
- Produces: the transactions and accounts lists show consistent EmptyState, and expose a `ContextMenu` on each row (mobile: always visible; desktop: also visible, replacing the hover-only inline buttons for consistency).

- [x] **Step 1: Write the failing tests**

No new component tests (these are DB-bound route components; mocking is forbidden per `CLAUDE.md`). Verification is via `pnpm check` (typecheck) and the existing E2E suites (`transactions.spec.ts`, `accounts.spec.ts`), which exercise edit/delete/archive. The ContextMenu wraps the existing handlers, so behavior is preserved.

Document the expected E2E contract instead:

> Existing E2E in `src/tests/e2e/transactions.spec.ts` and `src/tests/e2e/accounts.spec.ts` clicks edit/delete buttons. After this task, those buttons live inside a `ContextMenu` dropdown. **If any E2E clicks the row actions directly, update it to open the menu first** (`fireEvent.click` on the ⋮ trigger, then click the menu item).

- [x] **Step 2: Replace transactions list empty state + row actions**

In `src/routes/transactions/+page.svelte`:

Add imports at the top of the `<script>`:
```typescript
import EmptyState from '$lib/components/primitives/EmptyState.svelte';
import ContextMenu from '$lib/components/primitives/ContextMenu.svelte';
```

Replace the empty-state block:
Find:
```svelte
		{#if displayItems.length === 0}
			<div class="text-center py-12 text-dim">
				<p class="text-3xl mb-2">📋</p>
				<p class="text-sm">{m.transactions_empty_state()}</p>
			</div>
```
Replace with:
```svelte
		{#if displayItems.length === 0}
			<EmptyState message={m.transactions_empty_state()} icon="▮▯▯▯" />
```
(keep the closing `{/if}` structure intact — only the inner block changes).

Replace the row actions block. Find:
```svelte
					<div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
						<button onclick={() => doDuplicate(tx)} class="text-xs text-dim hover:text-phosphor px-2" title={m.transactions_duplicate()}>↻</button>
						<button onclick={() => doDelete(tx)} class="text-xs text-dim hover:text-debit px-2" title={m.common_delete()}>✕</button>
					</div>
```
Replace with:
```svelte
					<ContextMenu label={m.transactions_duplicate() + ' · ' + m.common_delete()}>
						<button onclick={() => doDuplicate(tx)} class="w-full text-left px-3 py-2 text-sm text-ledger hover:bg-line/40">{m.transactions_duplicate()}</button>
						<button onclick={() => doDelete(tx)} class="w-full text-left px-3 py-2 text-sm text-debit hover:bg-line/40">{m.common_delete()}</button>
					</ContextMenu>
```

- [x] **Step 3: Replace accounts list empty states + row actions**

In `src/routes/accounts/+page.svelte`:

Add imports:
```typescript
import EmptyState from '$lib/components/primitives/EmptyState.svelte';
import ContextMenu from '$lib/components/primitives/ContextMenu.svelte';
```

Replace the two empty states. Find (assets):
```svelte
				<div class="bg-tape rounded-lg border border-line p-6 text-center text-dim">
					<p class="text-sm">{m.accounts_empty_assets()}</p>
				</div>
```
Replace with:
```svelte
				<div class="bg-tape rounded-lg border border-line">
					<EmptyState message={m.accounts_empty_assets()} icon="▮▯▯▯" />
				</div>
```
Find (liabilities):
```svelte
				<div class="bg-tape rounded-lg border border-line p-6 text-center text-dim">
					<p class="text-sm">{m.accounts_empty_liabilities()}</p>
				</div>
```
Replace with:
```svelte
				<div class="bg-tape rounded-lg border border-line">
					<EmptyState message={m.accounts_empty_liabilities()} icon="▮▯▯▯" />
				</div>
```

Replace the two row-actions blocks (assets + liabilities). The assets block has 3 buttons (Edit, Archive, Delete); the liabilities block has 2 (Edit, Delete). They differ, so each find is unique.

**Assets block** (3 buttons — Edit, Archive, Delete). Find:
```svelte
						<div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
							<button onclick={() => openEdit(acc)} class="text-xs text-dim hover:text-phosphor px-2">{m.common_edit()}</button>
							<button onclick={() => archiveAccount(acc)} class="text-xs text-dim hover:text-phosphor px-2">{m.accounts_archive()}</button>
							<button onclick={() => confirmDelete = acc} class="text-xs text-dim hover:text-debit px-2">{m.common_delete()}</button>
						</div>
```
Replace with (assets — has archive):
```svelte
						<ContextMenu label={m.common_edit()}>
							<button onclick={() => openEdit(acc)} class="w-full text-left px-3 py-2 text-sm text-ledger hover:bg-line/40">{m.common_edit()}</button>
							<button onclick={() => archiveAccount(acc)} class="w-full text-left px-3 py-2 text-sm text-ledger hover:bg-line/40">{acc.archived ? m.accounts_unarchive() : m.accounts_archive()}</button>
							<button onclick={() => confirmDelete = acc} class="w-full text-left px-3 py-2 text-sm text-debit hover:bg-line/40">{m.common_delete()}</button>
						</ContextMenu>
```
And the liabilities block (no archive):
```svelte
						<ContextMenu label={m.common_edit()}>
							<button onclick={() => openEdit(acc)} class="w-full text-left px-3 py-2 text-sm text-ledger hover:bg-line/40">{m.common_edit()}</button>
							<button onclick={() => confirmDelete = acc} class="w-full text-left px-3 py-2 text-sm text-debit hover:bg-line/40">{m.common_delete()}</button>
						</ContextMenu>
```

- [x] **Step 4: Typecheck + run E2E**

Run: `pnpm check`
Expected: green.

Run: `pnpm test:e2e -- transactions accounts`
Expected: if any E2E clicks row actions by their old inline selectors, they will now fail because actions are behind the ContextMenu. Fix the affected E2E specs to open the menu first. Pattern to apply in any failing E2E:

```typescript
// Before (old): await page.getByTitle('Delete').click();
// After: open the row's context menu, then click the menu item
await row.locator('button[aria-label*="Delete"], button[aria-label*="Edit"]').first().click();
await page.getByRole('menuitem', { name: /Delete/ }).click();
```
(Add `role="menuitem"` to the ContextMenu item buttons if needed — see Step 5.)

- [x] **Step 5: Add `role="menuitem"` to ContextMenu children (accessibility + E2E selector)**

The ContextMenu children are arbitrary buttons. For E2E selectors and a11y, the menu items should expose `role="menuitem"`. Update the `transactions` and `accounts` ContextMenu children from `<button>` to `<button role="menuitem" ...>`. Re-run `pnpm check`.

- [x] **Step 6: Run full suite**

Run: `pnpm test && pnpm test:e2e -- transactions accounts`
Expected: all green.

- [x] **Step 7: Commit**

```bash
git add src/routes/transactions/+page.svelte src/routes/accounts/+page.svelte src/tests/e2e/
git commit -m "refactor(lists): adopt EmptyState + ContextMenu in transactions and accounts"
```

---

### Task 8: Full verification + finalize

**Files:** none (verification only)

- [x] **Step 1: Run the entire test suite**

Run: `pnpm test`
Expected: all unit + component tests pass.

- [x] **Step 2: Run the full E2E suite**

Run: `pnpm test:e2e`
Expected: all E2E specs pass. Pay attention to: `transactions.spec.ts`, `transactions-extended.spec.ts`, `accounts.spec.ts`, `accounts-extended.spec.ts`, `goals*.spec.ts`, `debts*.spec.ts`, `settings*.spec.ts` (the last three navigate to secondary routes — now reachable via BottomNav "More" on mobile, but E2E runs at desktop viewport so they navigate via Sidebar, which is unchanged).

- [x] **Step 3: Run typecheck**

Run: `pnpm check`
Expected: green.

- [x] **Step 4: Manual smoke test (desktop + mobile widths)**

Run: `pnpm tauri dev`
Verify at desktop width:
- TopBar shows search + language toggle, no logo, no hamburger.
- Sidebar shows all 8 destinations.
- FAB opens the transaction modal; Amount field is autofocused.
- Transaction list rows show ⋮ menu with Duplicate/Delete.
- Empty transactions list shows phosphor glyph, not emoji.

Resize to mobile width (< 768px):
- BottomNav shows 5 slots (Home, Trans, Budget, Reports, More).
- "More" opens a sheet with Accounts, Goals, Debts, Settings.
- The dead hamburger is gone.

- [x] **Step 5: Update the spec status**

In `specs/2026-07-07-ux-friction-reduction-design.md`, change the Status line from `Design — pending implementation plan` to `Phase 1 implemented`.

```bash
git add specs/2026-07-07-ux-friction-reduction-design.md
git commit -m "docs: mark UX friction-reduction Phase 1 implemented"
```

---

## Notes for the implementer

- **Don't mock the DB or stores** (`CLAUDE.md` testing conventions). Route components (`+page.svelte`) that read from DB-backed stores are not unit-tested; they're verified by `pnpm check` + the E2E suites. New presentational primitives (`EmptyState`, `ContextMenu`, `Input.autofocus`) get component tests.
- **Run `pnpm check` after any i18n or template change** — it runs `svelte-kit sync` and regenerates Paraglide. No new i18n keys are introduced in Phase 1 (all required keys already exist), so Paraglide regeneration is a no-op but should still be run to catch breakage.
- **E2E viewport is desktop** — the BottomNav (`md:hidden`) and its "More" sheet are not exercised by existing E2E specs. The Task 5 component tests cover the sheet. Desktop navigation via Sidebar is unchanged, so existing E2E that navigates to secondary routes keeps passing.
- **The dead-hamburger bug** (`onMenuToggle` never passed) is fixed incidentally by removing the hamburger entirely. There is no `onMenuToggle` to wire up — it was always a no-op.
- **Frequent-transactions stays on the dashboard** for Phase 1. Moving it into the FAB modal is listed in the spec as a follow-up; it's deferred (YAGNI until we see whether removing inline quick-entry alone unloads the dashboard enough).
