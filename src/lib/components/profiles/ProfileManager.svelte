<script lang="ts">
	import type { ProfileSnapshot, ProfileRecord } from '$lib/profiles/types';
	import { profiles } from '$lib/stores/profiles.svelte';
	import { profileDialog } from './controller.svelte';
	import * as m from '$lib/paraglide/messages';
	import { settings } from '$lib/stores/settings.svelte';
	import { goto } from '$app/navigation';
	import Button from '$lib/components/primitives/Button.svelte';
	import { mapError } from '$lib/utils/errors';

	let {
		mode = 'manage', snapshot: suppliedSnapshot = undefined,
		onopen = async (id: string) => { await profiles.switchTo(id); await goto(settings.firstRunComplete ? '/' : '/onboarding'); },
		onaction = (action: 'create' | 'restore' | 'rename' | 'backup' | 'reset' | 'delete', target?: ProfileRecord) => profileDialog.open(action, target)
	}: {
		mode?: 'picker' | 'manage';
		snapshot?: ProfileSnapshot | null;
		onopen?: (id: string) => unknown;
		onaction?: (action: 'create' | 'restore' | 'rename' | 'backup' | 'reset' | 'delete', target?: ProfileRecord) => unknown;
	} = $props();
	let snapshot = $derived(suppliedSnapshot === undefined ? profiles.snapshot : suppliedSnapshot);

	const shortId = (id: string) => id.slice(0, 5);
	const created = (value: string) => new Intl.DateTimeFormat(settings.locale, { dateStyle: 'medium' }).format(new Date(value));
	let opening = $state<string | null>(null);
	let openError = $state<string | null>(null);
	async function openProfile(id: string) {
		if (opening) return;
		opening = id;
		openError = null;
		try { await onopen(id); }
		catch (error) { openError = mapError(error); }
		finally { opening = null; }
	}
</script>

<section class="space-y-6" aria-label={mode === 'picker' ? m.profiles_picker_title() : m.profiles_title()}>
	<div class="flex flex-wrap items-start justify-between gap-4">
		<div class="space-y-1">
			<h1 class="page-title">{mode === 'picker' ? m.profiles_picker_title() : m.profiles_title()}</h1>
			{#if mode === 'picker'}<p class="text-sm text-dim max-w-prose">{m.profiles_picker_desc()}</p>{/if}
		</div>
		<div class="flex flex-wrap gap-2">
			<Button onclick={() => onaction('create')}>{m.profiles_create()}</Button>
			<Button variant="secondary" onclick={() => onaction('restore')}>{m.profiles_restore()}</Button>
		</div>
	</div>

	{#if openError}<p role="alert" class="text-sm text-debit">{openError}</p>{/if}
	{#if !snapshot || snapshot.profiles.length === 0}
		<div class="surface rounded-lg p-6 text-dim">{m.profiles_empty()}</div>
	{:else}
		<ul class="divide-y divide-line border-y border-line" aria-label={m.profiles_title()}>
			{#each snapshot.profiles as record (record.id)}
				<li class="py-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					<div class="min-w-0 space-y-1">
						<div class="flex flex-wrap items-baseline gap-2">
							<h2 class="font-medium text-ledger break-words">{record.name}</h2>
							{#if snapshot.active?.profileId === record.id}<span class="plate text-phosphor">{m.profiles_active()}</span>{/if}
						</div>
						<p class="text-xs text-dim"><span>{m.profiles_created()} {created(record.createdAt)}</span><span class="mx-2" aria-hidden="true">·</span><span class="figures">{shortId(record.id)}</span></p>
					</div>
					<div class="flex flex-wrap gap-1 sm:justify-end">
						{#if snapshot.active?.profileId !== record.id}
							<button type="button" disabled={opening !== null || profiles.busy} onclick={() => void openProfile(record.id)} aria-label={`${m.profiles_open()} ${record.name} ${shortId(record.id)}`} class="px-3 py-2 rounded-md text-sm text-phosphor hover:bg-phosphor/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-phosphor disabled:opacity-40">{m.profiles_open()}</button>
						{/if}
						{#if mode === 'manage'}
							<button type="button" onclick={() => onaction('rename', record)} aria-label={`${m.profiles_rename()} ${record.name} ${shortId(record.id)}`} class="px-3 py-2 rounded-md text-sm text-dim hover:text-ledger hover:bg-line/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-phosphor">{m.profiles_rename()}</button>
							<button type="button" onclick={() => onaction('backup', record)} aria-label={`${m.profiles_backup()} ${record.name} ${shortId(record.id)}`} class="px-3 py-2 rounded-md text-sm text-dim hover:text-ledger hover:bg-line/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-phosphor">{m.profiles_backup()}</button>
							<button type="button" onclick={() => onaction('reset', record)} aria-label={`${m.profiles_reset()} ${record.name} ${shortId(record.id)}`} class="px-3 py-2 rounded-md text-sm text-dim hover:text-ledger hover:bg-line/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-phosphor">{m.profiles_reset()}</button>
							<button type="button" onclick={() => onaction('delete', record)} aria-label={`${m.profiles_delete()} ${record.name} ${shortId(record.id)}`} class="px-3 py-2 rounded-md text-sm text-debit hover:bg-debit/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-phosphor">{m.profiles_delete()}</button>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</section>
