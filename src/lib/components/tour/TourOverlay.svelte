<!-- src/lib/components/tour/TourOverlay.svelte -->
<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { tour } from '$lib/stores/tour.svelte';
	import { TOUR_STEPS } from '$lib/tour/steps';
	import * as m from '$lib/paraglide/messages';

	let tooltipPos = $state({ top: 0, left: 0 });
	let targetRect = $state<DOMRect | null>(null);
	const TOOLTIP_WIDTH = 320; // w-80
	const TOOLTIP_MARGIN = 8;

	const mKeys: Record<string, () => string> = {
		tour_net_title: () => m.tour_net_title(),
		tour_net_body: () => m.tour_net_body(),
		tour_add_title: () => m.tour_add_title(),
		tour_add_body: () => m.tour_add_body(),
		tour_transactions_title: () => m.tour_transactions_title(),
		tour_transactions_body: () => m.tour_transactions_body(),
		tour_budgets_title: () => m.tour_budgets_title(),
		tour_budgets_body: () => m.tour_budgets_body(),
		tour_more_title: () => m.tour_more_title(),
		tour_more_body: () => m.tour_more_body()
	};

	function title(): string {
		const step = TOUR_STEPS[tour.currentStep];
		return mKeys[step.titleKey]?.() ?? step.titleKey;
	}

	function body(): string {
		const step = TOUR_STEPS[tour.currentStep];
		return mKeys[step.bodyKey]?.() ?? step.bodyKey;
	}

	function findTarget(): Element | null {
		const step = TOUR_STEPS[tour.currentStep];
		for (const selector of step.targets) {
			const els = document.querySelectorAll(selector);
			for (const el of els) {
				const rect = el.getBoundingClientRect();
				if (rect.width > 0 && rect.height > 0) return el;
			}
		}
		return null;
	}

	function measure() {
		const target = findTarget();
		if (target) {
			targetRect = target.getBoundingClientRect();
			// Position tooltip below or above the target
			const spaceBelow = window.innerHeight - targetRect.bottom;
			const top = spaceBelow > 200 ? targetRect.bottom + 12 : targetRect.top - 12;
			const left = Math.max(
				TOOLTIP_MARGIN,
				Math.min(targetRect.left, window.innerWidth - TOOLTIP_WIDTH - TOOLTIP_MARGIN)
			);
			tooltipPos = { top, left };
		} else {
			// No visible target — center the tooltip
			targetRect = null;
			tooltipPos = {
				top: window.innerHeight / 2 - 80,
				left: (window.innerWidth - TOOLTIP_WIDTH) / 2
			};
		}
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			tour.skip();
		}
	}

	onMount(() => {
		measure();
		window.addEventListener('resize', measure);
		window.addEventListener('scroll', measure, true);
	});

	onDestroy(() => {
		window.removeEventListener('resize', measure);
		window.removeEventListener('scroll', measure, true);
	});

	// Re-measure when step changes
	$effect(() => {
		void tour.currentStep;
		measure();
	});
</script>

<svelte:window onkeydown={onKeydown} />

{#if tour.active}
	<!-- Backdrop with cutout -->
	<div class="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={title()}>
		<!-- SVG backdrop with a hole cut around the target -->
		<svg class="absolute inset-0 w-full h-full" aria-hidden="true">
			<defs>
				<mask id="tour-mask">
					<rect width="100%" height="100%" fill="white" />
					{#if targetRect}
						<rect
							x={targetRect.x - 4}
							y={targetRect.y - 4}
							width={targetRect.width + 8}
							height={targetRect.height + 8}
							rx="8"
							fill="black"
						/>
					{/if}
				</mask>
			</defs>
			<rect width="100%" height="100%" fill="rgba(0,0,0,0.6)" mask="url(#tour-mask)" />
		</svg>

		<!-- Highlight ring around target -->
		{#if targetRect}
			<div
				class="absolute rounded-lg border-2 border-phosphor pointer-events-none transition-all duration-200"
				style="top: {targetRect.y - 4}px; left: {targetRect.x - 4}px; width: {targetRect.width + 8}px; height: {targetRect.height + 8}px;"
			></div>
		{/if}

		<!-- Tooltip -->
		<div
			class="absolute z-10 w-80 max-w-[calc(100vw-2rem)] surface rounded-lg border border-line p-4 shadow-xl"
			style="top: {tooltipPos.top}px; left: {tooltipPos.left}px;"
		>
			<h3 class="plate text-ledger text-base mb-1">{title()}</h3>
			<p class="text-sm text-dim mb-4">{body()}</p>
			<div class="flex items-center justify-between">
				<span class="text-xs text-dim figures"
					>{m.tour_progress({
						current: String(tour.currentStep + 1),
						total: String(TOUR_STEPS.length)
					})}</span
				>
				<div class="flex gap-2">
					<button
						onclick={() => tour.skip()}
						class="px-3 py-1 text-sm rounded-md text-dim hover:text-ledger transition-colors"
						>{m.tour_skip()}</button
					>
					<button
						onclick={() => tour.back()}
						disabled={tour.currentStep === 0}
						class="px-3 py-1 text-sm rounded-md border border-line text-dim hover:text-ledger disabled:opacity-30 transition-colors"
						>{m.tour_back()}</button
					>
					{#if tour.currentStep >= TOUR_STEPS.length - 1}
						<button
							onclick={() => tour.finish()}
							class="px-3 py-1 text-sm rounded-md bg-phosphor text-ink font-medium hover:bg-phosphor-bright transition-colors"
							>{m.tour_finish()}</button
						>
					{:else}
						<button
							onclick={() => tour.next()}
							class="px-3 py-1 text-sm rounded-md bg-phosphor text-ink font-medium hover:bg-phosphor-bright transition-colors"
							>{m.tour_next()}</button
						>
					{/if}
				</div>
			</div>
		</div>
	</div>
{/if}
