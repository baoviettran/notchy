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
	let confirmComplete = $state<GoalWithProgress | null>(null);
	let confirmAbandon = $state<GoalWithProgress | null>(null);

	const velocityStatus: Record<string, { icon: string; color: string }> = {
		on_track: { icon: '✓', color: 'text-phosphor' },
		behind: { icon: '⚠︎', color: 'text-debit' },
		ahead: { icon: '★', color: 'text-phosphor' },
		overdue: { icon: '⏰', color: 'text-debit' },
		insufficient_data: { icon: '…', color: 'text-dim' }
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
			toast.show(m.goals_marked_complete(), {
				action: m.common_undo(),
				duration: 5000,
				onaction: async () => {
					await goals.update(g.id, { status: 'active' });
					toast.show(m.goals_restored_toast());
				}
			});
		} catch (e) {
			toast.show(mapError(e));
		}
	}
	async function markAbandoned(g: GoalWithProgress) {
		try {
			await goals.update(g.id, { status: 'abandoned' });
			toast.show(m.goals_abandoned(), {
				action: m.common_undo(),
				duration: 5000,
				onaction: async () => {
					await goals.update(g.id, { status: 'active' });
					toast.show(m.goals_restored_toast());
				}
			});
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

	// Summary: aggregate across active goals.
	const totalSaved = $derived(goals.active.reduce((s, g) => s + g.current_amount, 0));
	const totalTarget = $derived(goals.active.reduce((s, g) => s + g.target_amount, 0));
	const onTrackCount = $derived(goals.active.filter((g) => g.velocity_status === 'on_track' || g.velocity_status === 'ahead').length);
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
	{#if goals.active.length > 0}
	<!-- Summary surface — the tape's total line. -->
	<div class="surface rounded-lg p-4">
		<div class="grid grid-cols-3 gap-4 text-center">
			<div>
				<p class="plate">{m.goals_active()}</p>
				<p class="figures text-lg text-ledger">{goals.active.length}</p>
			</div>
			<div>
				<p class="plate">{m.goals_summary_saved()}</p>
				<p class="figures text-lg text-ledger">{formatCurrency(totalSaved, settings.currency, settings.locale)}</p>
			</div>
			<div>
				<p class="plate">{m.goals_summary_target()}</p>
				<p class="figures-glow text-lg text-ledger">{formatCurrency(totalTarget, settings.currency, settings.locale)}</p>
			</div>
		</div>
		<div class="mt-2 pt-2 border-t border-line flex justify-between text-xs text-dim">
			<span>{m.goals_summary_on_track({ count: onTrackCount, total: goals.active.length })}</span>
			<span>{m.goals_summary_progress({ pct: totalTarget > 0 ? Math.round((totalSaved / totalTarget) * 100) : 0 })}</span>
		</div>
	</div>
	{/if}

	<section>
		<h2 class="plate mb-2">{m.goals_active()}</h2>
		{#if goals.active.length === 0}
			<div class="surface rounded-lg">
				<EmptyState message={m.goals_no_active()} glyph="target" title={m.empty_title_goals()}>
					{#snippet action()}
						<Button size="sm" variant="ghost" onclick={openCreate}>{m.goals_empty_state()}</Button>
					{/snippet}
				</EmptyState>
			</div>
		{:else}
			<div class="surface rounded-lg divide-y divide-line">
				{#each goals.active as g}
					{@const vs = velocityStatus[g.velocity_status] ?? { icon: '', color: 'text-dim' }}
					<div class="goal-item p-4 space-y-2">
						<div class="flex items-center justify-between">
							<button onclick={() => openEdit(g)} title={g.name} class="text-sm font-medium text-ledger text-left truncate max-w-[60%]">{g.name}</button>
							<div class="flex items-center gap-2">
								<span class="text-xs {vs.color}">{vs.icon} {goalStatusLabel(g.velocity_status)}</span>
								<ContextMenu label={m.common_actions_for({ name: g.name })}>
									<button onclick={() => confirmComplete = g} role="menuitem" class="w-full text-left px-3 py-2 text-sm text-phosphor hover:bg-line/40">{m.goals_mark_complete()}</button>
									<button onclick={() => confirmDelete = g} role="menuitem" class="w-full text-left px-3 py-2 text-sm text-debit hover:bg-line/40">{m.goals_delete()}</button>
								</ContextMenu>
							</div>
						</div>
						<div class="text-xs text-dim">{goalTypeLabel(g.type)}</div>
						<Progress value={g.progress_pct} max={100} size="sm" label={g.name} />
						<div class="flex justify-between text-xs text-dim">
							<span class="figures"><Money amount={g.current_amount} tone="dim" size="text-xs" /> / <Money amount={g.target_amount} tone="dim" size="text-xs" /></span>
							<span class="figures">{g.progress_pct}%</span> · {m.goals_due_date({ date: g.target_date })}
						</div>
						{#if g.velocity_status === 'overdue'}
							<div class="flex gap-2 pt-2 border-t border-line">
								<button onclick={() => openEdit(g)} class="min-h-11 inline-flex items-center text-xs text-phosphor hover:underline">{m.goals_extend_date()}</button>
								<button onclick={() => confirmAbandon = g} class="min-h-11 inline-flex items-center text-xs text-dim hover:underline">{m.goals_mark_abandoned()}</button>
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
			<div class="surface rounded-lg divide-y divide-line">
				{#each goals.completed as g}
					<div class="px-4 py-3 flex items-center justify-between text-sm">
						<div>
							<span class="text-dim">{g.name}</span>
							<span class="text-xs text-dim ml-2">{goalTypeLabel(g.type)}</span>
						</div>
						<div class="flex items-center gap-3">
							<span class="figures text-xs text-dim"><Money amount={g.target_amount} tone="dim" size="text-xs" /></span>
							<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-phosphor/40 bg-phosphor/10 figures text-xs text-phosphor">✓ {m.goals_complete()}</span>
						</div>
					</div>
				{/each}
			</div>
		</section>
	{/if}

	{#if goals.abandoned.length > 0}
		<section>
			<h2 class="plate mb-2">{m.goals_abandoned_section()}</h2>
			<div class="surface rounded-lg divide-y divide-line">
				{#each goals.abandoned as g}
					<div class="px-4 py-3 flex items-center justify-between text-sm">
						<div>
							<span class="text-dim">{g.name}</span>
							<span class="text-xs text-dim ml-2">{goalTypeLabel(g.type)}</span>
						</div>
						<span class="figures text-xs text-dim">{formatCurrency(g.current_amount, settings.currency, settings.locale)} / {formatCurrency(g.target_amount, settings.currency, settings.locale)}</span>
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

<ConfirmDialog
	open={confirmComplete !== null}
	title={m.goals_complete_confirm_title()}
	message={confirmComplete ? m.goals_complete_confirm_body({ name: confirmComplete.name }) : ''}
	confirmLabel={m.goals_mark_complete()}
	danger={false}
	onconfirm={() => { if (confirmComplete) { void markComplete(confirmComplete); confirmComplete = null; } }}
/>

<ConfirmDialog
	open={confirmAbandon !== null}
	title={m.goals_abandon_confirm_title()}
	message={confirmAbandon ? m.goals_abandon_confirm_body({ name: confirmAbandon.name }) : ''}
	confirmLabel={m.goals_mark_abandoned()}
	danger={true}
	onconfirm={() => { if (confirmAbandon) { void markAbandoned(confirmAbandon); confirmAbandon = null; } }}
/>
