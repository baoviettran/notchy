<script lang="ts">
	import { untrack } from 'svelte';
	import Input from '$lib/components/primitives/Input.svelte';
	import Select from '$lib/components/primitives/Select.svelte';
	import Button from '$lib/components/primitives/Button.svelte';
	import { rules } from '$lib/stores/rules.svelte';
	import { ruleUI } from '$lib/stores/rule-ui.svelte';
	import { categories, systemName } from '$lib/stores/categories.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { label } from '$lib/utils/i18n.svelte';
	import { mapError } from '$lib/utils/errors';
	import type { CategorizeRule } from '$lib/db/client';
	import * as m from '$lib/paraglide/messages';

	let { existing = null, onclose }: { existing?: CategorizeRule | null; onclose: () => void } = $props();
	let payeeTerm = $state(untrack(() => existing?.payee_term ?? ''));
	let matchMode = $state(untrack(() => existing?.match_mode ?? 'is'));
	let tagId = $state(untrack(() => existing?.tag_id ?? ''));
	let invalid = $state(false);
	let error = $state<unknown>(null);

	const modes = $derived.by(() => {
		void settings.locale;
		return [
			{ value: 'is', label: m.rules_match_is() },
			{ value: 'starts_with', label: m.rules_match_starts_with() },
			{ value: 'contains', label: m.rules_match_contains() }
		];
	});
	const tags = $derived.by(() => {
		void settings.locale;
		return [
			{ value: '', label: m.rules_choose_tag() },
			...categories.tags.map(t => ({ value: t.id, label: systemName(t.id) ?? t.name }))
		];
	});

	async function save() {
		if (ruleUI.saving) return;
		invalid = !payeeTerm.trim() || !categories.tags.some(t => t.id === tagId);
		if (invalid) return;
		ruleUI.saving = true;
		error = null;
		try {
			const fields = { payee_term: payeeTerm.trim(), match_mode: matchMode, tag_id: tagId };
			if (existing) await rules.update(existing.id, fields);
			else await rules.create({ ...fields, source: 'manual' });
			onclose();
		} catch (e) {
			error = e;
		} finally {
			ruleUI.saving = false;
		}
	}
</script>

<form class="space-y-4" onsubmit={(event) => { event.preventDefault(); void save(); }}>
	<p class="text-sm text-dim">{label(() => m.rules_future_only())}</p>
	{#if invalid}<p role="alert" class="text-sm text-debit">{label(() => m.rules_fields_required())}</p>{/if}
	{#if error}<p role="alert" class="text-sm text-debit">{label(() => mapError(error))}</p>{/if}
	<Input label={label(() => m.rules_payee_text())} bind:value={payeeTerm} maxlength={128} autofocus disabled={ruleUI.saving} />
	<Select label={label(() => m.rules_match())} bind:value={matchMode} options={modes} disabled={ruleUI.saving} />
	<Select label={label(() => m.forms_tag())} bind:value={tagId} options={tags} disabled={ruleUI.saving} />
	<div class="flex justify-end gap-2 pt-2">
		<Button variant="ghost" onclick={onclose} disabled={ruleUI.saving}>{label(() => m.common_cancel())}</Button>
		<Button type="submit" disabled={ruleUI.saving}>{label(() => ruleUI.saving ? m.forms_saving() : m.common_save())}</Button>
	</div>
</form>
