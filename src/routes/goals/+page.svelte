<script lang="ts">
	import { onMount } from 'svelte';
	import Button from '$lib/components/primitives/Button.svelte';
	import Modal from '$lib/components/primitives/Modal.svelte';
	import Progress from '$lib/components/primitives/Progress.svelte';
	import GoalForm from '$lib/components/forms/GoalForm.svelte';
	import { goals } from '$lib/stores/goals.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { formatCurrency } from '$lib/utils/currency';
	import type { GoalWithProgress } from '$lib/db/repos/goals';

	let showForm = $state(false);
	let editing = $state<GoalWithProgress | null>(null);

	const statusIcons: Record<string, string> = { on_track: '✓', behind: '⚠', ahead: '★', overdue: '⏰', insufficient_data: '…' };

	onMount(() => goals.load());

	function openCreate() { editing = null; showForm = true; }
	function openEdit(g: GoalWithProgress) { editing = g; showForm = true; }

	async function markComplete(g: GoalWithProgress) {
		await goals.update(g.id, { status: 'completed' });
		toast.show('Goal marked complete.');
	}
	async function markAbandoned(g: GoalWithProgress) {
		await goals.update(g.id, { status: 'abandoned' });
		toast.show('Goal abandoned.');
	}
</script>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h1 class="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Goals</h1>
		<Button size="sm" onclick={openCreate}>+ Add goal</Button>
	</div>

	<section>
		<h2 class="text-sm font-medium text-zinc-500 dark:text-zinc-400 mb-2">Active</h2>
		{#if goals.active.length === 0}
			<div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-6 text-center text-zinc-400">
				<p class="text-sm">No active goals. <button onclick={openCreate} class="text-emerald-600 hover:underline">Create your first goal</button></p>
			</div>
		{:else}
			<div class="space-y-3">
				{#each goals.active as g}
					<div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-4 space-y-2 group">
						<div class="flex items-center justify-between">
							<button onclick={() => openEdit(g)} class="text-sm font-medium text-zinc-900 dark:text-zinc-50 text-left">{g.name}</button>
							<span class="text-xs">{statusIcons[g.velocity_status] ?? ''} {g.velocity_status.replace('_', ' ')}</span>
						</div>
						<Progress value={g.progress_pct} max={100} size="sm" />
						<div class="flex justify-between text-xs text-zinc-500">
							<span>{formatCurrency(g.current_amount, settings.currency, settings.locale)} / {formatCurrency(g.target_amount, settings.currency, settings.locale)}</span>
							<span>{g.progress_pct}% · due {g.target_date}</span>
						</div>
						{#if g.velocity_status === 'overdue'}
							<div class="flex gap-2 pt-2 border-t border-zinc-100 dark:border-zinc-700">
								<button onclick={() => openEdit(g)} class="text-xs text-emerald-600 hover:underline">Extend date</button>
								<button onclick={() => markComplete(g)} class="text-xs text-emerald-600 hover:underline">Mark complete</button>
								<button onclick={() => markAbandoned(g)} class="text-xs text-zinc-500 hover:underline">Mark abandoned</button>
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</section>

	{#if goals.completed.length > 0}
		<section>
			<h2 class="text-sm font-medium text-zinc-500 dark:text-zinc-400 mb-2">Completed</h2>
			<div class="space-y-2">
				{#each goals.completed as g}
					<div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-3 flex items-center justify-between text-sm">
						<span class="text-zinc-500">{g.name}</span>
						<span class="text-emerald-600">✓ Complete</span>
					</div>
				{/each}
			</div>
		</section>
	{/if}
</div>

<Modal bind:open={showForm} title={editing ? 'Edit goal' : 'Add goal'}>
	<GoalForm goal={editing} onclose={() => showForm = false} />
</Modal>
