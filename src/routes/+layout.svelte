<script lang="ts">
	import '../app.css';
	// IBM Plex Mono — the VFD/display face. Imported here (not via a CSS
	// @import in app.css) so Vite resolves the @fontsource bare specifier
	// through node_modules; a CSS @import makes Tailwind's resolver fail.
	import '@fontsource/ibm-plex-mono/400.css';
	import '@fontsource/ibm-plex-mono/500.css';
	// IBM Plex Sans — the body/UI face.
	import '@fontsource/ibm-plex-sans/400.css';
	import '@fontsource/ibm-plex-sans/500.css';
	import '@fontsource/ibm-plex-sans/600.css';
	import { onMount, onDestroy } from 'svelte';
	import { listen } from '@tauri-apps/api/event';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { dbStore } from '$lib/stores/db.svelte';
	import { profiles, setProfileDraftChoice } from '$lib/stores/profiles.svelte';
	import { installProfileWindowListeners, installAppPreferencesListener, type DraftChoice } from '$lib/profiles/windows';
	import { getDb, isTauri } from '$lib/db';
	import { startAutomaticBackupChecks } from '$lib/backup/automatic';
	import ProfileManager from '$lib/components/profiles/ProfileManager.svelte';
	import ProfileDialogs from '$lib/components/profiles/ProfileDialogs.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { tour } from '$lib/stores/tour.svelte';
	import { transactions } from '$lib/stores/transactions.svelte';
	import { attachTransactionSavedListener } from '$lib/stores/quick-refresh';
	import Sidebar from '$lib/components/layout/Sidebar.svelte';
	import TopBar from '$lib/components/layout/TopBar.svelte';
	import BottomNav from '$lib/components/layout/BottomNav.svelte';
	import FAB from '$lib/components/layout/FAB.svelte';
	import ShortcutRef from '$lib/components/layout/ShortcutRef.svelte';
	import Modal from '$lib/components/primitives/Modal.svelte';
	import TransactionForm from '$lib/components/forms/TransactionForm.svelte';
	import RuleDialogs from '$lib/components/modals/RuleDialogs.svelte';
	import GlobalToast from '$lib/components/primitives/GlobalToast.svelte';
	import TourOverlay from '$lib/components/tour/TourOverlay.svelte';
	import StartupProgress from '$lib/components/system/StartupProgress.svelte';
	import Button from '$lib/components/primitives/Button.svelte';
	import { profileDialog } from '$lib/components/profiles/controller.svelte';
	import { mapError } from '$lib/utils/errors';
	import * as m from '$lib/paraglide/messages';
	import { label } from '$lib/utils/i18n.svelte';

	let { children } = $props();
	let showTxModal = $state(false);
	let showShortcuts = $state(false);
	let unlisten: (() => void) | undefined;
	let bootingProfiles = $state(true);
	let profileBootError = $state<string | null>(null);
	let pendingDraftChoice = $state<((choice: DraftChoice) => void) | null>(null);
	let unlistenProfileWindow: (() => void) | undefined;
	let unlistenPreferences: (() => void) | undefined;
	let unlistenCanceled: (() => void) | undefined;
	let tourInitialized = false;

	function chooseDraft(): Promise<DraftChoice> {
		return new Promise((resolve) => { pendingDraftChoice = resolve; });
	}
	function answerDraft(choice: DraftChoice): void {
		const resolve = pendingDraftChoice; pendingDraftChoice = null; resolve?.(choice);
	}
	setProfileDraftChoice(async () => chooseDraft());

	onMount(async () => {
		if ($page.url.pathname.startsWith('/quick-add')) return;
		try {
			if (isTauri()) {
				unlisten = await attachTransactionSavedListener(listen, async () => {
					await transactions.load();
				}, () => profiles.snapshot?.active ?? null);
			}
			const snapshot = isTauri() ? await profiles.bootstrap() : await profiles.load();
			if (isTauri()) {
				unlistenProfileWindow = await installProfileWindowListeners({
					currentSession: () => profiles.snapshot?.active ?? null,
					choose: chooseDraft,
					onSessionChanged: () => {
						showTxModal = false; showShortcuts = false;
						if (!profiles.busy) void profiles.load().then((next) => {
							void goto(next.active ? (settings.firstRunComplete ? '/' : '/onboarding') : '/profiles');
						}).catch((error) => profileBootError = mapError(error));
					}
				});
				unlistenPreferences = await installAppPreferencesListener((preferences) => settings.loadAppPreferences(preferences));
				unlistenCanceled = await listen('profile:transition-canceled', () => answerDraft('cancel'));
			}
			if (!snapshot.active && $page.url.pathname !== '/profiles') await goto('/profiles');
			else if (snapshot.active && !settings.firstRunComplete && !['/onboarding', '/profiles', '/settings/profiles'].includes($page.url.pathname)) await goto('/onboarding');
		} catch (error) {
			profileBootError = mapError(error);
			await profiles.load().catch(() => {});
		} finally { bootingProfiles = false; }
	});

	async function retryProfileBootstrap() {
		bootingProfiles = true; profileBootError = null;
		try {
			const snapshot = await profiles.bootstrap();
			if (snapshot.active) await goto(settings.firstRunComplete ? '/' : '/onboarding');
		} catch (error) {
			profileBootError = mapError(error);
			await profiles.load().catch(() => {});
		} finally { bootingProfiles = false; }
	}

	$effect(() => {
		if ($page.url.pathname.startsWith('/quick-add')) return;
		if (dbStore.ready && dbStore.firstRunComplete && !tourInitialized) {
			tourInitialized = true;
			void tour.load().then(() => { if (!tour.complete) tour.start(); });
		}
	});

	$effect(() => {
		const active = profiles.snapshot?.active;
		if (bootingProfiles || $page.url.pathname.startsWith('/quick-add') || !active || !dbStore.ready) return;
		return startAutomaticBackupChecks(getDb(), () => profiles.snapshot?.active ?? null);
	});

	function onKeydown(e: KeyboardEvent) {
		// Host shortcuts yield to the tour overlay
		if (tour.active) return;
		const target = e.target as HTMLElement;
		const inInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
		if (e.key === 'Escape') { showTxModal = false; showShortcuts = false; return; }
		if (inInput) return;
		if (e.key === 'n') { showTxModal = true; e.preventDefault(); }
		if (e.key === '/') { document.querySelector<HTMLInputElement>('[type="search"]')?.focus(); e.preventDefault(); }
		if (e.key === '?') { showShortcuts = !showShortcuts; e.preventDefault(); }
	}

	const isOnboarding = $derived($page.url.pathname === '/onboarding');
	const isQuickAdd = $derived($page.url.pathname.startsWith('/quick-add'));

	onDestroy(() => {
		unlisten?.(); unlistenProfileWindow?.(); unlistenPreferences?.(); unlistenCanceled?.();
	});
