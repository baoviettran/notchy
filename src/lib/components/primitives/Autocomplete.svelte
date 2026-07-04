<script lang="ts">
	let { label = '', value = $bindable(''), options = [], placeholder = '', allowFreeText = false, onselect = (_v: string) => {} }: {
		label?: string;
		value?: string;
		options: { value: string; label: string }[];
		placeholder?: string;
		allowFreeText?: boolean;
		onselect?: (value: string) => void;
	} = $props();

	// Two modes share one component:
	//  - id mode (allowFreeText=false, e.g. Tag → tagId ULID): `value` holds an
	//    option id; `query` is transient typing used only to filter the listbox,
	//    and is discarded on blur (the input reverts to the selected option's
	//    label). Typing never corrupts the id.
	//  - free-text mode (allowFreeText=true, e.g. Payee): `value` IS the text.
	//    The input binds directly to `value` so every keystroke keeps it live —
	//    a novel value survives a save even if blur's close-on-click timer is
	//    still pending. `query` is unused here; filtering reads `value`.
	let query = $state('');
	let open = $state(false);
	let inputEl: HTMLInputElement;
	const listboxId = `listbox-${Math.random().toString(36).slice(2, 9)}`;
	const inputId = `ac-${Math.random().toString(36).slice(2, 9)}`;

	// The filter term: free-text filters on the live value; id mode filters on
	// the transient query typed since focus.
	let term = $derived(allowFreeText ? value : query);
	let filtered = $derived(
		term
			? options.filter((o) => o.label.toLowerCase().includes(term.toLowerCase())).slice(0, 8)
			: options.slice(0, 8)
	);

	let displayValue = $derived(options.find((o) => o.value === value)?.label ?? '');

	function onFocus() { open = true; query = ''; }
	function onBlur() {
		// Close on a short delay so an option click (mousedown) isn't pre-empted
		// by the input blur. id mode discards the transient query; free-text
		// mode keeps `value` as-is (it already tracks the input).
		setTimeout(() => { open = false; query = ''; }, 150);
	}
	function onInput(e: Event) {
		const v = (e.target as HTMLInputElement).value;
		if (allowFreeText) {
			value = v;
		} else {
			query = v;
		}
		open = true;
	}

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
		{placeholder}
		value={allowFreeText ? value : (open ? query : displayValue)}
		oninput={onInput}
		onfocus={onFocus}
		onblur={onBlur}
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
