<script lang="ts">
	import { onMount } from 'svelte';
	import Button from '$lib/components/primitives/Button.svelte';
	import Modal from '$lib/components/primitives/Modal.svelte';
	import ConfirmDialog from '$lib/components/primitives/ConfirmDialog.svelte';
	import ContextMenu from '$lib/components/primitives/ContextMenu.svelte';
	import Progress from '$lib/components/primitives/Progress.svelte';
	import EmptyState from '$lib/components/primitives/EmptyState.svelte';
	import ErrorState from '$lib/components/primitives/ErrorState.svelte';
	import Skeleton from '$lib/components/primitives/Skeleton.svelte';
	import GoalForm from '$lib/components/forms/GoalForm.svelte';
	import { goals } from '$lib/stores/goals.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { formatCurrency } from '$lib/utils/currency';
import Money from '$lib/components/reports/Money.svelte';
	import { mapError } from '$lib/utils/errors';
	import type { GoalWithProgress, GoalType } from '$lib/db/repos/goals';
	import * as m from '$lib/paraglide/messages';

	let showForm = $state(false);
	let editing = $state<GoalWithProgress | null>(null);
	let confirmDelete = $state<GoalWithProgress | null>(null);

	const statusIcons: Record<string, string> = { on_track: '✓', behind: '⚠', ahead: '★', overdue: '⏰', insufficient_data: '…' };
	const statusColors: Record<string, string> = {
		on_track: 'text-phosphor',
		behind: 'text-debit',
		ahead: 'text-phosphor',
		overdue: 'text-debit',
		insufficient_data: 'text-dim'
	};

	function goalTypeLabel(type: GoalType): string {
		switch (type) {
			case 'savings': return m.forms_goal_type_savings();
			case 'debt_payoff': return m.forms_goal_type_debt_payoff();
			case 'net_worth': return m.forms_goal_type_net_worth();
			default: return type;
		}
	}

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
		try {
			await goals.update(g.id, { status: 'completed' });
			// A milestone earns more than the default beat — hold it long enough
			// for the phosphor flicker to register.
			toast.show(m.goals_marked_complete(), { duration: 5000 });
		} catch (e) {
			toast.show(mapError(e));
		}
	}
	async function markAbandoned(g: GoalWithProgress) {
		try {
			await goals.update(g.id, { status: 'abandoned' });
			toast.show(m.goals_abandoned());
		} catch (e) {
			toast.show(mapError(e));
		}
	}

	async function doDelete() {
		if (!confirmDelete) return;
		try {
			await goals.delete(confirmDelete.id);
			toast.show(m.goals_deleted_toast());
			confirmDelete = null;
		} catch (e) {
			toast.show(mapError(e));
		}
	}

	// Numeric restatement: the confirm names what is being destroyed.
	const deleteMessage = $derived(
		confirmDelete
			? m.goals_delete_confirm_body({
					name: confirmDelete.name,
					amount: formatCurrency(confirmDelete.current_amount, settings.currency, settings.locale)
				})
			: ''
	);
</script>

<div class="space-y-6">
	<div class="flex flex-wrap items-center justify-between gap-y-2">
		<h1 class="page-title">{m.goals_title()}</h1>
		<Button size="sm" onclick={openCreate}>{m.goals_add()}</Button>
	</div>

	{#if goals.loading}
		<div class="surface rounded-lg p-4">
			<Skeleton lines={4} />
		</div>
	{:else if goals.error}
		<ErrorState description={goals.error} onRetry={() => goals.load()} />
	{:else}
	<section>
		<h2 class="plate mb-2">{m.goals_active()}</h2>
		{#if goals.active.length === 0}
			<div class="bg-tape rounded-lg border border-line">
				<EmptyState message={m.goals_no_active()} icon="▮▯▯▯">
					{#snippet action()}
						<button onclick={openCreate} class="text-phosphor hover:underline text-sm">{m.goals_empty_state()}</button>
					{/snippet}
				</EmptyState>
			</div>
		{:else}
			<div class="bg-tape rounded-lg border border-line divide-y divide-line">
				{#each goals.active as g}
					<div class="goal-item p-4 space-y-2">
						<div class="flex items-center justify-between">
							<button onclick={() => openEdit(g)} class="text-sm font-medium text-ledger text-left">{g.name}</button>
							<div class="flex items-center gap-2">
								<span class="text-xs {statusColors[g.velocity_status] ?? 'text-dim'}">{statusIcons[g.velocity_status] ?? ''} {goalStatusLabel(g.velocity_status)}</span>
								<ContextMenu label={m.common_actions_for({ name: g.name })}>
									<button onclick={() => markComplete(g)} role="menuitem" class="w-full text-left px-3 py-2 text-sm text-phosphor hover:bg-line/40">{m.goals_mark_complete()}</button>
									<button onclick={() => confirmDelete = g} role="menuitem" class="w-full text-left px-3 py-2 text-sm text-debit hover:bg-line/40">{m.goals_delete()}</button>
								</ContextMenu>
							</div>
						</div>
						<div class="text-xs text-dim">{goalTypeLabel(g.type)}</div>
						<Progress value={g.progress_pct} max={100} size="sm" label={g.name} />
						<div class="flex justify-between text-xs text-dim">
							<span class="figures"><Money amount={g.current_amount} tone="dim" size="text-xs" /> / <Money amount={g.target_amount} tone="dim" size="text-xs" /></span>
							<span>{g.progress_pct}% · {m.goals_due_date({ date: g.target_date })}</span>
						</div>
						{#if g.velocity_status === 'overdue'}
							<div class="flex gap-2 pt-2 border-t border-line">
								<button onclick={() => openEdit(g)} class="text-xs text-phosphor hover:underline">{m.goals_extend_date()}</button>
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
			<div class="bg-tape rounded-lg border border-line divide-y divide-line">
				{#each goals.completed as g}
					<div class="px-4 py-3 flex items-center justify-between text-sm">
						<div>
							<span class="text-dim">{g.name}</span>
							<span class="text-xs text-dim ml-2">{goalTypeLabel(g.type)}</span>
						</div>
						<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-phosphor/40 bg-phosphor/10 figures text-xs text-phosphor">✓ {m.goals_complete()}</span>
					</div>
				{/each}
			</div>
		</section>
	{/if}
	{/if}
</div>

<Modal bind:open={showForm} title={editing ? m.goals_edit() : m.goals_add_modal()}>
	<GoalForm goal={editing} onclose={() => showForm = false} />
</Modal>

<ConfirmDialog
	open={confirmDelete !== null}
	title={m.goals_delete_confirm_title()}
	message={deleteMessage}
	confirmLabel={m.common_delete()}
	danger={true}
	onconfirm={doDelete}
/>
