<script lang="ts">
	import { tick } from 'svelte';
	import type { Snippet } from 'svelte';
	import Button from './Button.svelte';
	import * as m from '$lib/paraglide/messages';
	import { createFocusTrap } from '$lib/utils/focusTrap';

	let { open = $bindable(false), title = '', message = '', confirmLabel = '', danger = false, onconfirm = () => {}, onclose = () => {}, children }: {
		open?: boolean; title?: string; message?: string; confirmLabel?: string; danger?: boolean; onconfirm?: () => void; onclose?: () => void; children?: Snippet;
	} = $props();

	let panelEl = $state<HTMLElement>();
	const focusTrap = createFocusTrap();

	// Internal close path (Cancel, Esc, backdrop): the bindable `open` flips
	// locally, but with a one-way parent prop (`open={x !== null}`) the parent
	// never learns — its expression can't flip again, so the dialog can never
	// be reopened. onclose lets the parent reset its state (e.g. clear the
	// pending delete target). Confirm is NOT an internal close: it fires
	// onconfirm, whose handler resets the parent state.
	async function close() {
		open = false;
		onclose();
	}

	async function confirm() {
		open = false;
		await tick();
		onconfirm();
	}

	$effect(() => {
		if (open) return focusTrap.enter(() => panelEl);
	});

	// Escape closes; every other key is handed to the Tab trap. Both live on
	// the role="dialog" panel (svelte-check flags keydown on role-less elements).
	function onKeydown(e: KeyboardEvent) { if (e.key === 'Escape') close(); else focusTrap.trap(e, panelEl); }
</script>

{#if open}
	<div class="fixed inset-0 z-50 flex items-center justify-center p-4">
		<div class="absolute inset-0 bg-[rgb(var(--scrim-rgb)/var(--scrim-modal))] backdrop-blur-sm" onclick={close} role="presentation"></div>
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<div bind:this={panelEl} onkeydown={onKeydown} tabindex="-1" class="relative bg-tape border border-line rounded-lg shadow-2xl w-full max-w-sm p-6 space-y-4 animate-scale-in" role="dialog" aria-modal="true" aria-label={title}>
			<!-- Same faceplate voice as Modal: figures face for the title. -->
			<h2 class="figures text-lg text-ledger tracking-wide">{title}</h2>
			{#if message}
				<p class="text-sm text-dim whitespace-pre-line">{message}</p>
			{/if}
			{#if children}
				{@render children()}
			{/if}
			<div class="flex justify-end gap-2 pt-2">
				<Button variant="ghost" onclick={close}>{m.common_cancel()}</Button>
				<Button variant={danger ? 'danger' : 'primary'} onclick={confirm}>{confirmLabel || m.common_delete()}</Button>
			</div>
		</div>
	</div>
{/if}
