<script lang="ts">
	import { getDb } from '$lib/db';
	import type { OverviewReport } from '$lib/db/client';
	import Skeleton from '$lib/components/primitives/Skeleton.svelte';
	import TapeLine from '$lib/components/reports/TapeLine.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { formatCurrency, formatCurrencyCompact, isLongCurrency } from '$lib/utils/currency';
	import { seriesColor } from '$lib/utils/palette';
	import * as m from '$lib/paraglide/messages';
	import ReportsNav from '$lib/components/layout/ReportsNav.svelte';

	let report = $state<OverviewReport | null>(null);
	let loaded = $state(false);
	let includeAdjustments = $state(false);

	// Stable per-bucket ordering so a bucket keeps one ink across months.
	const bucketRank = ['Essentials', 'Learning & Entertainment', 'Saving & Investment', 'Adjustments'];

	// The ledger's own minus (−), never Intl's hyphen: sign is a glyph in
	// this system, paired with tone so color never carries it alone.
	function fmt(amount: number): string {
		const magnitude = Math.abs(amount);
		const figure = isLongCurrency(magnitude, settings.currency, settings.locale)
			? formatCurrencyCompact(magnitude, settings.currency, settings.locale)
			: formatCurrency(magnitude, settings.currency, settings.locale);
		return (amount < 0 ? '−' : '') + figure;
	}

	let totalSpending = $derived(report?.spending_by_bucket.reduce((s, b) => s + b.total, 0) ?? 0);

	function bucketPct(total: number): number {
		return totalSpending > 0 ? Math.round((total / totalSpending) * 100) : 0;
	}

	function currentMonth() {
		const d = new Date();
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
	}

	async function load() {
		const db = getDb();
		report = await db.reports.getOverview(currentMonth(), includeAdjustments);
		loaded = true;
	}

	$effect(() => { includeAdjustments; load(); });
</script>

<div class="space-y-6">
	<h1 class="figures text-xl text-ledger tracking-wide">{m.reports_title()}</h1>

	<!-- The nav owns its band: seven tabs wrapping beside the title turned
	     every reports header into a ragged block. -->
	<ReportsNav />

	<label class="flex items-center gap-2 text-sm text-dim">
		<input type="checkbox" bind:checked={includeAdjustments} class="rounded" />
		{m.reports_include_adjustments()}
	</label>

	{#if !loaded}
		<div class="surface rounded-lg p-5">
			<Skeleton lines={6} />
		</div>
	{:else if report}
		<!-- THE STATEMENT: one tape. Income, expense lines with leaders,
		     ruled subtotal, and the net as the machine's grand total. -->
		<section class="surface rounded-lg p-5" aria-label={m.reports_net_cash_flow()}>
			<div class="flex items-baseline justify-between mb-3">
				<span class="plate">{m.reports_overview()} · {currentMonth()}</span>
				<span class="plate">▮▯▯▯</span>
			</div>

			<TapeLine label={m.reports_income()} amount={fmt(report.total_income)} tone="phosphor" variant="subtotal" />

			<div class="mt-2">
				<p class="plate mb-1">{m.reports_expenses()}</p>
				{#each report.spending_by_bucket as b (b.name)}
					<TapeLine label={b.name} amount={fmt(b.total)} tone="dim" title={formatCurrency(b.total, settings.currency, settings.locale)} />
				{/each}
				<TapeLine label={m.reports_subtotal()} amount={fmt(report.total_expense)} tone="debit" variant="subtotal" />
			</div>

			<TapeLine
				label={m.reports_net_cash_flow()}
				amount={fmt(report.net_cash_flow)}
				tone={report.net_cash_flow >= 0 ? 'phosphor' : 'debit'}
				variant="total"
			/>
		</section>

		{#if report.spending_by_bucket.length > 0}
			<!-- COMPOSITION: stacked tape segments, not a pie. One bar of the
			     machine's own inks; the ruled lines below are the data, so the
			     meter stays decorative and the numbers stay accessible. -->
			<section class="surface rounded-lg p-4">
				<h2 class="plate mb-3">{m.reports_spending_by_bucket()}</h2>
				<div
					class="flex h-3 w-full overflow-hidden rounded-full border border-line/60 mb-4"
					role="presentation"
					aria-hidden="true"
				>
					{#each report.spending_by_bucket as b (b.name)}
						<div style="width: {bucketPct(b.total)}%; background: {seriesColor(bucketRank.indexOf(b.name))}"></div>
					{/each}
				</div>
				{#each report.spending_by_bucket as b (b.name)}
					<TapeLine
						label={b.name}
						amount={fmt(b.total)}
						note="{bucketPct(b.total)}%"
						tone="dim"
						title={formatCurrency(b.total, settings.currency, settings.locale)}
					/>
				{/each}
				<TapeLine label={m.reports_subtotal()} amount={fmt(totalSpending)} tone="ledger" variant="subtotal" />
			</section>
		{/if}

		{#if report.top_categories.length > 0}
			<section class="surface rounded-lg p-4">
				<h2 class="plate mb-3">{m.reports_top_categories()}</h2>
				{#each report.top_categories as c}
					<TapeLine label={c.name} amount={fmt(c.total)} tone="dim" title={formatCurrency(c.total, settings.currency, settings.locale)} />
				{/each}
			</section>
		{/if}

		{#if report.top_transactions.length > 0}
			<section class="surface rounded-lg p-4">
				<h2 class="plate mb-3">{m.reports_top_transactions()}</h2>
				{#each report.top_transactions as tx}
					<TapeLine label={tx.payee || m.reports_no_payee()} amount={'−' + fmt(tx.amount)} tone="debit" title={formatCurrency(tx.amount, settings.currency, settings.locale)} />
				{/each}
			</section>
		{/if}

		{#if report.spending_by_bucket.length === 0 && report.top_transactions.length === 0}
			<div class="bg-tape rounded-lg border border-line p-6 text-center text-dim">
				<p class="text-sm">{m.reports_empty()}</p>
			</div>
		{/if}
	{/if}
</div>
