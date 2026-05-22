<script lang="ts">
	let { onclick = () => {} }: { onclick?: () => void } = $props();
</script>

<button
	{onclick}
	class="fixed bottom-6 right-6 md:bottom-8 md:right-8 w-14 h-14 md:w-14 md:h-14 rounded-full bg-emerald-600 text-white shadow-lg flex items-center justify-center text-2xl hover:scale-105 transition-transform z-40"
	aria-label="Add transaction"
>
	+
</button>
