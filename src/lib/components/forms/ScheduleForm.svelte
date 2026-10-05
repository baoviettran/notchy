<script lang="ts">
	import Button from '$lib/components/primitives/Button.svelte';
	import Input from '$lib/components/primitives/Input.svelte';
	import Select from '$lib/components/primitives/Select.svelte';
	import DatePicker from '$lib/components/primitives/DatePicker.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { toUpdateFields } from '$lib/stores/schedules.svelte';
	import { parseAmount } from '$lib/utils/number_parse';
	import { todayIso } from '$lib/utils/date';
	import { mapError } from '$lib/utils/errors';
	import type { Schedule, ScheduleKind, ScheduleFrequency, ScheduleUpdate } from '$lib/db/client';
	import * as m from '$lib/paraglide/messages';

	type Option = { id: string; name: string };

	let {
		schedule = null,
		accounts = [],
		tags = [],
		onsubmit = () => {},
		onclose = () => {}
	}: {
		schedule?: Schedule | null;
		accounts?: Option[];
		tags?: Option[];
		onsubmit?: (input: ScheduleUpdate) => void | Promise<void>;
		onclose?: () => void;
	} = $props();

	// Localise the label set: paraglide's tag is module state Svelte can't track,
	// so a live language switch needs this one tracked dependency to re-render.
	const L = $derived.by(() => {
		void settings.locale;
		return {
			kinds: [
				{ value: 'expense' as const, label: m.schedules_kind_expense() },
				{ value: 'income' as const, label: m.schedules_kind_income() },
				{ value: 'transfer' as const, label: m.schedules_kind_transfer() }
			],
			frequencies: [
				{ value: 'weekly' as const, label: m.schedules_freq_weekly() },
				{ value: 'biweekly' as const, label: m.schedules_freq_biweekly() },
				{ value: 'monthly' as const, label: m.schedules_freq_monthly() },
				{ value: 'yearly' as const, label: m.schedules_freq_yearly() }
			]
		};
	});

	let name = $state(schedule?.name ?? '');
	let kind = $state<ScheduleKind>(schedule?.kind ?? 'expense');
	let amount = $state(schedule ? String(schedule.amount) : '');
	let accountId = $state(schedule?.account_id ?? accounts[0]?.id ?? '');
	let transferAccountId = $state(schedule?.transfer_account_id ?? '');
	let tagId = $state(schedule?.tag_id ?? '');
	let payee = $state(schedule?.payee ?? '');
	let description = $state(schedule?.description ?? '');
	let frequency = $state<ScheduleFrequency>(schedule?.frequency ?? 'monthly');
	let startDate = $state(schedule?.start_date ?? todayIso());
	let endDate = $state(schedule?.end_date ?? '');
	let postsTransaction = $state(schedule?.posts_transaction ?? 1);
	let error = $state('');
	let saving = $state(false);

	// Accounts can arrive after the form opens (the page loads them on mount).
	// Default to the first one only while nothing has been chosen.
	$effect(() => {
		if (!accountId && accounts.length > 0) accountId = accounts[0].id;
	});

	const accountOptions = $derived(accounts.map((a) => ({ value: a.id, label: a.name })));
	const tagOptions = $derived([{ value: '', label: m.common_none() }, ...tags.map((t) => ({ value: t.id, label: t.name }))]);

	async function save() {
		if (saving) return;
		error = '';
		if (!name.trim()) { error = m.validation_name_required(); return; }

		let parsed: number;
		try {
			parsed = parseAmount(amount, settings.locale, settings.currency);
		} catch {
			error = m.validation_invalid_amount();
			return;
		}
		if (!accountId) { error = m.forms_select_account(); return; }
		if (kind === 'transfer' && !transferAccountId) { error = m.forms_select_destination(); return; }
		if (kind === 'transfer' && transferAccountId === accountId) { error = m.validation_source_dest_differ(); return; }

		// Build a complete ScheduleUpdate from the loaded row plus the edited
		// fields. `next_due_date` and `enabled` come from the stored row on edit;
		// a new schedule starts enabled with the repo defaulting its due date.
		//
		// A parked row (`errored_at !== null`) is the exception to `enabled`: both
		// adapters clear `errored_at` whenever `enabled = 1`, so echoing the stored
		// `enabled` would make Edit a second resume path and silently un-park the
		// schedule. Submit `enabled: 0` instead — the row's Resume control is the
		// one explicit un-park. `errored_at` is read off the raw `schedule` prop,
		// not `toUpdateFields`, which deliberately omits the park marker.
		const parked = schedule?.errored_at != null;
		const base = schedule ? toUpdateFields(schedule) : null;
		const input: ScheduleUpdate = {
			name: name.trim(),
			kind,
			amount: parsed,
			account_id: accountId,
			transfer_account_id: kind === 'transfer' ? transferAccountId : null,
			tag_id: kind === 'transfer' ? null : tagId || null,
			payee: payee.trim() || null,
			description: description.trim() || null,
			frequency,
			start_date: startDate,
			end_date: endDate || null,
			posts_transaction: postsTransaction,
			enabled: parked ? 0 : base ? base.enabled : 1,
			next_due_date: base ? base.next_due_date : null
		};

		saving = true;
		try {
			await onsubmit(input);
		} catch (e) {
			error = mapError(e);
		} finally {
			saving = false;
		}
	}
