<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { dbStore } from '$lib/stores/db.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import Sidebar from '$lib/components/layout/Sidebar.svelte';
	import TopBar from '$lib/components/layout/TopBar.svelte';
	import BottomNav from '$lib/components/layout/BottomNav.svelte';
	import FAB from '$lib/components/layout/FAB.svelte';
	import Modal from '$lib/components/primitives/Modal.svelte';
	import TransactionForm from '$lib/components/forms/TransactionForm.svelte';
	import GlobalToast from '$lib/components/primitives/GlobalToast.svelte';
	import * as m from '$lib/paraglide/messages';

	let { children } = $props();
	let showTxModal = $state(false);

	onMount(async () => {
		await dbStore.init();
		if (dbStore.ready && !dbStore.firstRunComplete && $page.url.pathname !== '/onboarding') {
			goto('/onboarding');
		}
		if (dbStore.ready && dbStore.firstRunComplete) {
			await settings.load();
		}
	});

	function onKeydown(e: KeyboardEvent) {
		const target = e.target as HTMLElement;
		const inInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
		if (e.key === 'Escape') { showTxModal = false; return; }
		if (inInput) return;
		if (e.key === 'n') { showTxModal = true; e.preventDefault(); }
		if (e.key === '/') { document.querySelector<HTMLInputElement>('[type="search"]')?.focus(); e.preventDefault(); }
	}

	const isOnboarding = $derived($page.url.pathname === '/onboarding');
</script>

<svelte:window onkeydown={onKeydown} />

{#if !dbStore.ready}
	<div class="h-screen flex flex-col items-center justify-center bg-ink gap-3">
		<div class="figures-glow text-2xl animate-flash">▮▮▮</div>
		<p class="plate">{m.layout_warming_up()}</p>
	</div>
{:else if isOnboarding}
	{@render children()}
{:else}
	<div class="h-screen flex flex-col bg-ink text-ledger">
		<TopBar />
		<div class="flex flex-1 overflow-hidden">
			<Sidebar />
			<main class="flex-1 overflow-y-auto p-4 md:p-8 pb-24 md:pb-8 max-w-5xl mx-auto w-full">
				{@render children()}
			</main>
		</div>
		<BottomNav />
		<FAB onclick={() => showTxModal = true} />
		<Modal bind:open={showTxModal} title={m.layout_add_transaction()}>
			<TransactionForm onclose={() => showTxModal = false} />
		</Modal>
		<GlobalToast />
	</div>
{/if}
