<script lang="ts">
	import { open as openFile, save as saveFile } from '@tauri-apps/plugin-dialog';
	import { goto } from '$app/navigation';
	import { profileDialog } from './controller.svelte';
	import { profiles } from '$lib/stores/profiles.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { createFocusTrap } from '$lib/utils/focusTrap';
	import { mapError } from '$lib/utils/errors';
	import type { DeleteResult, ProfileRecord, ProfileSession, RestorePreview } from '$lib/profiles/types';
	import * as m from '$lib/paraglide/messages';
	import Button from '$lib/components/primitives/Button.svelte';

	type Actions = {
		createAndOpen(name: string): Promise<unknown>;
		rename(id: string, name: string): Promise<unknown>;
		reset(id: string): Promise<unknown>;
		remove(id: string, exportPath: string | null): Promise<DeleteResult>;
		restore(token: string, name: string): Promise<ProfileRecord>;
		switchTo(id: string): Promise<ProfileSession | unknown>;
		inspectRestore(path: string): Promise<RestorePreview>;
		cancelRestore(token: string): Promise<void>;
		backup?(id: string): Promise<string>;
		exportBackup?(id: string, path: string): Promise<void>;
	};
	let {
		actions = profiles,
		chooseSourcePath = async () => {
			const path = await openFile({ multiple: false, filters: [{ name: 'SQLite', extensions: ['db', 'sqlite', 'sqlite3'] }] });
			return typeof path === 'string' ? path : null;
		},
		chooseSavePath = async () => await saveFile({ defaultPath: 'notchy-backup.sqlite' })
	}: {
		actions?: Actions;
		chooseSourcePath?: () => Promise<string | null>;
		chooseSavePath?: () => Promise<string | null>;
	} = $props();

	let panelEl = $state<HTMLElement>();
	let name = $state('');
	let preview = $state<RestorePreview | null>(null);
	let busy = $state(false);
	let failure = $state<unknown>(null);
	let exportFirst = $state(true);
	let backupSaved = $state(false);
	const focusTrap = createFocusTrap();
	const nameLength = $derived(Array.from(name.trim()).length);
	const validName = $derived(nameLength >= 1 && nameLength <= 80 && !/[\u0000-\u001f\u007f]/u.test(name));
	const L = $derived.by(() => {
		settings.locale;
		return {
			create: m.profiles_create(), rename: m.profiles_rename(), backup: m.profiles_backup(),
			restore: m.profiles_restore(), reset: m.profiles_reset(), delete: m.profiles_delete(),
			name: m.profiles_name(), nameHint: m.profiles_name_hint(),
			nameRequired: m.profiles_name_required(), nameTooLong: m.profiles_name_too_long(),
			resetWarning: m.profiles_reset_warning(), deleteWarning: m.profiles_delete_warning(),
			exportFirst: m.profiles_export_first(), deleteWithoutExport: m.profiles_delete_without_export(),
			chooseFile: m.profiles_choose_file(), preview: m.profiles_restore_preview(),
			restoreNew: m.profiles_restore_new(), restoreSuccess: m.profiles_restore_success(),
			openRestored: m.profiles_open_restored(), export: m.profiles_export(),
			backupSaved: m.profiles_backup_saved(), cleanupPending: m.profiles_cleanup_pending(),
			deleted: m.profiles_deleted(), resetDone: m.profiles_reset_done(),
			working: m.profiles_working(), cancel: m.profiles_cancel(), close: m.profiles_close(),
			fallbackError: m.profiles_action_failed(), waitingWindows: m.profiles_waiting_windows()
		};
	});
	const title = $derived(profileDialog.mode === 'restore-success' ? L.restore : profileDialog.mode ? L[profileDialog.mode] : '');
	const errorText = $derived(failure ? mapError(failure) : null);

	$effect(() => {
		const mode = profileDialog.mode;
		const target = profileDialog.target;
		name = mode === 'rename' ? target?.name ?? '' : '';
		preview = null;
		failure = null;
		exportFirst = true;
		backupSaved = false;
	});
	$effect(() => { if (profileDialog.mode) return focusTrap.enter(() => panelEl); });

	async function close() {
		if (busy && profiles.pendingTransition) { await profiles.cancelPendingTransition(); return; }
		if (busy) return;
		if (preview && profileDialog.mode === 'restore') {
			try { await actions.cancelRestore(preview.token); }
			catch (error) { failure = error; return; }
		}
		profileDialog.close();
	}
	function onKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') { event.preventDefault(); void close(); }
		else focusTrap.trap(event, panelEl);
	}
	async function chooseBackup() {
		if (busy) return;
		failure = null;
		busy = true;
		try {
			const path = await chooseSourcePath();
			if (!path) return;
			if (preview) { await actions.cancelRestore(preview.token); preview = null; }
			preview = await actions.inspectRestore(path);
			name = preview.suggestedName;
		} catch (error) { failure = error; }
		finally { busy = false; }
	}
	async function submit() {
		if (busy || !profileDialog.mode) return;
		const mode = profileDialog.mode;
		const target = profileDialog.target;
		if ((mode === 'create' || mode === 'rename' || mode === 'restore') && !validName) return;
		failure = null;
		busy = true;
		try {
			if (mode === 'create') { await actions.createAndOpen(name.trim()); profileDialog.close(); await goto(settings.firstRunComplete ? '/' : '/onboarding'); }
			else if (mode === 'rename' && target) { await actions.rename(target.id, name.trim()); profileDialog.close(); }
			else if (mode === 'reset' && target) { await actions.reset(target.id); toast.show(L.resetDone); profileDialog.close(); if (profiles.snapshot?.active?.profileId === target.id) await goto('/onboarding'); }
			else if (mode === 'delete' && target) {
				const wasActive = profiles.snapshot?.active?.profileId === target.id;
				let path: string | null = null;
				if (exportFirst) { path = await chooseSavePath(); if (!path) return; }
				const result = await actions.remove(target.id, path);
				toast.show(result.cleanupPending ? L.cleanupPending : L.deleted);
				profileDialog.close();
				if (wasActive) await goto('/profiles');
			} else if (mode === 'restore' && preview) {
				const record = await actions.restore(preview.token, name.trim());
				preview = null;
				profileDialog.showRestored(record);
			} else if (mode === 'backup' && target) {
				await actions.backup?.(target.id);
				backupSaved = true;
			}
		} catch (error) { failure = error; }
		finally { busy = false; }
	}
	async function exportBackup() {
		const target = profileDialog.target;
		if (busy || !target) return;
		failure = null;
		let path: string | null;
		try { path = await chooseSavePath(); }
		catch (error) { failure = error; return; }
		if (!path) return;
		busy = true;
		try { await actions.exportBackup?.(target.id, path); backupSaved = true; }
		catch (error) { failure = error; }
		finally { busy = false; }
	}
	async function openRestored() {
		const record = profileDialog.restored;
		if (!record || busy) return;
		busy = true;
		try { await actions.switchTo(record.id); profileDialog.close(); await goto(settings.firstRunComplete ? '/' : '/onboarding'); }
		catch (error) { failure = error; }
		finally { busy = false; }
	}
