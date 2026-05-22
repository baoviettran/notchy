<script>
	import '../app.css';
	import Sidebar from '$lib/components/layout/Sidebar.svelte';
	import TopBar from '$lib/components/layout/TopBar.svelte';
	import BottomNav from '$lib/components/layout/BottomNav.svelte';
	import FAB from '$lib/components/layout/FAB.svelte';

	let { children } = $props();
	let showModal = $state(false);
</script>

<div class="h-screen flex flex-col bg-zinc-50 dark:bg-zinc-900">
	<TopBar />
	<div class="flex flex-1 overflow-hidden">
		<Sidebar />
		<main class="flex-1 overflow-y-auto p-4 md:p-6 pb-20 md:pb-6 max-w-5xl mx-auto w-full">
			{@render children()}
		</main>
	</div>
	<BottomNav />
	<FAB onclick={() => showModal = !showModal} />
</div>
