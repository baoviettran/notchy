<script lang="ts">
	import Select from '$lib/components/primitives/Select.svelte';
	import Input from '$lib/components/primitives/Input.svelte';
	import { accounts } from '$lib/stores/accounts.svelte';
	import { categories } from '$lib/stores/categories.svelte';
	import * as m from '$lib/paraglide/messages';

	let {
		filterKind = $bindable(''),
		filterAccount = $bindable(''),
		filterTag = $bindable(''),
		filterMonth = $bindable('')
	}: {
		filterKind?: string;
		filterAccount?: string;
		filterTag?: string;
		filterMonth?: string;
	} = $props();
</script>

<div class="flex flex-wrap gap-3">
	<div class="min-w-36 max-w-52 flex-1">
		<Select
			label={m.transactions_filter_kind()}
			bind:value={filterKind}
			options={[
				{ value: '', label: m.transactions_filter_all_kinds() },
				{ value: 'expense', label: m.forms_expense() },
				{ value: 'income', label: m.forms_income() },
				{ value: 'transfer', label: m.forms_transfer() },
				{ value: 'refund', label: m.forms_refund() },
				{ value: 'adjustment', label: m.forms_adjustment() }
			]}
		/>
	</div>
	<div class="min-w-36 max-w-52 flex-1">
		<Select
			label={m.transactions_filter_account()}
			bind:value={filterAccount}
			options={[{ value: '', label: m.transactions_filter_all_accounts() }, ...accounts.items.map((a) => ({ value: a.id, label: a.name }))]}
		/>
	</div>
	<div class="min-w-36 max-w-52 flex-1">
		<Select
			label={m.transactions_filter_tag()}
			bind:value={filterTag}
			options={[{ value: '', label: m.transactions_filter_all_tags() }, ...categories.tags.map((t) => ({ value: t.id, label: t.name }))]}
		/>
	</div>
	<div class="min-w-36 max-w-52 flex-1">
		<Input type="month" label={m.transactions_filter_month()} bind:value={filterMonth} />
	</div>
</div>
