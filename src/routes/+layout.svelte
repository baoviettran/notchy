<script lang="ts">
	import '../app.css';
	// IBM Plex Mono — the VFD/display face. Imported here (not via a CSS
	// @import in app.css) so Vite resolves the @fontsource bare specifier
	// through node_modules; a CSS @import makes Tailwind's resolver fail.
	import '@fontsource/ibm-plex-mono/400.css';
	import '@fontsource/ibm-plex-mono/500.css';
	import '@fontsource/ibm-plex-mono/600.css';
	// IBM Plex Sans — the body/UI face.
	import '@fontsource/ibm-plex-sans/400.css';
	import '@fontsource/ibm-plex-sans/500.css';
	import '@fontsource/ibm-plex-sans/600.css';
	import { onMount, onDestroy } from 'svelte';
	import { listen } from '@tauri-apps/api/event';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { dbStore } from '$lib/stores/db.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { tour } from '$lib/stores/tour.svelte';
	import { transactions } from '$lib/stores/transactions.svelte';
	import { attachTransactionSavedListener } from '$lib/stores/quick-refresh';
	import Sidebar from '$lib/components/layout/Sidebar.svelte';
	import TopBar from '$lib/components/layout/TopBar.svelte';
	import BottomNav from '$lib/components/layout/BottomNav.svelte';
	import FAB from '$lib/components/layout/FAB.svelte';
	import Modal from '$lib/components/primitives/Modal.svelte';
	import TransactionForm from '$lib/components/forms/TransactionForm.svelte';
	import GlobalToast from '$lib/components/primitives/GlobalToast.svelte';
	import TourOverlay from '$lib/components/tour/TourOverlay.svelte';
	import RecoveryScreen from '$lib/components/system/RecoveryScreen.svelte';
	import StartupProgress from '$lib/components/system/StartupProgress.svelte';
	import * as m from '$lib/paraglide/messages';

	let { children } = $props();
	let showTxModal = $state(false);
	let unlisten: (() => void) | undefined;
	let tourInitialized = false;

	onMount(async () => {
		// Only the main window owns DB lifecycle (migrations, integrity checks,
		// runAutoBackup → VACUUM INTO, an exclusive lock). tauri-plugin-sql pools
		// one connection per DB path across all webview windows, so if the
		// quick-add window also ran dbStore.init() its runAutoBackup would
		// contend with the main window's writes — bricking them after a 5s
		// busy_timeout with "no such savepoint". quick-add reuses the pool via
		// getDb() directly (see src/routes/quick-add/+page.svelte).
		const isQuickAddWindow = $page.url.pathname.startsWith('/quick-add');
		if (isQuickAddWindow) {
			// quick-add still needs settings + its own transaction:saved handling
			// is unnecessary (it emits, doesn't receive). Nothing to do here.
			return;
		}
		await dbStore.init();
		if (dbStore.ready && !dbStore.firstRunComplete && $page.url.pathname !== '/onboarding') {
			goto('/onboarding');
		}
	});

	$effect(() => {
		const isQuickAddWindow = $page.url.pathname.startsWith('/quick-add');
		if (isQuickAddWindow) return;

		if (dbStore.ready && dbStore.firstRunComplete && !tourInitialized) {
			tourInitialized = true;
			(async () => {
				await settings.load();
				await tour.load();
				if (!tour.complete) {
					tour.start();
				}
				unlisten = await attachTransactionSavedListener(listen, async () => {
					await transactions.load();
				});
			})();
		}
	});

	function onKeydown(e: KeyboardEvent) {
		// Host shortcuts yield to the tour overlay
		if (tour.active) return;
		const target = e.target as HTMLElement;
		const inInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
		if (e.key === 'Escape') { showTxModal = false; return; }
		if (inInput) return;
		if (e.key === 'n') { showTxModal = true; e.preventDefault(); }
		if (e.key === '/') { document.querySelector<HTMLInputElement>('[type="search"]')?.focus(); e.preventDefault(); }
	}

	const isOnboarding = $derived($page.url.pathname === '/onboarding');
	const isQuickAdd = $derived($page.url.pathname.startsWith('/quick-add'));

	onDestroy(() => {
		unlisten?.();
	});
</script>

<svelte:window onkeydown={onKeydown} />

{#if isQuickAdd}
	<!-- quick-add does not run dbStore.init() (see onMount), so dbStore.ready
	     stays false in its JS context. Render its content directly; it manages
	     its own ready state internally. -->
	{@render children()}
{:else if dbStore.stage === 'recovery_required' && dbStore.recovery}
	<RecoveryScreen
		context={dbStore.recovery}
		onretry={() => dbStore.retry()}
		onrestore={() => dbStore.restoreLatestBackup()}
		onopenfolder={() => dbStore.openBackupFolder()}
		onquit={() => dbStore.quit()}
	/>
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
		<TopBar />
		<div class="flex flex-1 overflow-hidden">
			<Sidebar />
			<main class="flex-1 overflow-y-auto p-4 md:p-8 pb-40 md:pb-8 max-w-5xl mx-auto w-full">
				{@render children()}
			</main>
		</div>
		<BottomNav />
		<FAB onclick={() => showTxModal = true} />
		<Modal bind:open={showTxModal} title={m.layout_add_transaction()}>
			<TransactionForm onclose={() => showTxModal = false} />
		</Modal>
		<GlobalToast />
		<TourOverlay />
	</div>
	{/key}
{/if}
