<script lang="ts">
	import { onMount } from 'svelte';
	import Button from '$lib/components/primitives/Button.svelte';
	import Modal from '$lib/components/primitives/Modal.svelte';
	import ConfirmDialog from '$lib/components/primitives/ConfirmDialog.svelte';
	import EmptyState from '$lib/components/primitives/EmptyState.svelte';
	import ErrorState from '$lib/components/primitives/ErrorState.svelte';
	import Skeleton from '$lib/components/primitives/Skeleton.svelte';
	import ScheduleForm from '$lib/components/forms/ScheduleForm.svelte';
	import Money from '$lib/components/reports/Money.svelte';
	import { schedules } from '$lib/stores/schedules.svelte';
	import { accounts } from '$lib/stores/accounts.svelte';
	import { categories } from '$lib/stores/categories.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { formatDate, todayIso } from '$lib/utils/date';
	import { mapError } from '$lib/utils/errors';
	import type { Schedule, ScheduleFrequency, ScheduleUpdate } from '$lib/db/client';
	import * as m from '$lib/paraglide/messages';

	let showForm = $state(false);
	let editing = $state<Schedule | null>(null);
	let confirmDelete = $state<Schedule | null>(null);

	onMount(() => {
		void schedules.load();
		void accounts.load();
		void categories.load();
	});

	const accountOptions = $derived(accounts.items.map((a) => ({ id: a.id, name: a.name })));
	const tagOptions = $derived(categories.tags.map((t) => ({ id: t.id, name: t.name })));

	function frequencyLabel(f: ScheduleFrequency): string {
		switch (f) {
			case 'weekly': return m.schedules_freq_weekly();
			case 'biweekly': return m.schedules_freq_biweekly();
			case 'monthly': return m.schedules_freq_monthly();
			case 'yearly': return m.schedules_freq_yearly();
		}
	}

	type Status = 'errored' | 'completed' | 'reminder' | 'active';

	// Exactly four states, in precedence order: a parked row outranks a completed
	// one, and a reminder-only row is distinguished from an active one.
	function statusOf(s: Schedule): Status {
		if (s.errored_at !== null) return 'errored';
		if (s.completed === 1) return 'completed';
		if (s.posts_transaction === 0) return 'reminder';
		return 'active';
	}

	const statusLabel: Record<Status, () => string> = {
		errored: () => m.schedules_status_errored(),
		completed: () => m.schedules_status_completed(),
		reminder: () => m.schedules_status_reminder(),
		active: () => m.schedules_status_active()
	};

	const statusClass: Record<Status, string> = {
		errored: 'border-debit/40 bg-debit/10 text-debit',
		completed: 'border-line bg-line/20 text-dim',
		reminder: 'border-phosphor/40 bg-phosphor/10 text-phosphor',
		active: 'border-phosphor/40 bg-phosphor/10 text-phosphor'
	};

	function openCreate() {
		editing = null;
		showForm = true;
	}

	function openEdit(s: Schedule) {
		editing = s;
		showForm = true;
	}

	async function handleSubmit(input: ScheduleUpdate) {
		try {
			if (editing) {
				await schedules.update(editing.id, input);
			} else {
				await schedules.create(input);
			}
			showForm = false;
			editing = null;
		} catch (e) {
			toast.show(mapError(e));
		}
	}

	// `resume` handles both cases: a parked row keeps its stored date so its
	// backlog drains, a disabled one jumps forward to the next occurrence.
	async function resume(s: Schedule) {
		await schedules.resume(s.id, todayIso());
	}

	async function doDelete() {
		if (!confirmDelete) return;
		try {
			await schedules.remove(confirmDelete.id);
			confirmDelete = null;
		} catch (e) {
			toast.show(mapError(e));
		}
	}
</script>

<div class="space-y-6">
	<div class="flex flex-wrap items-center justify-between gap-y-2">
		<h1 class="page-title">{m.schedules_title()}</h1>
		<Button size="sm" onclick={openCreate}>{m.schedules_new()}</Button>
	</div>

	{#if schedules.loading}
		<div class="surface rounded-lg p-4">
			<Skeleton lines={4} />
		</div>
	{:else if schedules.error}
		<ErrorState description={schedules.error} onRetry={() => schedules.load()} />
	{:else if schedules.items.length === 0}
		<div class="surface rounded-lg">
			<EmptyState message={m.schedules_empty()} glyph="register" title={m.schedules_title()}>
				{#snippet action()}
					<Button size="sm" variant="ghost" onclick={openCreate}>{m.schedules_new()}</Button>
				{/snippet}
			</EmptyState>
		</div>
	{:else}
		<div class="surface rounded-lg divide-y divide-line">
			{#each schedules.items as s (s.id)}
				{@const status = statusOf(s)}
				<div class="p-4 space-y-2">
					<div class="flex items-center justify-between gap-3">
						<span class="text-sm font-medium text-ledger truncate">{s.name}</span>
						<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border figures text-xs {statusClass[status]}">
							{statusLabel[status]()}
						</span>
					</div>
					<div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-dim">
						<Money amount={s.kind === 'expense' ? -s.amount : s.amount} tone="dim" size="text-xs" />
						<span>{frequencyLabel(s.frequency)}</span>
						<span>{m.schedules_next_due()}: {s.next_due_date ? formatDate(s.next_due_date, settings.locale) : '—'}</span>
						<span>{m.schedules_last_posted()}: {s.last_posted_date ? formatDate(s.last_posted_date, settings.locale) : '—'}</span>
					</div>
					<div class="flex flex-wrap gap-2 pt-1">
						{#if s.errored_at !== null}
							<button type="button" onclick={() => resume(s)} class="min-h-9 inline-flex items-center text-xs text-phosphor hover:underline">
								{m.schedules_resume()}
							</button>
						{:else if s.completed === 0 && s.enabled === 0}
							<button type="button" onclick={() => resume(s)} class="min-h-9 inline-flex items-center text-xs text-phosphor hover:underline">
								{m.schedules_resume()}
							</button>
						{/if}
						{#if s.completed === 0}
							<button type="button" onclick={() => openEdit(s)} class="min-h-9 inline-flex items-center text-xs text-dim hover:underline">
								{m.common_edit()}
							</button>
						{/if}
						<button type="button" onclick={() => (confirmDelete = s)} class="min-h-9 inline-flex items-center text-xs text-debit hover:underline">
							{m.schedules_delete()}
						</button>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<Modal bind:open={showForm} title={editing ? m.common_edit() : m.schedules_new()}>
	<ScheduleForm
		schedule={editing}
		accounts={accountOptions}
		tags={tagOptions}
		onsubmit={handleSubmit}
		onclose={() => { showForm = false; editing = null; }}
	/>
</Modal>

<ConfirmDialog
	open={confirmDelete !== null}
	title={m.schedules_delete()}
	message={m.schedules_delete_confirm()}
	confirmLabel={m.schedules_delete()}
	danger={true}
	onconfirm={doDelete}
	onclose={() => (confirmDelete = null)}
/>
