<script lang="ts">
	import Button from './Button.svelte';
	import * as m from '$lib/paraglide/messages';

	let { open = $bindable(false), title = '', message = '', confirmLabel = '', danger = true, onconfirm = () => {} }: {
		open?: boolean; title?: string; message?: string; confirmLabel?: string; danger?: boolean; onconfirm?: () => void;
	} = $props();

	let panelEl = $state<HTMLElement>();
	let lastFocused: HTMLElement | null = null;
	const FOCUSABLE = 'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

	function confirm() { onconfirm(); open = false; }

	$effect(() => {
		if (open) {
			lastFocused = document.activeElement as HTMLElement | null;
			const first = panelEl?.querySelector<HTMLElement>(FOCUSABLE);
			(first ?? panelEl)?.focus();
			return () => { lastFocused?.focus?.(); lastFocused = null; };
		}
	});

	// Escape closes; every other key is handed to the Tab trap. Both live on
	// the role="dialog" panel (svelte-check flags keydown on role-less elements).
	function onKeydown(e: KeyboardEvent) { if (e.key === 'Escape') open = false; else trapFocus(e); }
	function trapFocus(e: KeyboardEvent) {
		if (e.key !== 'Tab') return;
		const focusables = Array.from(panelEl?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
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
	}
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
