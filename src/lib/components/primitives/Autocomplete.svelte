<script lang="ts">
	let { label = '', value = $bindable(''), options = [], placeholder = '', onselect = (_v: string) => {} }: {
		label?: string;
		value?: string;
		options: { value: string; label: string }[];
		placeholder?: string;
		onselect?: (value: string) => void;
	} = $props();

	let query = $state('');
	let open = $state(false);
	let inputEl: HTMLInputElement;
	const listboxId = `listbox-${Math.random().toString(36).slice(2, 9)}`;
	const inputId = `ac-${Math.random().toString(36).slice(2, 9)}`;

	let filtered = $derived(
		query
			? options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase())).slice(0, 8)
			: options.slice(0, 8)
	);

	let displayValue = $derived(options.find((o) => o.value === value)?.label ?? '');

	function onFocus() { open = true; query = ''; }
	function onBlur() { setTimeout(() => { open = false; }, 150); }
	function onInput(e: Event) { query = (e.target as HTMLInputElement).value; open = true; }

	function select(opt: { value: string; label: string }) {
		value = opt.value;
		query = '';
		open = false;
		onselect(opt.value);
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') { open = false; inputEl?.blur(); }
	}
</script>

<div class="relative space-y-1">
	{#if label}
		<label for={inputId} class="plate block">{label}</label>
	{/if}
	<input
		id={inputId}
		bind:this={inputEl}
		type="text"
		value={open ? query : displayValue}
		{placeholder}
		onfocus={onFocus}
		onblur={onBlur}
		oninput={onInput}
		onkeydown={onKeydown}
		class="w-full px-3 py-2 text-base rounded-md border border-line bg-ink text-ledger"
		role="combobox"
		aria-expanded={open}
		aria-controls={listboxId}
		autocomplete="off"
	/>
	{#if open && filtered.length > 0}
		<ul id={listboxId} class="absolute z-20 w-full mt-1 bg-tape border border-line rounded-lg shadow-lg max-h-48 overflow-y-auto animate-scale-in" role="listbox">
			{#each filtered as opt}
				<li>
					<button
						type="button"
						onmousedown={() => select(opt)}
						class="w-full text-left px-3 py-2 text-sm hover:bg-line/40 transition-colors {opt.value === value ? 'text-phosphor font-medium' : 'text-ledger'}"
						role="option"
						aria-selected={opt.value === value}
					>{opt.label}</button>
				</li>
			{/each}
		</ul>
	{/if}
</div>
