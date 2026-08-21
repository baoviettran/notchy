# Accessibility Pass (P1 #2/#3 + P2 #4) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring Notchy to WCAG AA on the surfaces the audit measured: light-mode amber meets 4.5:1 on every primary button/FAB/active nav; toasts are announced; dialogs manage focus; menus and comboboxes are keyboard-navigable; the locale toggle, progress bars, and mobile More sheet have accessible names.

**Architecture:** Five small, additive behavior fixes (one CSS token deepen, one live-region, three focus/keyboard rewires) plus one naming sweep. Each fix is self-contained in a component/primitives file with its own unit test; the token change is regression-guarded by an E2E contrast spec. Focus lifecycle uses Svelte 5 `$effect` (save `document.activeElement` → focus into the widget → restore on cleanup), and keyboard handlers operate on real roles already present (`[role="menuitem"]`, `role="option"`).

**Tech Stack:** SvelteKit 2 + Svelte 5, Tailwind 3.4.17, Vitest + @testing-library/svelte, Playwright (`src/tests/e2e`, against `pnpm build && pnpm preview`), Paraglide 1.11.8.

**Spec:** audit report `.impeccable/audit/2026-08-21T15-40-40Z__a11y.md` (verified source:line evidence + measured WCAG ratios).

## Global Constraints

- **TDD red-green-refactor, no exceptions** (CLAUDE.md). Write the failing test, watch it fail, implement minimum, keep green. All tests pass before committing: `pnpm test`, then the relevant E2E specs, then `pnpm test:e2e` before the final commit.
- **Paraglide 1.11.8 flat underscore keys.** New strings must be added to BOTH `messages/en.json` and `messages/vi.json` with flat underscore keys (no dots). `src/lib/paraglide/` is generated — never hand-edit; `pnpm check` regenerates it. In tests the locale resolves to `en`, so `m.common_close()` returns `"Close"` — the existing `Modal.test.ts` `{ name: 'Close' }` assertion must stay green.
- **Theme classes:** `:root` is the dark default; `html.light` is the light variant; the settings store defaults to `'light'` (`src/lib/stores/settings.svelte.ts:9`). Touch ONLY the `html.light` block in Task 1. Keep the dark `:root` values and every hex `--*` var used by inline SVG/chart/quick-add styles (`palette.ts`, chart components assert `var(--phosphor)` literally).
- **`app.css` light phosphor structure:** `html.light` already collapses `--phosphor-bright` to `--phosphor` by design (comment at `src/app.css:56-58` — "as a bare accent it sits on ink/tape … so it needs the same contrast as phosphor itself"). Task 1 preserves that structure and only deepens the shared value.
- **E2E runs against the built app** (`pnpm build && pnpm preview`, port 4173) per `playwright.config.ts`. Never assert against the dev server.
- **svelte-check a11y warnings must stay green.** Use real roles and names; do not add new `svelte-ignore`s.
- **`pnpm check` pre-existing failure:** `src/tests/e2e/fixtures/tauri-mock.ts` has a pre-existing `TestFixtureValue` type error unrelated to this plan. Its fix is NOT in scope. Each task's check step passes if no NEW errors appear on the touched files.
- **Commit discipline:** commit prefix `fix:` for Tasks 1-6, `docs:` for Task 7. Multi-line commit messages use the heredoc form (`git commit -m "$(cat <<'EOF' … EOF\n)"`) — the roadmap generator (`scripts/roadmap.mjs`) parses Form 3 and marks the plan stale otherwise. Flip each task's `- [ ]` checkboxes to `- [x]` in the same commit that lands that task's fix. End with `pnpm test:roadmap` (Task 7) to regenerate `specs/STATUS.md` — never hand-edit STATUS.md.
- **Do not break existing unit tests** for the touched components: `Modal.test.ts` (dialog/title/Close/Escape), `ContextMenu.test.ts` (open/close/backdrop/aria-label), `Autocomplete.test.ts` (free-text commit on blur, id-mode discard), `TopBar.test.ts` (`getByText('VI')`), `BottomNav.test.ts` (`getByText('More')`, sheet open/close).

---

### Task 1: Deepen light-mode phosphor to WCAG AA

**Files:**
- Modify: `src/app.css` (`html.light` block, lines 59-60 and 68-69 only)
- Create: `src/tests/e2e/light-contrast.spec.ts`

**Interfaces:**
- Consumes: the `onboardedPage` fixture (`src/tests/e2e/fixtures/onboarded.ts`), the FAB (`data-tour="add"`), the sidebar active link (`aside a[aria-current="page"]`).
- Produces: no new module interface — a token value change. Later tasks' styling must keep `light-contrast.spec.ts` green.

- [x] **Step 1: Write the failing regression spec**

Create `src/tests/e2e/light-contrast.spec.ts`:

```ts
import { test, expect } from './fixtures/onboarded';

// Regression for light-mode WCAG 1.4.3: html.light --phosphor (#B8721A)
// gave 3.35:1 on primary buttons/FAB and 3.25:1 on the active nav — both
// under 4.5. Deepening to #9A5700 must lift every amber surface to AA.
// Measures the rendered ratio the way a user sees it: text color against
// the *blended* background (bg-phosphor/10 over the parent surface).

function srgb(c: number): number {
	c /= 255;
	return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function luminance(rgb: [number, number, number]): number {
	const [r, g, b] = rgb.map(srgb);
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: [number, number, number], b: [number, number, number]): number {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
}
function parseRgb(c: string): [number, number, number] {
	const m = c.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
	if (!m) throw new Error(`unparseable color: ${c}`);
	return [+m[1], +m[2], +m[3]];
}
function parseRgba(c: string): [number, number, number, number] {
	const m = c.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?/);
	if (!m) throw new Error(`unparseable color: ${c}`);
	return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]];
}
function blendOver(fg: [number, number, number, number], bg: [number, number, number]): [number, number, number] {
	return fg.slice(0, 3).map((f, i) => f * fg[3] + bg[i] * (1 - fg[3])) as [number, number, number];
}

async function setLightTheme(page: import('@playwright/test').Page) {
	await page.evaluate(() => {
		document.documentElement.classList.add('light');
		document.documentElement.classList.remove('dark');
	});
}

test.describe('light-mode contrast meets AA', () => {
	test('FAB: text-ink on bg-phosphor ≥ 4.5:1', async ({ onboardedPage: page }) => {
		await setLightTheme(page);
		const fab = page.locator('[data-tour="add"]');
		await expect(fab).toBeVisible();
		const style = await fab.evaluate((el) => {
			const cs = getComputedStyle(el);
			return { color: cs.color, bg: cs.backgroundColor };
		});
		expect(contrast(parseRgb(style.color), parseRgb(style.bg))).toBeGreaterThanOrEqual(4.5);
	});

	test('active sidebar nav: label against the /10 tint blend ≥ 4.5:1', async ({ onboardedPage: page }) => {
		await setLightTheme(page);
		const active = page.locator('aside a[aria-current="page"]').first();
		await expect(active).toBeVisible();
		const style = await active.evaluate((el) => {
			const cs = getComputedStyle(el);
			// Walk up to the first opaque ancestor for the backdrop the 10% tint sits on.
			let over = null as string | null;
			let n = el.parentElement;
			while (n) {
				const c = getComputedStyle(n);
				const m = c.backgroundColor.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?/);
				if (m && (m[4] === undefined || m[4] === '1')) { over = `rgb(${m[1]}, ${m[2]}, ${m[3]})`; break; }
				n = n.parentElement;
			}
			return { color: cs.color, fg: cs.backgroundColor, over };
		});
		expect(style.over).not.toBeNull();
		const blended = blendOver(parseRgba(style.fg), parseRgb(style.over!));
		expect(contrast(parseRgb(style.color), blended)).toBeGreaterThanOrEqual(4.5);
	});
});
```

