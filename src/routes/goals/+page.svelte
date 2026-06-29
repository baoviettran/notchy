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
	import * as m from '$lib/paraglide/messages';

	let showForm = $state(false);
	let editing = $state<GoalWithProgress | null>(null);

	const statusIcons: Record<string, string> = { on_track: '✓', behind: '⚠', ahead: '★', overdue: '⏰', insufficient_data: '…' };

	onMount(() => goals.load());

	function goalStatusLabel(status: string): string {
		switch (status) {
			case 'on_track': return m.goals_status_on_track();
			case 'behind': return m.goals_status_behind();
			case 'ahead': return m.goals_status_ahead();
			case 'overdue': return m.goals_status_overdue();
			case 'insufficient_data': return m.goals_status_insufficient_data();
			default: return status;
		}
	}

	function openCreate() { editing = null; showForm = true; }
	function openEdit(g: GoalWithProgress) { editing = g; showForm = true; }

	async function markComplete(g: GoalWithProgress) {
		await goals.update(g.id, { status: 'completed' });
		toast.show(m.goals_marked_complete());
	}
	async function markAbandoned(g: GoalWithProgress) {
		await goals.update(g.id, { status: 'abandoned' });
		toast.show(m.goals_abandoned());
	}
</script>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h1 class="figures text-xl text-ledger tracking-wide">{m.goals_title()}</h1>
		<Button size="sm" onclick={openCreate}>{m.goals_add()}</Button>
	</div>

	<section>
		<h2 class="plate mb-2">{m.goals_active()}</h2>
		{#if goals.active.length === 0}
			<div class="bg-tape rounded-lg border border-line p-6 text-center text-dim">
				<p class="text-sm">{m.goals_no_active()} <button onclick={openCreate} class="text-phosphor hover:underline">{m.goals_empty_state()}</button></p>
			</div>
		{:else}
			<div class="space-y-3">
				{#each goals.active as g}
					<div class="bg-tape rounded-lg border border-line p-4 space-y-2 group">
						<div class="flex items-center justify-between">
							<button onclick={() => openEdit(g)} class="figures text-sm font-medium text-ledger text-left">{g.name}</button>
							<span class="text-xs text-dim">{statusIcons[g.velocity_status] ?? ''} {goalStatusLabel(g.velocity_status)}</span>
						</div>
						<Progress value={g.progress_pct} max={100} size="sm" />
						<div class="flex justify-between text-xs text-dim">
							<span>{formatCurrency(g.current_amount, settings.currency, settings.locale)} / {formatCurrency(g.target_amount, settings.currency, settings.locale)}</span>
							<span>{g.progress_pct}% · {m.goals_due_date({ date: g.target_date })}</span>
						</div>
						{#if g.velocity_status === 'overdue'}
							<div class="flex gap-2 pt-2 border-t border-line">
								<button onclick={() => openEdit(g)} class="text-xs text-phosphor hover:underline">{m.goals_extend_date()}</button>
								<button onclick={() => markComplete(g)} class="text-xs text-phosphor hover:underline">{m.goals_mark_complete()}</button>
								<button onclick={() => markAbandoned(g)} class="text-xs text-dim hover:underline">{m.goals_mark_abandoned()}</button>
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</section>

	{#if goals.completed.length > 0}
		<section>
			<h2 class="plate mb-2">{m.goals_completed()}</h2>
			<div class="space-y-2">
				{#each goals.completed as g}
					<div class="bg-tape rounded-lg border border-line p-3 flex items-center justify-between text-sm">
						<span class="text-dim">{g.name}</span>
						<span class="text-phosphor">✓ {m.goals_complete()}</span>
					</div>
				{/each}
			</div>
		</section>
	{/if}
</div>

<Modal bind:open={showForm} title={editing ? m.goals_edit() : m.goals_add_modal()}>
	<GoalForm goal={editing} onclose={() => showForm = false} />
</Modal>
