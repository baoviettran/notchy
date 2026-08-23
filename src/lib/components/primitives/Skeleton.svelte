<script lang="ts">
	let { lines = 3 }: { lines?: number } = $props();

	// The machine printing a tape: placeholder rows are mono cell-glyph runs
	// of varying width, not gray blocks. Decorative — hidden from the
	// accessibility tree; callers keep their own loading semantics.
	const TAPES = ['▮▯▯▯ ▮▯ ▮▯▯▯▯▯', '▮▯ ▮▯▯▯▯ ▮▯▯', '▮▯▯▯▯▯ ▮▯▯▯', '▮▯▯ ▮▯ ▮▯▯▯▯'];
</script>

<div class="space-y-3 py-2" aria-hidden="true">
	{#each Array(lines) as _, i}
		<p class="figures text-dim animate-pulse tracking-widest select-none">{TAPES[i % TAPES.length]}</p>
	{/each}
</div>