- [x] **Step 2: Run the spec and verify it fails**

Run: `pnpm exec playwright test src/tests/e2e/light-contrast.spec.ts`
Expected: both tests FAIL. With `--phosphor: #B8721A` the FAB measures ≈3.35:1 and the active nav ≈3.25:1 — both assertions see `toBeGreaterThanOrEqual(4.5)` fail. (First run builds the app: a few minutes.)

- [x] **Step 3: Deepen the light phosphor values**

In `src/app.css`, inside the `html.light` block only:

Line 59: `--phosphor: #B8721A;` → `--phosphor: #9A5700;`
Line 60: `--phosphor-bright: #B8721A;` → `--phosphor-bright: #9A5700;`
Line 68: `--phosphor-rgb: 184 114 26;` → `--phosphor-rgb: 154 87 0;`
Line 69: `--phosphor-bright-rgb: 184 114 26;` → `--phosphor-bright-rgb: 154 87 0;`

Do NOT touch the `:root` (dark) values, the surrounding light-mode hex vars (`--ink`, `--tape`, …), or the existing comment at lines 56-58 (it still describes the collapsed-bright design). Measured outcomes: FAB/primary buttons **4.89:1**, active nav **4.62:1**, toast action and income figures on tape **5.30:1**. Hover is a color no-op in light mode (bright == phosphor, as today) so it inherits 4.89.

- [x] **Step 4: Run the spec and verify it passes**

Run: `pnpm exec playwright test src/tests/e2e/light-contrast.spec.ts`
Expected: 2 PASS. The FAB shows text against a blended `#9A5700` background; the nav label against the 10% tint.

- [x] **Step 5: Unit tests + typecheck**

Run: `pnpm test` and `pnpm check`
Expected: all unit tests pass; the chart tests still pass (they assert `var(--phosphor)` / `var(--line)` / `var(--dim)` literally in SVG style blocks — the hex vars are untouched). `pnpm check` shows no NEW errors beyond the pre-existing `tauri-mock.ts` one.

- [x] **Step 6: Run the full E2E suite**