</script>

<svelte:window onkeydown={onKeydown} />

{#if isQuickAdd}
	<!-- Quick Add binds its own profile session and manages readiness locally. -->
	{@render children()}
{:else if bootingProfiles}
	<StartupProgress stage={dbStore.stage} />
{:else if profileBootError || profiles.snapshot?.phase === 'recovery'}
	<div class="h-screen overflow-y-auto bg-ink text-ledger"><div class="mx-auto max-w-3xl p-4 md:p-8 space-y-6">
		<div class="surface rounded-lg p-5 space-y-3" role="alert">
			<h1 class="page-title">{label(() => m.profiles_recovery_title())}</h1>
			<p class="text-sm text-dim">{label(() => m.profiles_recovery_desc())}</p>
			{#if profileBootError}<p class="text-sm text-debit">{profileBootError}</p>{/if}
			<div class="flex flex-wrap gap-2">
				<Button onclick={() => void retryProfileBootstrap()}>{label(() => m.profiles_recovery_retry())}</Button>
				<Button variant="secondary" onclick={() => profileDialog.open('restore')}>{label(() => m.profiles_restore())}</Button>
			</div>
		</div>
		<ProfileManager mode="picker" />
	</div></div>
{:else if !profiles.snapshot?.active}
	<div class="h-screen overflow-y-auto bg-ink text-ledger"><div class="mx-auto max-w-3xl p-4 md:p-8"><ProfileManager mode="picker" /></div></div>
{:else if !dbStore.ready}
	<StartupProgress stage={dbStore.stage} />
{:else if isOnboarding}
	<!-- Keyed on locale: paraglide's setLanguageTag is not reactive, so a
	     language switch remounts the shell and every m.*() call site
	     re-evaluates under the new tag. -->
	{#key settings.locale}
		{@render children()}
	{/key}
{:else}
	{#key settings.locale}
	<div class="h-screen flex flex-col bg-ink text-ledger">
		<!-- First focusable element: keyboard users jump straight into <main>
		     without tabbing through the sidebar and top bar (WCAG 2.4.1). -->
		<a
			href="#main-content"
			class="sr-only focus:not-sr-only focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-phosphor
				focus:absolute focus:z-50 focus:top-2 focus:left-2
				focus:bg-tape focus:text-ledger focus:border focus:border-line focus:rounded-md
				focus:px-3 focus:py-2 focus:text-sm"
		>
			{m.a11y_skip_to_content()}
		</a>
		<TopBar onOpenShortcuts={() => { showShortcuts = true; }} />
		<div class="flex flex-1 overflow-hidden">
			<Sidebar />
			<main id="main-content" class="flex-1 overflow-y-auto p-4 md:p-8 pb-40 md:pb-8 max-w-5xl mx-auto w-full">
				{@render children()}
			</main>
		</div>
		<BottomNav />
		<FAB onclick={() => showTxModal = true} />
		<TourOverlay />
	</div>
	{/key}
	<!-- Outside the keyed shell: a mid-flow language switch remounts the chrome
	     but must not close this modal or wipe the draft being typed into it.
	     The title re-evaluates through label(); TransactionForm tracks the
	     locale through its own derived labels. -->
	<Modal bind:open={showTxModal} title={label(() => m.layout_add_transaction())}>
		<TransactionForm onclose={() => showTxModal = false} />
	</Modal>
	<GlobalToast />
	<RuleDialogs />
	<ShortcutRef bind:open={showShortcuts} />
{/if}

{#if !isQuickAdd}
	<ProfileDialogs />
	{#if pendingDraftChoice}
		<div class="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" role="alertdialog" aria-modal="true" aria-label={label(() => m.profiles_unsaved_drafts())}>
			<div class="surface max-w-md rounded-lg border border-line p-5 space-y-4">
				<p class="text-ledger">{label(() => m.profiles_unsaved_drafts())}</p>
				<div class="flex justify-end gap-3">
					<button type="button" class="px-3 py-2 text-dim" onclick={() => answerDraft('stay')}>{label(() => m.profiles_stay())}</button>
					<button type="button" class="px-3 py-2 rounded bg-debit text-white" onclick={() => answerDraft('discard')}>{label(() => m.profiles_discard())}</button>
				</div>
			</div>
		</div>
	{/if}
{/if}
