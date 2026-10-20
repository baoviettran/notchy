<script lang="ts">
	import { goto } from '$app/navigation';
	import type { ProfileSnapshot } from '$lib/profiles/types';
	import { profiles } from '$lib/stores/profiles.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { profileDialog } from './controller.svelte';
	import * as m from '$lib/paraglide/messages';
	import { mapError } from '$lib/utils/errors';

	let {
		snapshot = profiles.snapshot,
		onopen = async (id: string) => { await profiles.switchTo(id); await goto(settings.firstRunComplete ? '/' : '/onboarding'); },
		compact = false
	}: {
		snapshot?: ProfileSnapshot | null;
		onopen?: (id: string) => Promise<unknown>;
		compact?: boolean;
	} = $props();
	let expanded = $state(false);
	let opening = $state(false);
	let openError = $state<string | null>(null);
	let root: HTMLElement;
	const menuId = `profile-switcher-${Math.random().toString(36).slice(2, 9)}`;
	const active = $derived(snapshot?.profiles.find((record) => record.id === snapshot.active?.profileId));
	async function choose(id: string) {
		if (opening) return;
		if (id === snapshot?.active?.profileId) { expanded = false; return; }
		opening = true;
		openError = null;
		try { await onopen(id); expanded = false; }
		catch (error) { openError = mapError(error); }
		finally { opening = false; }
	}
	function onKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape' && expanded) { expanded = false; event.stopPropagation(); }
	}
	function onFocusOut(event: FocusEvent) {
		if (!root.contains(event.relatedTarget as Node | null)) expanded = false;
	}
</script>

<div bind:this={root} class="relative" onkeydown={onKeydown} onfocusout={onFocusOut} role="presentation">
	<button type="button" aria-label={`${m.profiles_switcher_label()} ${active?.name ?? m.profiles_unselected()}`} aria-expanded={expanded} aria-controls={menuId} onclick={() => expanded = !expanded} class="w-full flex items-center justify-between gap-2 rounded-md border border-line bg-ink px-3 py-2 text-left text-sm text-ledger hover:border-dim focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-phosphor">
		<span class="min-w-0 truncate">{active?.name ?? m.profiles_unselected()}</span>
		<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true" class="w-4 h-4 shrink-0 text-dim"><path d="m3 6 5 5 5-5" /></svg>
	</button>
	{#if expanded}
		<div id={menuId} class="absolute z-40 mt-1 min-w-56 max-w-[min(22rem,calc(100vw-2rem))] {compact ? 'right-0' : 'left-0'} rounded-lg border border-line bg-tape p-1 shadow-xl">
			<ul class="max-h-64 overflow-y-auto py-1" aria-label={m.profiles_title()}>
				{#each snapshot?.profiles ?? [] as record (record.id)}
					<li>
						<button type="button" disabled={opening} onclick={() => void choose(record.id)} aria-current={record.id === snapshot?.active?.profileId ? 'true' : undefined} class="w-full flex items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm text-ledger hover:bg-line/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-phosphor disabled:opacity-40">
							<span class="truncate">{record.name}</span><span class="figures text-xs text-dim">{record.id.slice(0, 5)}</span>
						</button>
					</li>
				{/each}
			</ul>
			{#if openError}<p role="alert" class="px-2 py-1 text-xs text-debit">{openError}</p>{/if}
			<div class="border-t border-line p-1 space-y-0.5">
				<button type="button" onclick={() => { expanded = false; profileDialog.open('create'); }} class="w-full rounded-md px-2 py-2 text-left text-sm text-dim hover:bg-line/40 hover:text-ledger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-phosphor">{m.profiles_create()}</button>
				<button type="button" onclick={() => { expanded = false; profileDialog.open('restore'); }} class="w-full rounded-md px-2 py-2 text-left text-sm text-dim hover:bg-line/40 hover:text-ledger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-phosphor">{m.profiles_restore()}</button>
				<a href="/settings/profiles" class="block rounded-md px-2 py-2 text-sm text-dim hover:bg-line/40 hover:text-ledger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-phosphor">{m.profiles_manage()}</a>
			</div>
		</div>
	{/if}
</div>