</script>

{#if profileDialog.mode}
	<div class="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title} tabindex="-1" onkeydown={onKeydown}>
		<div class="absolute inset-0 bg-[rgb(var(--scrim-rgb)/var(--scrim-modal))]" onclick={() => void close()} role="presentation"></div>
		<div bind:this={panelEl} tabindex="-1" class="relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-lg border border-line bg-tape p-6 space-y-5 shadow-2xl">
			<div class="flex items-start justify-between gap-4">
				<h2 class="figures text-lg text-ledger">{title}</h2>
				<button type="button" onclick={() => void close()} disabled={busy} aria-label={L.close} class="text-dim hover:text-ledger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-phosphor disabled:opacity-40"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" class="h-5 w-5" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
			</div>
			{#if profileDialog.target}<p class="font-medium text-ledger break-words">{profileDialog.target.name} <span class="figures text-xs text-dim">· {profileDialog.target.id.slice(0, 5)}</span></p>{/if}
			{#if profileDialog.mode === 'create' || profileDialog.mode === 'rename' || (profileDialog.mode === 'restore' && preview)}
				<label class="block space-y-2">
					<span class="text-sm text-ledger">{L.name}</span>
					<input type="text" bind:value={name} disabled={busy} class="w-full rounded-md border border-line bg-ink px-3 py-2 text-ledger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-phosphor" />
				</label>
				<p class="text-xs text-dim">{nameLength > 80 ? L.nameTooLong : nameLength === 0 ? L.nameRequired : L.nameHint}</p>
			{/if}
			{#if profileDialog.mode === 'restore'}
				<Button variant="secondary" disabled={busy} onclick={() => void chooseBackup()}>{L.chooseFile}</Button>
				{#if preview}<p class="text-sm text-dim">{L.preview}</p>{/if}
			{/if}
			{#if profileDialog.mode === 'reset'}<p class="text-sm text-dim">{L.resetWarning}</p>{/if}
			{#if profileDialog.mode === 'delete'}
				<p class="text-sm text-dim">{L.deleteWarning}</p>
				<div class="space-y-2 text-sm text-ledger">
					<label class="flex items-center gap-2"><input type="radio" bind:group={exportFirst} value={true} />{L.exportFirst}</label>
					<label class="flex items-center gap-2"><input type="radio" bind:group={exportFirst} value={false} />{L.deleteWithoutExport}</label>
				</div>
			{/if}
			{#if profileDialog.mode === 'backup'}
				{#if backupSaved}<p role="status" class="text-sm text-phosphor">{L.backupSaved}</p>{/if}
				<div class="flex flex-wrap gap-2"><Button variant="secondary" disabled={busy} onclick={() => void exportBackup()}>{L.export}</Button></div>
			{/if}
			{#if profileDialog.mode === 'restore-success'}
				<p class="text-sm text-dim">{L.restoreSuccess}</p>
				<p class="font-medium text-ledger">{profileDialog.restored?.name}</p>
			{/if}
			{#if errorText}<p role="alert" class="text-sm text-debit">{errorText}</p>{/if}
			{#if profiles.pendingTransition}<p role="status" class="text-sm text-dim">{L.waitingWindows} {profiles.pendingTransition.requiredLabels.join(', ')}</p>{/if}
			<div class="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
				<Button variant="ghost" disabled={busy && !profiles.pendingTransition} onclick={() => void close()}>{L.cancel}</Button>
				{#if profileDialog.mode === 'restore-success'}
					<Button disabled={busy} onclick={() => void openRestored()}>{L.openRestored}</Button>
				{:else if profileDialog.mode !== 'restore' || preview}
					<Button variant={profileDialog.mode === 'delete' || profileDialog.mode === 'reset' ? 'danger' : 'primary'} disabled={busy || ((profileDialog.mode === 'create' || profileDialog.mode === 'rename' || profileDialog.mode === 'restore') && !validName)} onclick={() => void submit()}>{busy ? L.working : profileDialog.mode === 'restore' ? L.restoreNew : title}</Button>
				{/if}
			</div>
		</div>
	</div>
{/if}