</script>

<form class="space-y-4" onsubmit={(e) => { e.preventDefault(); save(); }}>
	{#if error}<p class="text-sm text-debit" role="alert">{error}</p>{/if}

	<Input label={m.schedules_name()} bind:value={name} maxlength={64} />
	<Input label={m.schedules_amount()} bind:value={amount} placeholder={m.forms_amount_placeholder()} />

	<div class="space-y-2" role="radiogroup" aria-label={m.schedules_kind()}>
		<div class="flex flex-wrap gap-2">
			{#each L.kinds as k}
				<label class="inline-flex items-center gap-2 min-h-9 pointer-coarse:min-h-11 px-3 text-sm rounded-md border transition-colors cursor-pointer
					{kind === k.value ? 'border-phosphor bg-phosphor/10 text-phosphor-bright font-medium' : 'border-line text-dim hover:text-ledger'}">
					<input type="radio" name="schedule-kind" value={k.value} bind:group={kind} class="sr-only" />
					{k.label}
				</label>
			{/each}
		</div>
	</div>

	<Select label={m.schedules_frequency()} bind:value={frequency} options={L.frequencies} />

	{#if kind === 'transfer'}
		<Select label={m.schedules_account()} bind:value={accountId} options={accountOptions} />
		<Select label={m.schedules_transfer_account()} bind:value={transferAccountId} options={accountOptions} />
	{:else}
		<Select label={m.schedules_account()} bind:value={accountId} options={accountOptions} />
		<Select label={m.schedules_category()} bind:value={tagId} options={tagOptions} />
	{/if}

	<Input label={m.schedules_payee()} bind:value={payee} maxlength={64} />
	<Input label={m.schedules_description()} bind:value={description} maxlength={256} />

	<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
		<DatePicker label={m.schedules_start_date()} bind:value={startDate} />
		<DatePicker label={m.schedules_end_date()} bind:value={endDate} />
	</div>

	<div class="space-y-2">
		<label class="flex items-center gap-2 text-sm text-ledger">
			<input type="radio" name="schedule-posts" value={1} bind:group={postsTransaction} />
			{m.schedules_posts_transaction()}
		</label>
		<label class="flex items-center gap-2 text-sm text-ledger">
			<input type="radio" name="schedule-posts" value={0} bind:group={postsTransaction} />
			{m.schedules_reminder_only()}
		</label>
	</div>

	<div class="flex justify-end gap-2 pt-2">
		<Button variant="ghost" onclick={onclose}>{m.schedules_cancel()}</Button>
		<Button type="submit" disabled={saving}>{m.schedules_save()}</Button>
	</div>
</form>
