<script lang="ts">
	import { onMount } from 'svelte';
	import Button from '$lib/components/primitives/Button.svelte';
	import Skeleton from '$lib/components/primitives/Skeleton.svelte';
	import EmptyState from '$lib/components/primitives/EmptyState.svelte';
	import ErrorState from '$lib/components/primitives/ErrorState.svelte';
	import { categories, systemName } from '$lib/stores/categories.svelte';
	import { rules } from '$lib/stores/rules.svelte';
	import { ruleUI } from '$lib/stores/rule-ui.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { mapError } from '$lib/utils/errors';
	import type { CategorizeRule } from '$lib/db/client';
	import * as m from '$lib/paraglide/messages';

	let toggling = $state(false);
	const visible = $derived(rules.items.filter(r => r.deleted_at === null));
	const learnedCount = $derived(visible.filter(r => r.source === 'learned').length);
	const loading = $derived(rules.loading || categories.loading);
	const error = $derived(rules.error || categories.error);
	const busy = $derived(ruleUI.saving || toggling);
	const modeLabel = { is: m.rules_match_is, starts_with: m.rules_match_starts_with, contains: m.rules_match_contains };

	async function load() { await Promise.all([rules.load(), categories.load()]); }
	onMount(() => { void load(); });
	async function toggle(rule: CategorizeRule) {
		if (busy) return;
		toggling = true;
		try { await rules.update(rule.id, { enabled: rule.enabled ? 0 : 1 }); }
		catch (e) { toast.show(mapError(e)); }
		finally { toggling = false; }
	}
</script>

<div class="space-y-6">
	<a href="/settings" class="text-xs text-dim hover:text-phosphor">← {m.nav_settings()}</a>
	<div class="flex flex-wrap items-start justify-between gap-4">
		<div class="space-y-2">
			<h1 class="page-title">{m.rules_title()}</h1>
			<p class="text-sm text-dim max-w-xl">{m.rules_future_only()}</p>
		</div>
		<Button size="sm" disabled={loading || !!error || busy} onclick={() => ruleUI.openEditor()}>{m.rules_add()}</Button>
	</div>
	{#if loading}
		<div class="surface rounded-lg p-4"><Skeleton lines={5} /></div>
	{:else if error}
		<ErrorState description={error} onRetry={load} />
	{:else if visible.length === 0}
		<div class="surface rounded-lg"><EmptyState glyph="register" title={m.rules_empty_title()} message={m.rules_empty_description()} /></div>
	{:else}
		<ul aria-label={m.rules_title()} class="space-y-3">
			{#each visible as rule (rule.id)}
				<li class="surface rounded-lg p-4 space-y-3">
					<div class="flex flex-wrap items-start justify-between gap-3">
						<div class="min-w-0 space-y-1">
							<p class="font-medium text-ledger break-words">{rule.payee_term}</p>
							<p class="text-sm text-dim break-words">{modeLabel[rule.match_mode]()} → {systemName(rule.tag_id) ?? categories.tags.find(t => t.id === rule.tag_id)?.name ?? m.rules_missing_tag()}</p>
						</div>
						<span class="plate text-dim">{rule.source === 'manual' ? m.rules_manual() : m.rules_learned()}</span>
					</div>
					<div class="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
						<button type="button" role="switch" aria-checked={rule.enabled === 1} aria-label={m.rules_toggle_label({ payee: rule.payee_term })}
							disabled={busy} onclick={() => toggle(rule)}
							class="rounded-md border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-phosphor disabled:opacity-50 {rule.enabled ? 'border-phosphor text-phosphor bg-phosphor/10' : 'border-line text-dim'}">
							{rule.enabled ? m.rules_enabled() : m.rules_disabled()}
						</button>
						<div class="flex gap-2">
							<button type="button" disabled={busy} onclick={() => ruleUI.openEditor(rule)} aria-label={m.rules_edit_label({ payee: rule.payee_term })} class="text-sm text-ledger rounded-md px-3 py-2 hover:bg-line/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-phosphor disabled:opacity-50">{m.common_edit()}</button>
							<button type="button" disabled={busy} onclick={() => ruleUI.deleteTarget = rule} aria-label={m.rules_delete_label({ payee: rule.payee_term })} class="text-sm text-debit rounded-md px-3 py-2 hover:bg-line/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-phosphor disabled:opacity-50">{m.common_delete()}</button>
						</div>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
	<div class="border-t border-line pt-4 space-y-2">
		<Button variant="secondary" size="sm" disabled={loading || !!error || busy || learnedCount === 0} onclick={() => ruleUI.clearOpen = true}>{m.rules_clear()}</Button>
		<p class="text-xs text-dim max-w-xl">{m.rules_clear_hint()}</p>
	</div>
</div>