Run: `pnpm test:e2e`
Expected: all specs pass (this touches every screen's generated CSS, same as the opacity fix).

- [x] **Step 7: Commit**

```bash
git add src/app.css src/tests/e2e/light-contrast.spec.ts specs/plans/2026-08-21-a11y-accessibility.md
git commit -m "$(cat <<'EOF'
fix(a11y): deepen light-mode phosphor to WCAG AA on every amber surface

html.light --phosphor (#B8721A) put ink text at 3.35:1 on primary
buttons/FAB and 3.25:1 on the active nav — under the 4.5:1 AA bar in the
default light theme. Deepen both phosphor tokens (and their -rgb
triplets) to #9A5700: buttons 4.89:1, active nav 4.62:1, toast action
5.30:1. Keeps the collapsed-bright structure and dark theme untouched.
Regression spec: light-contrast.spec.ts (measures rendered contrast).
EOF
)"
```

---

### Task 2: Announce toasts via a status live region

**Files:**
- Modify: `src/lib/components/primitives/GlobalToast.svelte`
- Modify: `messages/en.json`, `messages/vi.json` (add `common_close`)
- Create: `src/tests/unit/components/GlobalToast.test.ts`

**Interfaces:**
- Consumes: the `toast` store (`src/lib/stores/toast.svelte.ts` — `toast.show(message, {action, onaction, duration})`, `toast.dismiss()`, `toast.current`).
- Produces: `role="status"` region present in the DOM even when no toast is active. No other component consumes this.

- [x] **Step 1: Write the failing unit test**

Create `src/tests/unit/components/GlobalToast.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import GlobalToast from '$lib/components/primitives/GlobalToast.svelte';
import { toast } from '$lib/stores/toast.svelte';

afterEach(() => toast.dismiss());

describe('GlobalToast', () => {
	it('exposes a polite status live region so delete/undo is announced', () => {
		toast.show('Transaction deleted.', { action: 'UNDO', duration: 5000 });
		render(GlobalToast);
		const region = screen.getByRole('status');
		expect(region).toHaveAttribute('aria-live', 'polite');
		expect(region).toHaveTextContent('Transaction deleted.');
		expect(region).toHaveTextContent('UNDO');
	});

	it('keeps the live region mounted even when no toast is active', () => {
		render(GlobalToast);
		expect(screen.getByRole('status')).toBeInTheDocument();
	});

	it('names the ✕ dismiss button (currently a bare glyph)', () => {
		toast.show('Saved.');
		render(GlobalToast);
		expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
	});
});
```

- [x] **Step 2: Run it and verify it fails**

Run: `pnpm vitest run src/tests/unit/components/GlobalToast.test.ts`
Expected: FAIL — the current GlobalToast renders no `role="status"` and its ✕ button has no accessible name.

- [x] **Step 3: Implement the live region**

Rewrite `src/lib/components/primitives/GlobalToast.svelte`:

```svelte
<script lang="ts">
	import { toast } from '$lib/stores/toast.svelte';
	import * as m from '$lib/paraglide/messages';
</script>

<!-- Persistent status region: the wrapper is always mounted so screen readers
     announce the message when it is inserted into the region (role="status" is
     implicitly aria-live="polite" + aria-atomic). -->
<div
	role="status"
	aria-live="polite"
	class="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 md:left-6 md:translate-x-0 z-50"
>
	{#if toast.current}
		<div class="bg-tape border border-line text-ledger px-4 py-3 rounded-lg shadow-md flex items-center gap-3 text-sm">
			<span>{toast.current.message}</span>
			{#if toast.current.action}
				<button
					onclick={() => { toast.current?.onaction?.(); toast.dismiss(); }}
					class="font-semibold text-phosphor hover:text-phosphor-bright uppercase text-xs shrink-0"
				>{toast.current.action}</button>
			{/if}
			<button onclick={() => toast.dismiss()} aria-label={m.common_close()} class="text-dim hover:text-ledger ml-2 text-xs">✕</button>
		</div>
	{/if}
</div>
```

Add the key to `messages/en.json` and `messages/vi.json`:

```json
"common_close": "Close"
```
```json
"common_close": "Đóng"
```

- [x] **Step 4: Run the test and verify it passes**

Run: `pnpm vitest run src/tests/unit/components/GlobalToast.test.ts`
Expected: 3 PASS.

- [x] **Step 5: Compile + typecheck**

Run: `pnpm check`
Expected: paraglide regenerates with the new key; no new errors.

- [x] **Step 6: Commit**

```bash
git add src/lib/components/primitives/GlobalToast.svelte messages/en.json messages/vi.json src/tests/unit/components/GlobalToast.test.ts specs/plans/2026-08-21-a11y-accessibility.md
git commit -m "$(cat <<'EOF'
fix(a11y): announce toasts via persistent role="status" live region

transactions.delete() shows "Transaction deleted." + UNDO with no live
region, so screen-reader users never hear the delete happened or that it
is undoable (WCAG 4.1.3). Mount the status region permanently and insert
content into it; name the bare-✕ dismiss button via common_close.
EOF
)"
```

---

### Task 3: Dialog focus management (Modal + ConfirmDialog)

**Files:**
- Create: `src/lib/utils/focusTrap.ts`
- Modify: `src/lib/components/primitives/Modal.svelte`
- Modify: `src/lib/components/primitives/ConfirmDialog.svelte`
- Create: `src/tests/unit/components/helpers/ModalProbe.svelte`
- Modify: `src/tests/unit/components/Modal.test.ts`
- Modify: `src/tests/unit/components/ConfirmDialog.test.ts`

**Interfaces:**
- Consumes: existing `Modal` props (`open`, `title`, `children`) and `ConfirmDialog` props (`open`, `title`, `message`, `confirmLabel`, `danger`, `onconfirm`). No prop signature changes.
- Produces: dialogs that move focus in on open, trap Tab, restore focus on close; `Modal`'s `<h2>` id linked via `aria-labelledby`. Later tasks reuse the same `$effect` focus-lifecycle shape.

- [x] **Step 1: Write the failing tests**

Create `src/tests/unit/components/helpers/ModalProbe.svelte` (mirrors the existing `AutocompleteBindProbe` helper pattern — `snip()` can only produce plain text, not focusable elements):

```svelte
<script lang="ts">
	import Modal from '$lib/components/primitives/Modal.svelte';
	let { open = $bindable(false) }: { open?: boolean } = $props();
</script>

<button onclick={() => (open = true)}>Open</button>
<Modal bind:open>
	<button>First</button>
	<button>Second</button>
</Modal>
```

Append to `src/tests/unit/components/Modal.test.ts`:

```ts
import ModalProbe from './helpers/ModalProbe.svelte';

it('moves focus into the dialog on open and restores it on close', async () => {
	render(ModalProbe, { open: false });
	const trigger = screen.getByRole('button', { name: 'Open' });
	trigger.focus();
	await fireEvent.click(trigger);
	const dialog = screen.getByRole('dialog');
	// children[0] is the backdrop, children[1] is the panel.
	const panel = dialog.children[1] as HTMLElement;
	expect(panel.contains(document.activeElement)).toBe(true);
	await fireEvent.keyDown(dialog, { key: 'Escape' });
	expect(trigger).toHaveFocus();
});

it('traps Tab within the dialog, wrapping at both ends', async () => {
	render(ModalProbe, { open: true });
	const dialog = screen.getByRole('dialog');
	const panel = dialog.children[1] as HTMLElement;
	const first = screen.getByRole('button', { name: 'First' });
	const last = screen.getByRole('button', { name: 'Second' });
	first.focus();
	await fireEvent.keyDown(panel, { key: 'Tab', shiftKey: true });
	expect(last).toHaveFocus();
	await fireEvent.keyDown(panel, { key: 'Tab' });
	expect(first).toHaveFocus();
});

it('associates the dialog with its title via aria-labelledby', () => {
	render(Modal, { open: true, title: 'Titled Dialog', children: snip('Body') });
	const dialog = screen.getByRole('dialog');
	const title = screen.getByText('Titled Dialog');
	expect(dialog.getAttribute('aria-labelledby')).toBe(title.id);
	expect(title.id).not.toBe('');
});
```

Append to `src/tests/unit/components/ConfirmDialog.test.ts`:

```ts
it('moves focus into the dialog on open', () => {
	render(ConfirmDialog, { open: true, title: 'Delete?', message: 'Sure?', confirmLabel: 'Delete' });
	// First focusable control is the Cancel button.
	expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
});

it('closes on Escape', async () => {
	render(ConfirmDialog, { open: true, title: 'Delete?', message: 'Sure?' });
	await fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
	expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
```

- [x] **Step 2: Run the tests and verify they fail**

Run: `pnpm vitest run src/tests/unit/components/Modal.test.ts src/tests/unit/components/ConfirmDialog.test.ts`
Expected: the new tests FAIL (focus stays on the trigger / Tab is not trapped / no `aria-labelledby` / no Escape on ConfirmDialog). Existing assertions stay green.

- [x] **Step 3: Implement Modal focus management**

The focus-in lifecycle, `FOCUSABLE` selector, and Tab trap are identical in
Modal and ConfirmDialog (and the ContextMenu task reuses the trap), so the
shared logic lives in one util. Create `src/lib/utils/focusTrap.ts`:

```ts
export const FOCUSABLE = 'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

function focusFirst(panelEl: HTMLElement | undefined, selector: string): void {
	const first = panelEl?.querySelector<HTMLElement>(selector);
	(first ?? panelEl)?.focus();
}

// Per-widget trap instance: remembers the trigger for focus restore, traps
// Tab within the panel, and returns the $effect cleanup that restores focus.
// The selector defaults to FOCUSABLE (dialogs); ContextMenu passes
// '[role="menuitem"]' (Task 4).
export function createFocusTrap(selector: string = FOCUSABLE) {
	let lastFocused: HTMLElement | null = null;
	return {
		// Handles the Tab key only; callers route Escape themselves.
		trap(e: KeyboardEvent, panelEl: HTMLElement | undefined) {
			if (e.key !== 'Tab') return;
			const focusables = Array.from(panelEl?.querySelectorAll<HTMLElement>(selector) ?? [])
				.filter((el) => {
					const style = getComputedStyle(el);
					return style.display !== 'none' && style.visibility !== 'hidden';
				});
			if (focusables.length === 0) return;
			const first = focusables[0];
			const last = focusables[focusables.length - 1];
			const active = document.activeElement as HTMLElement | null;
			if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
			else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
		},
		// Focus-in: capture the trigger, focus the first focusable (or panel).
		// Call from inside a component-level $effect when the dialog is open;
		// the returned cleanup restores focus and is what $effect runs on close.
		enter(getPanel: () => HTMLElement | undefined): () => void {
			lastFocused = document.activeElement as HTMLElement | null;
			const panelEl = getPanel();
			focusFirst(panelEl, selector);
			return () => { lastFocused?.focus?.(); lastFocused = null; };
		},
	};
}
```

Rewrite `src/lib/components/primitives/Modal.svelte`:

```svelte
<script lang="ts">
	import type { Snippet } from 'svelte';
	import * as m from '$lib/paraglide/messages';
	import { createFocusTrap } from '$lib/utils/focusTrap';

	let { open = $bindable(false), title = '', children }: {
		open?: boolean; title?: string; children: Snippet;
	} = $props();

	let panelEl = $state<HTMLElement>();
	const titleId = `modal-title-${Math.random().toString(36).slice(2, 9)}`;
	const focusTrap = createFocusTrap();

	function onBackdrop() { open = false; }
	// Escape closes; every other key is handed to the Tab trap (svelte-check
	// flags keydown on role-less elements, so both live on this role="dialog"
	// wrapper which already carries the a11y svelte-ignore).
	function onKeydown(e: KeyboardEvent) { if (e.key === 'Escape') open = false; else focusTrap.trap(e, panelEl); }

	// Focus lifecycle: capture the trigger, move focus into the dialog when it
	// opens, restore it on close. Runs after the {#if open} block paints, so
	// panelEl is bound before the effect body reads it.
	$effect(() => {
		if (open) return focusTrap.enter(() => panelEl);
	});
</script>

{#if open}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div class="fixed inset-0 z-50 flex items-center justify-center p-4" tabindex="-1" onkeydown={onKeydown} role="dialog" aria-modal="true" aria-labelledby={titleId}>
		<div class="absolute inset-0 bg-black/70 backdrop-blur-sm" onclick={onBackdrop} role="presentation"></div>
		<div bind:this={panelEl} tabindex="-1" class="relative bg-tape border border-line rounded-lg shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto animate-scale-in">
			{#if title}
				<div class="flex items-center justify-between px-6 py-4 border-b border-line">
					<h2 id={titleId} class="figures text-ledger tracking-wide">{title}</h2>
					<button onclick={() => open = false} class="text-dim hover:text-ledger p-1 -mr-1" aria-label={m.common_close()}>
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" class="w-5 h-5"><path d="M6 6l12 12M18 6L6 18" /></svg>
					</button>
				</div>
			{/if}
			<div class="p-6">
				{@render children()}
			</div>
		</div>
	</div>
{/if}
```

**Implement ConfirmDialog focus management** — edit `src/lib/components/primitives/ConfirmDialog.svelte`: consume the shared `createFocusTrap` (same `$effect` lifecycle + trap), add an Escape handler, and give the panel `tabindex="-1"`:

```svelte
<script lang="ts">
	import Button from './Button.svelte';
	import * as m from '$lib/paraglide/messages';
	import { createFocusTrap } from '$lib/utils/focusTrap';

	let { open = $bindable(false), title = '', message = '', confirmLabel = '', danger = true, onconfirm = () => {} }: {
		open?: boolean; title?: string; message?: string; confirmLabel?: string; danger?: boolean; onconfirm?: () => void;
	} = $props();

	let panelEl = $state<HTMLElement>();
	const focusTrap = createFocusTrap();

	function confirm() { onconfirm(); open = false; }

	$effect(() => {
		if (open) return focusTrap.enter(() => panelEl);
	});

	// Escape closes; every other key is handed to the Tab trap. Both live on
	// the role="dialog" panel (svelte-check flags keydown on role-less elements).
	function onKeydown(e: KeyboardEvent) { if (e.key === 'Escape') open = false; else focusTrap.trap(e, panelEl); }
</script>

{#if open}
	<div class="fixed inset-0 z-50 flex items-center justify-center p-4">
		<div class="absolute inset-0 bg-black/40 backdrop-blur-sm" onclick={() => open = false} role="presentation"></div>
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<div bind:this={panelEl} onkeydown={onKeydown} tabindex="-1" class="relative bg-tape border border-line rounded-xl shadow-xl w-full max-w-sm p-6 space-y-4 animate-scale-in" role="dialog" aria-modal="true" aria-label={title}>
			<h2 class="text-lg font-semibold text-ledger">{title}</h2>
			{#if message}
				<p class="text-sm text-dim">{message}</p>
			{/if}
			<div class="flex justify-end gap-2 pt-2">
				<Button variant="ghost" onclick={() => open = false}>{m.common_cancel()}</Button>
				<Button variant={danger ? 'danger' : 'primary'} onclick={confirm}>{confirmLabel || m.common_delete()}</Button>
			</div>
		</div>
	</div>
{/if}
```

- [x] **Step 4: Run the tests and verify they pass**

Run: `pnpm vitest run src/tests/unit/components/Modal.test.ts src/tests/unit/components/ConfirmDialog.test.ts`
Expected: all pass, including the existing "Close" / Escape / variant assertions.

- [x] **Step 5: Typecheck**

Run: `pnpm check`
Expected: no new errors.

- [x] **Step 6: Commit**

```bash
git add src/lib/utils/focusTrap.ts src/lib/components/primitives/Modal.svelte src/lib/components/primitives/ConfirmDialog.svelte src/tests/unit/components/helpers/ModalProbe.svelte src/tests/unit/components/Modal.test.ts src/tests/unit/components/ConfirmDialog.test.ts specs/plans/2026-08-21-a11y-accessibility.md
git commit -m "$(cat <<'EOF'
fix(a11y): move/trap/restore focus in Modal and ConfirmDialog

Dialogs left focus on the trigger behind the modal, let Tab escape into
background content, and never returned focus on close (WCAG 2.1.2).
Add a $effect focus lifecycle (capture activeElement, focus the panel or
first focusable, restore on close) plus a Tab trap; wire Modal's title
via aria-labelledby and i18n its close button; add Escape close to
ConfirmDialog.
EOF
)"
```

---

### Task 4: ContextMenu keyboard navigation

**Files:**
- Modify: `src/lib/utils/focusTrap.ts` (add the `selector` param, default `FOCUSABLE`)
- Modify: `src/lib/components/primitives/ContextMenu.svelte`
- Create: `src/tests/unit/components/helpers/ContextMenuProbe.svelte`
- Modify: `src/tests/unit/components/ContextMenu.test.ts`

**Interfaces:**
- Consumes: callers' `role="menuitem"` buttons (e.g. `src/routes/transactions/+page.svelte:108-111`). No caller changes.
- Produces: menu items reachable and navigable by keyboard; trigger gains `aria-haspopup="menu"`. Existing `aria-label`/`aria-expanded` behavior preserved.

- [x] **Step 1: Write the failing tests**

Create `src/tests/unit/components/helpers/ContextMenuProbe.svelte`:

```svelte
<script lang="ts">
	import ContextMenu from '$lib/components/primitives/ContextMenu.svelte';
</script>

<ContextMenu label="Row actions">
	<button role="menuitem">First</button>
	<button role="menuitem">Second</button>
	<button role="menuitem">Third</button>
</ContextMenu>
```

Append to `src/tests/unit/components/ContextMenu.test.ts`:

```ts
import ContextMenuProbe from './helpers/ContextMenuProbe.svelte';

it('moves focus to the first item when the menu opens', async () => {
	render(ContextMenuProbe);
	await fireEvent.click(screen.getByRole('button'));
	const items = screen.getAllByRole('menuitem');
	await vi.waitFor(() => expect(items[0]).toHaveFocus());
});

it('navigates items with arrow keys, wrapping at both ends', async () => {
	render(ContextMenuProbe);
	await fireEvent.click(screen.getByRole('button'));
	const [a, b, c] = screen.getAllByRole('menuitem');
	await fireEvent.keyDown(a, { key: 'ArrowDown' });
	expect(b).toHaveFocus();
	await fireEvent.keyDown(b, { key: 'ArrowDown' });
	expect(c).toHaveFocus();
	await fireEvent.keyDown(c, { key: 'ArrowDown' });
	expect(a).toHaveFocus();
	await fireEvent.keyDown(a, { key: 'ArrowUp' });
	expect(c).toHaveFocus();
});

it('returns focus to the trigger when the menu closes', async () => {
	render(ContextMenuProbe);
	const trigger = screen.getByRole('button');
	trigger.focus();
	await fireEvent.click(trigger);
	await fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
	expect(trigger).toHaveFocus();
});

it('exposes aria-haspopup on the trigger', () => {
	render(ContextMenu, { label: 'Row actions', children: snip('Item') });
	expect(screen.getByRole('button')).toHaveAttribute('aria-haspopup', 'menu');
});
```

- [x] **Step 2: Run them and verify they fail**

Run: `pnpm vitest run src/tests/unit/components/ContextMenu.test.ts`
Expected: new tests FAIL (focus never moves into the menu; arrow keys do nothing; no aria-haspopup). Existing tests stay green.

- [x] **Step 3: Implement keyboard navigation**

Rewrite `src/lib/components/primitives/ContextMenu.svelte`:

```svelte
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { createFocusTrap } from '$lib/utils/focusTrap';
	let { label = 'Actions', children }: {
		label?: string;
		children: Snippet;
	} = $props();

	let open = $state(false);
	let panelEl = $state<HTMLElement>();
	// Reuses the focus-in/restore lifecycle from focusTrap.ts (Task 3),
	// parameterized to menuitems instead of the generic FOCUSABLE selector.
	const focusTrap = createFocusTrap('[role="menuitem"]');

	function toggle() { open = !open; }
	function close() { open = false; }

	// Menu focus lifecycle: capture the trigger, focus the first item when the
	// menu opens, restore the trigger when it closes.
	$effect(() => {
		if (open) return focusTrap.enter(() => panelEl);
	});

	function onMenuKeydown(e: KeyboardEvent) {
		const items = Array.from(panelEl?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])
			.filter((el) => {
				const style = getComputedStyle(el);
				return style.display !== 'none' && style.visibility !== 'hidden';
			});
		if (items.length === 0) { if (e.key === 'Escape') close(); return; }
		const idx = items.indexOf(document.activeElement as HTMLElement);
		if (e.key === 'ArrowDown') { e.preventDefault(); items[(idx + 1) % items.length].focus(); }
		else if (e.key === 'ArrowUp') { e.preventDefault(); items[(idx - 1 + items.length) % items.length].focus(); }
		else if (e.key === 'Home') { e.preventDefault(); items[0].focus(); }
		else if (e.key === 'End') { e.preventDefault(); items[items.length - 1].focus(); }
		else if (e.key === 'Escape') { close(); }
	}
</script>

<div class="relative">
	<button
		onclick={toggle}
		class="p-1 text-dim hover:text-ledger"
		aria-label={label}
		aria-haspopup="menu"
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
			bind:this={panelEl}
			class="absolute right-0 mt-1 w-40 bg-tape border border-line rounded-md shadow-lg z-20 origin-top-right animate-scale-in"
			role="menu"
			tabindex="-1"
			onkeydown={onMenuKeydown}
			onclick={close}
		>
			{@render children()}
		</div>
	{/if}
</div>
```

- [x] **Step 4: Run the tests and verify they pass**

Run: `pnpm vitest run src/tests/unit/components/ContextMenu.test.ts`
Expected: all pass.

- [x] **Step 5: Typecheck**

Run: `pnpm check`
Expected: no new errors.

- [x] **Step 6: Commit**

```bash
git add src/lib/utils/focusTrap.ts src/lib/components/primitives/ContextMenu.svelte src/tests/unit/components/helpers/ContextMenuProbe.svelte src/tests/unit/components/ContextMenu.test.ts specs/plans/2026-08-21-a11y-accessibility.md
git commit -m "$(cat <<'EOF'
fix(a11y): keyboard navigation for ContextMenu (arrow keys + focus)

role="menu" was exposed but ArrowUp/Down/Home/End did nothing and focus
never entered the menu (WCAG 2.1.1). Focus the first menuitem on open,
cycle with arrow keys (wrapping), restore focus to the trigger on close,
and declare aria-haspopup on the trigger.
EOF
)"
```

---

### Task 5: Autocomplete keyboard selection

**Files:**
- Modify: `src/lib/components/primitives/Autocomplete.svelte`
- Modify: `src/tests/unit/components/Autocomplete.test.ts`

**Interfaces:**
- Consumes: existing props (`label`, `value`/`$bindable`, `options`, `placeholder`, `allowFreeText`, `onselect`). No signature changes.
- Produces: combobox navigable by keyboard — ArrowDown/Up (wrap), Home/End, Enter selects the highlighted option, `aria-activedescendant` on the input. Both id-mode and free-text mode.

- [x] **Step 1: Write the failing tests**

Append to `src/tests/unit/components/Autocomplete.test.ts`:

```ts
describe('keyboard selection', () => {
	it('opens and highlights the first option on ArrowDown', async () => {
		render(Autocomplete, { options: OPTS });
		const input = screen.getByRole('combobox');
		await fireEvent.keyDown(input, { key: 'ArrowDown' });
		expect(screen.getByRole('listbox')).toBeInTheDocument();
		const opts = screen.getAllByRole('option');
		await vi.waitFor(() => expect(input).toHaveAttribute('aria-activedescendant', opts[0].id));
	});

	it('selects the highlighted option with Enter', async () => {
		const onselect = vi.fn();
		render(Autocomplete, { options: OPTS, value: 'a1', onselect });
		const input = screen.getByRole('combobox');
		await fireEvent.keyDown(input, { key: 'ArrowDown' });
		await fireEvent.keyDown(input, { key: 'ArrowDown' });
		await fireEvent.keyDown(input, { key: 'Enter' });
		expect(onselect).toHaveBeenCalledWith('b2');
	});

	it('moves the highlight with ArrowUp / Home / End', async () => {
		render(Autocomplete, { options: OPTS });
		const input = screen.getByRole('combobox');
		const opts = () => screen.getAllByRole('option');
		await fireEvent.keyDown(input, { key: 'End' });
		await vi.waitFor(() => expect(input).toHaveAttribute('aria-activedescendant', opts()[1].id));
		await fireEvent.keyDown(input, { key: 'Home' });
		await vi.waitFor(() => expect(input).toHaveAttribute('aria-activedescendant', opts()[0].id));
		await fireEvent.keyDown(input, { key: 'ArrowUp' });
		await vi.waitFor(() => expect(input).toHaveAttribute('aria-activedescendant', opts()[1].id));
	});

	it('dismisses the listbox on Escape', async () => {
		render(Autocomplete, { options: OPTS });
		const input = screen.getByRole('combobox');
		await fireEvent.keyDown(input, { key: 'ArrowDown' });
		expect(screen.getByRole('listbox')).toBeInTheDocument();
		await fireEvent.keyDown(input, { key: 'Escape' });
		expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
	});

	it('moves to the last option on ArrowUp from a closed list', async () => {
		render(Autocomplete, { options: OPTS });
		const input = screen.getByRole('combobox');
		await fireEvent.keyDown(input, { key: 'ArrowUp' });
		const opts = screen.getAllByRole('option');
		await vi.waitFor(() => expect(input).toHaveAttribute('aria-activedescendant', opts[1].id));
	});
});
```

- [x] **Step 2: Run them and verify they fail**

Run: `pnpm vitest run src/tests/unit/components/Autocomplete.test.ts`
Expected: the new tests FAIL (arrow keys do nothing today; no `aria-activedescendant`; Enter has no handler). Existing tests (free-text blur commit, id-mode discard) stay green.

- [x] **Step 3: Implement keyboard selection**

Edit `src/lib/components/primitives/Autocomplete.svelte`:

Add state and helpers after the `inputId` const:

```ts
	let activeIndex = $state(-1);
	const optionId = (i: number) => `${listboxId}-opt-${i}`;

	function moveActive(delta: number) {
		if (filtered.length === 0) return;
		open = true;
		// First press from a closed/unhighlighted list: ArrowDown → first,
		// ArrowUp → last (WAI-ARIA combobox pattern). The naive modulo from
		// -1 would map ArrowUp to N-2.
		if (activeIndex < 0) activeIndex = delta < 0 ? filtered.length - 1 : 0;
		else activeIndex = (activeIndex + delta + filtered.length) % filtered.length;
	}
```

Replace `onKeydown`:

```ts
	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') { open = false; inputEl?.blur(); activeIndex = -1; }
		else if (e.key === 'ArrowDown') { e.preventDefault(); moveActive(1); }
		else if (e.key === 'ArrowUp') { e.preventDefault(); moveActive(-1); }
		else if (e.key === 'Home') { e.preventDefault(); open = true; activeIndex = 0; }
		else if (e.key === 'End') { e.preventDefault(); open = true; activeIndex = filtered.length - 1; }
		else if (e.key === 'Enter') {
			if (open && activeIndex >= 0 && filtered[activeIndex]) {
				e.preventDefault();
				select(filtered[activeIndex]);
			}
		}
	}
```

Update `onFocus` and `onInput` to reset the highlight, and `select` to clear it:

```ts
	function onFocus() { open = true; query = ''; activeIndex = -1; }
	function onInput(e: Event) {
		const v = (e.target as HTMLInputElement).value;
		if (allowFreeText) {
			value = v;
		} else {
			query = v;
		}
		open = true;
		activeIndex = -1;
	}

	function select(opt: { value: string; label: string }) {
		value = opt.value;
		query = '';
		open = false;
		activeIndex = -1;
		onselect(opt.value);
	}
```

Add `aria-activedescendant` to the input:

```svelte
		role="combobox"
		aria-expanded={open}
		aria-controls={listboxId}
		aria-activedescendant={open && activeIndex >= 0 ? optionId(activeIndex) : undefined}
		autocomplete="off"
```

Give each option an id, a highlight when active, and a mouse-enter sync:

```svelte
			{#each filtered as opt, i}
				<li>
					<button
						type="button"
						id={optionId(i)}
						onmousedown={() => select(opt)}
						onmouseenter={() => { activeIndex = i; }}
						class="w-full text-left px-3 py-2 text-sm transition-colors hover:bg-line/40 {i === activeIndex ? 'bg-line/40' : ''} {opt.value === value ? 'text-phosphor font-medium' : 'text-ledger'}"
						role="option"
						aria-selected={opt.value === value}
					>{opt.label}</button>
				</li>
			{/each}
```

- [x] **Step 4: Run the tests and verify they pass**

Run: `pnpm vitest run src/tests/unit/components/Autocomplete.test.ts`
Expected: all pass, including the pre-existing blur-commit and id-discard tests.

- [x] **Step 5: Typecheck**

Run: `pnpm check`
Expected: no new errors.

- [x] **Step 6: Commit**

```bash
git add src/lib/components/primitives/Autocomplete.svelte src/tests/unit/components/Autocomplete.test.ts specs/plans/2026-08-21-a11y-accessibility.md
git commit -m "$(cat <<'EOF'
fix(a11y): keyboard selection for the Autocomplete combobox

role="combobox" existed but only Escape was handled — options were
mouse-only (WCAG 2.1.1). Add ArrowUp/Down (wrap), Home/End, and Enter to
select the highlighted option; expose aria-activedescendant and sync the
highlight on mouse-enter. Works in both id-mode and free-text mode.
EOF
)"
```

---

### Task 6: aria-labels — locale toggle, progress bars, mobile More sheet

**Files:**
- Modify: `src/lib/components/layout/TopBar.svelte`
- Modify: `src/lib/components/primitives/Progress.svelte`
- Modify: `src/lib/components/layout/BottomNav.svelte`
- Modify: `src/routes/+page.svelte` (dashboard — budget meter line ~92, empty-budget skeleton line ~104, goal row line ~155)
- Modify: `src/routes/budgets/+page.svelte` (line 132)
- Modify: `src/routes/goals/+page.svelte` (line 78)
- Modify: `messages/en.json`, `messages/vi.json` (add `layout_lang_toggle_en` / `layout_lang_toggle_vi`)
- Create: `src/tests/unit/components/Progress.test.ts`
- Modify: `src/tests/unit/components/TopBar.test.ts`
- Modify: `src/tests/unit/components/BottomNav.test.ts`

**Interfaces:**
- Consumes: `settings.locale` (`'en' | 'vi'`), `budgetableBuckets`/`bucket.name` in the budgets page, `goals`/`g.name` on dashboard + goals pages, `m.layout_budget()`.
- Produces: `Progress` gains a new optional prop `label?: string` (rendered as `aria-label`); callers pass names. TopBar locale button gains `aria-label`. BottomNav More sheet becomes a named dialog with an expanded trigger + focus move/restore.

- [x] **Step 1: Write the failing tests**

Create `src/tests/unit/components/Progress.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import Progress from '$lib/components/primitives/Progress.svelte';

describe('Progress', () => {
	it('exposes progressbar semantics with a value', () => {
		render(Progress, { value: 40, max: 100 });
		const bar = screen.getByRole('progressbar');
		expect(bar).toHaveAttribute('aria-valuenow', '40');
		expect(bar).toHaveAttribute('aria-valuemin', '0');
		expect(bar).toHaveAttribute('aria-valuemax', '100');
	});

	it('uses the provided label as its accessible name', () => {
		render(Progress, { value: 40, max: 100, label: 'Groceries' });
		expect(screen.getByRole('progressbar', { name: 'Groceries' })).toBeInTheDocument();
	});
});
```

Append to `src/tests/unit/components/TopBar.test.ts`:

```ts
it('names the locale toggle for screen readers', () => {
	render(TopBar);
	// Default locale is en, so the toggle announces its target: Vietnamese.
	expect(screen.getByRole('button', { name: 'Switch to Vietnamese' })).toBeInTheDocument();
});
```

Append to `src/tests/unit/components/BottomNav.test.ts`:

```ts
it('exposes the More sheet as a labeled dialog with an expanded trigger', async () => {
	render(BottomNav);
	const more = screen.getByRole('button', { name: 'More' });
	expect(more).toHaveAttribute('aria-expanded', 'false');
	await fireEvent.click(more);
	expect(more).toHaveAttribute('aria-expanded', 'true');
	expect(screen.getByRole('dialog', { name: 'More' })).toBeInTheDocument();
});

it('moves focus to the first sheet link when it opens', async () => {
	render(BottomNav);
	await fireEvent.click(screen.getByRole('button', { name: 'More' }));
	// First sheet item is Accounts; the nav bar's own links precede the sheet
	// in DOM order, so address it by name rather than index.
	expect(screen.getByRole('link', { name: 'Accounts' })).toHaveFocus();
});
```

- [x] **Step 2: Run them and verify they fail**

Run: `pnpm vitest run src/tests/unit/components/Progress.test.ts src/tests/unit/components/TopBar.test.ts src/tests/unit/components/BottomNav.test.ts`
Expected: new tests FAIL (no `aria-label` on Progress; locale button unnamed; More sheet anonymous with no expanded state; focus stays on the trigger). Existing TopBar/BottomNav assertions stay green.

- [x] **Step 3: Implement**

**TopBar.svelte** — add `aria-label` to the locale button:

```svelte
	<button
		onclick={() => settings.setLocale(settings.locale === 'en' ? 'vi' : 'en')}
		aria-label={settings.locale === 'en' ? m.layout_lang_toggle_en() : m.layout_lang_toggle_vi()}
		class="plate px-2 py-1 rounded border border-line text-dim hover:text-ledger"
	>
		{settings.locale === 'en' ? 'VI' : 'EN'}
	</button>
```

**messages/en.json** (add alongside the existing `layout_lang_label_en`):

```json
"layout_lang_toggle_en": "Switch to Vietnamese",
"layout_lang_toggle_vi": "Switch to English"
```

**messages/vi.json**:

```json
"layout_lang_toggle_en": "Chuyển sang tiếng Việt",
"layout_lang_toggle_vi": "Chuyển sang tiếng Anh"
```

**Progress.svelte** — add the `label` prop and wire it:

```svelte
	let { value = 0, max = 100, size = 'md', segments = 20, label = '' }: {
		value?: number; max?: number; size?: 'sm' | 'md'; segments?: number; label?: string;
	} = $props();
```

```svelte
	<div
		class="w-full {heights[size]} flex gap-[2px] p-[2px] rounded-sm border border-line bg-ink overflow-hidden"
		role="progressbar"
		aria-label={label || undefined}
		aria-valuenow={Math.round(pct)}
		aria-valuemin={0}
		aria-valuemax={100}
	>
```

**Callers — pass names** (the routes already `import * as m from '$lib/paraglide/messages'`):

- `src/routes/budgets/+page.svelte:132` → `<Progress value={pct} max={100} size="sm" label={bucket.name} />`
- `src/routes/+page.svelte:92` → `<Progress value={budgetPct} max={100} label={m.layout_budget()} />`
- `src/routes/+page.svelte:104` (empty-budget skeleton) → `<Progress value={0} max={100} label={m.layout_budget()} />`
- `src/routes/+page.svelte:155` → `<Progress value={g.progress_pct} max={100} size="sm" segments={16} label={g.name} />`
- `src/routes/goals/+page.svelte:78` → `<Progress value={g.progress_pct} max={100} size="sm" label={g.name} />`

**BottomNav.svelte** — name the sheet, expose the trigger state, move/restore focus:

```svelte
	let moreOpen = $state(false);
	let sheetEl = $state<HTMLElement | null>(null);
	let lastFocused: HTMLElement | null = null;

	function toggleMore() {
		moreOpen = !moreOpen;
	}

	function closeMore() {
		moreOpen = false;
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			closeMore();
		}
	}

	$effect(() => {
		if (moreOpen) {
			lastFocused = document.activeElement as HTMLElement | null;
			sheetEl?.querySelector<HTMLElement>('a')?.focus();
			return () => { lastFocused?.focus?.(); lastFocused = null; };
		}
	});
```

More trigger:

```svelte
	<button
		onclick={toggleMore}
		aria-expanded={moreOpen}
		aria-haspopup="dialog"
		class="flex-1 flex flex-col items-center justify-center gap-1 text-[10px] transition-colors {moreOpen ? 'text-phosphor-bright' : 'text-dim'}"
	>
```

Sheet:

```svelte
	<div
		bind:this={sheetEl}
		role="dialog"
		aria-label={m.layout_more()}
		class="md:hidden fixed bottom-16 left-0 right-0 bg-tape border-t border-line rounded-t-lg p-4 z-50"
		transition:slideUp
	>
```

- [x] **Step 4: Run the tests and verify they pass**

Run: `pnpm vitest run src/tests/unit/components/Progress.test.ts src/tests/unit/components/TopBar.test.ts src/tests/unit/components/BottomNav.test.ts`
Expected: all pass. Note the existing BottomNav test `screen.getByText('More')` still matches (the trigger's name is unchanged).

- [x] **Step 5: Typecheck + compile paraglide**

Run: `pnpm check`
Expected: paraglide regenerates with the two new keys; no new errors.

- [x] **Step 6: Commit**

```bash
git add src/lib/components/layout/TopBar.svelte src/lib/components/primitives/Progress.svelte src/lib/components/layout/BottomNav.svelte src/routes/+page.svelte src/routes/budgets/+page.svelte src/routes/goals/+page.svelte messages/en.json messages/vi.json src/tests/unit/components/Progress.test.ts src/tests/unit/components/TopBar.test.ts src/tests/unit/components/BottomNav.test.ts specs/plans/2026-08-21-a11y-accessibility.md
git commit -m "$(cat <<'EOF'
fix(a11y): accessible names for locale toggle, progress bars, More sheet

The VI/EN toggle announced an opaque abbreviation; every progressbar was
anonymous; the mobile More sheet was an unnamed div (WCAG 4.1.2). Add
i18n aria-labels (layout_lang_toggle_en/vi), a label prop on Progress
fed by the budgets/goals/dashboard callers, and a labeled dialog role on
the More sheet with an aria-expanded trigger and focus move/restore.
EOF
)"
```

---

### Task 7: Full verification + roadmap regeneration

**Files:**
- Modify: `specs/plans/2026-08-21-a11y-accessibility.md` (flip any remaining checkboxes)
- Regenerate: `specs/STATUS.md` via `pnpm test:roadmap` (never hand-edit)

**Interfaces:** none — verification only.

- [ ] **Step 1: Full unit suite**

Run: `pnpm test`
Expected: all unit tests green.

- [ ] **Step 2: Full E2E suite**

Run: `pnpm test:e2e`
Expected: all specs green (retries absorb the known in-memory-DB worker flakiness).

- [ ] **Step 3: Typecheck**

Run: `pnpm check`
Expected: no errors beyond the pre-existing `tauri-mock.ts` one.

- [ ] **Step 4: Regenerate the roadmap**

Run: `pnpm test:roadmap`
Expected: the a11y plan reports `implemented 1/1` and `specs/STATUS.md` refreshes. If it prints `⚠ stale`, check that every task's commit block used the heredoc form and every checkbox is `[x]`.

- [ ] **Step 5: Commit**

```bash
git add specs/plans/2026-08-21-a11y-accessibility.md specs/STATUS.md
git commit -m "$(cat <<'EOF'
docs: regenerate roadmap rollup after a11y accessibility pass

Mark the accessibility plan (light contrast, toast live region, dialog
focus, menu + combobox keyboard nav, aria-labels) implemented 1/1.
EOF
)"
```
