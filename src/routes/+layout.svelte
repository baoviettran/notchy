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
	<div class="h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-900">
		<p class="text-zinc-500">Loading...</p>
	</div>
{:else if isOnboarding}
	{@render children()}
{:else}
	<div class="h-screen flex flex-col bg-zinc-50 dark:bg-zinc-900">
		<TopBar />
		<div class="flex flex-1 overflow-hidden">
			<Sidebar />
			<main class="flex-1 overflow-y-auto p-4 md:p-6 pb-20 md:pb-6 max-w-5xl mx-auto w-full">
				{@render children()}
			</main>
		</div>
		<BottomNav />
		<FAB onclick={() => showTxModal = true} />
		<Modal bind:open={showTxModal} title="Add transaction">
			<TransactionForm onclose={() => showTxModal = false} />
		</Modal>
	</div>
{/if}
