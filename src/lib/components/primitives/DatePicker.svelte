<script lang="ts">
	import { tick } from 'svelte';
	import { createFocusTrap } from '$lib/utils/focusTrap';
	import * as m from '$lib/paraglide/messages';
	import { languageTag } from '$lib/paraglide/runtime';

	let { value = $bindable(''), label = '', disabled = false }: {
		value?: string; label?: string; disabled?: boolean;
	} = $props();

	const focusTrap = createFocusTrap();
	let panelEl = $state<HTMLElement>();
	let buttonEl = $state<HTMLElement>();
	let panelStyle = $state('');
	const pickerId = `dp-${Math.random().toString(36).slice(2, 9)}`;

	// Parse value into date parts
	let viewYear = $state(0);
	let viewMonth = $state(0); // 0-indexed
	// Keyboard-focused day within the calendar grid
	let focusedDay = $state(0);

	function initFromValue() {
		if (value) {
			const [y, m] = value.split('-').map(Number);
			viewYear = y;
			viewMonth = m - 1;
		} else {
			const now = new Date();
			viewYear = now.getFullYear();
			viewMonth = now.getMonth();
		}
	}

	initFromValue();

	const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
	const MONTHS = $derived.by(() => {
		const loc = languageTag();
		return Array.from({ length: 12 }, (_, i) =>
			new Intl.DateTimeFormat(loc === 'vi' ? 'vi-VN' : 'en-US', { month: 'long' }).format(new Date(2000, i, 1))
		);
	});

	const calendarDays = $derived.by(() => {
		const firstDay = new Date(viewYear, viewMonth, 1);
		const lastDay = new Date(viewYear, viewMonth + 1, 0);
		const daysInMonth = lastDay.getDate();
		// getDay(): 0=Sun. Convert to Mon-start (0=Mon, 6=Sun).
		let startDow = firstDay.getDay() - 1;
		if (startDow < 0) startDow = 6;

		const days: { day: number; key: string }[] = [];
		// Leading blanks
		for (let i = 0; i < startDow; i++) {
			days.push({ day: 0, key: `blank-${i}` });
		}
		for (let d = 1; d <= daysInMonth; d++) {
			days.push({ day: d, key: `${viewYear}-${viewMonth}-${d}` });
		}
		return days;
	});

	const selectedDay = $derived.by(() => {
		if (!value) return null;
		const [y, m, d] = value.split('-').map(Number);
		return y === viewYear && m - 1 === viewMonth ? d : null;
	});

	const today = $derived(new Date().toISOString().split('T')[0]);

	function prevMonth() {
		if (viewMonth === 0) { viewMonth = 11; viewYear--; }
		else { viewMonth--; }
	}

	function nextMonth() {
		if (viewMonth === 11) { viewMonth = 0; viewYear++; }
		else { viewMonth++; }
	}

	function selectDay(day: number) {
		if (day === 0) return;
		const m = String(viewMonth + 1).padStart(2, '0');
		const d = String(day).padStart(2, '0');
		value = `${viewYear}-${m}-${d}`;
		open = false;
	}

	function selectToday() {
		const now = new Date();
		viewYear = now.getFullYear();
		viewMonth = now.getMonth();
		const m = String(viewMonth + 1).padStart(2, '0');
		const d = String(now.getDate()).padStart(2, '0');
		value = `${viewYear}-${m}-${d}`;
		open = false;
	}

	function clearDate() {
		value = '';
		open = false;
	}

	// --- Keyboard navigation within the calendar grid ---
	function daysInMonth(y: number, m: number) {
		return new Date(y, m + 1, 0).getDate();
	}

	function moveFocus(delta: number) {
		const cur = focusedDay || 1;
		let d = cur + delta;
		let y = viewYear;
		let m = viewMonth;
		let total = daysInMonth(y, m);
		while (d > total) { d -= total; m++; if (m > 11) { m = 0; y++; } total = daysInMonth(y, m); }
		while (d < 1) { m--; if (m < 0) { m = 11; y--; } d += daysInMonth(y, m); }
		viewYear = y;
		viewMonth = m;
		focusedDay = d;
	}

	function onCalendarKeydown(e: KeyboardEvent) {
		const day = focusedDay || selectedDay || 1;
		focusedDay = day;
		switch (e.key) {
			case 'ArrowLeft': e.preventDefault(); moveFocus(-1); break;
			case 'ArrowRight': e.preventDefault(); moveFocus(1); break;
			case 'ArrowUp': e.preventDefault(); moveFocus(-7); break;
			case 'ArrowDown': e.preventDefault(); moveFocus(7); break;
			case 'Home': e.preventDefault(); focusedDay = 1; break;
			case 'End': e.preventDefault(); focusedDay = daysInMonth(viewYear, viewMonth); break;
			case 'PageUp': e.preventDefault(); prevMonth(); focusedDay = Math.min(focusedDay || 1, daysInMonth(viewYear, viewMonth)); break;
			case 'PageDown': e.preventDefault(); nextMonth(); focusedDay = Math.min(focusedDay || 1, daysInMonth(viewYear, viewMonth)); break;
			case 'Enter':
			case ' ': e.preventDefault(); if (focusedDay) selectDay(focusedDay); break;
		}
	}

	let open = $state(false);

	function positionPanel() {
		if (!buttonEl) return;
		const rect = buttonEl.getBoundingClientRect();
		const gap = 4;
		let top = rect.bottom + gap;
		let left = rect.left;
		// Clamp to viewport so the panel never clips off-screen.
		const panelW = 288; // w-72 = 18rem = 288px
		// Measure actual rendered height instead of hardcoding.
		const panelH = panelEl?.offsetHeight ?? 376;
		if (left + panelW > window.innerWidth) left = window.innerWidth - panelW - 8;
		if (left < 8) left = 8;
		if (top + panelH > window.innerHeight) top = rect.top - panelH - gap;
		panelStyle = `position:fixed;top:${top}px;left:${left}px;`;
	}

	function toggleOpen() {
		if (disabled) return;
		if (!open) {
			initFromValue();
			// Start keyboard focus on the selected day, today, or the 1st
			focusedDay = selectedDay || new Date().getDate();
			if (focusedDay > daysInMonth(viewYear, viewMonth)) focusedDay = 1;
			open = true;
		} else {
			open = false;
		}
	}

	// Position the panel after Svelte renders it. tick() waits for the DOM
	// update so panelEl has its actual rendered height for viewport clamping.
	$effect(() => {
		if (open) {
			tick().then(() => {
				positionPanel();
				if (panelEl) focusTrap.enter(() => panelEl);
				// Focus the keyboard-active day cell
				const active = panelEl?.querySelector<HTMLElement>('[tabindex="0"]');
				active?.focus();
			});
		}
	});

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') { open = false; return; }
		if (panelEl) focusTrap.trap(e, panelEl);
	}

	// Format display value using locale-aware date formatting.
	// vi-VN → dd/mm/yyyy, en-US → mm/dd/yyyy — matches the rest of the app.
	const dateFormatter = $derived.by(() => {
		const loc = languageTag();
		return new Intl.DateTimeFormat(loc === 'vi' ? 'vi-VN' : 'en-US', {
			year: 'numeric', month: '2-digit', day: '2-digit'
		});
	});
	const displayValue = $derived.by(() => {
		if (!value) return '';
		const [y, m, d] = value.split('-').map(Number);
		return dateFormatter.format(new Date(y, Number(m) - 1, Number(d)));
	});
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<svelte:window onkeydown={(e) => { if (open) onKeydown(e); }} />

<div class="space-y-1.5 relative">
	{#if label}
		<label for={pickerId} class="plate block">{label}</label>
	{/if}
	<button
		type="button"
		id={pickerId}
		bind:this={buttonEl}
		onclick={toggleOpen}
		{disabled}
		class="w-full px-3 py-2 text-base rounded-md border text-left transition-colors
			border-line bg-ink text-ledger
			disabled:opacity-50 disabled:cursor-not-allowed
			focus-visible:outline-none focus-visible:border-phosphor"
		aria-haspopup="dialog"
		aria-expanded={open}
	>
		{#if displayValue}
			{displayValue}
		{:else}
			<span class="text-dim">dd/mm/yyyy</span>
		{/if}
		<span class="float-right text-dim text-sm">▾</span>
	</button>

	{#if open}
		<div class="fixed inset-0 z-40" onclick={() => open = false} role="presentation"></div>
		<div
			bind:this={panelEl}
			class="fixed z-[60] bg-tape border border-line rounded-lg shadow-xl p-3 w-72"
			style={panelStyle}
			role="dialog"
			aria-label="Date picker"
		>
			<!-- Header: month navigation -->
			<div class="flex items-center justify-between mb-2">
				<button type="button" onclick={prevMonth} class="min-w-8 min-h-8 inline-flex items-center justify-center text-dim hover:text-ledger rounded hover:bg-line/40">◀</button>
				<span class="text-sm font-medium text-ledger">{MONTHS[viewMonth]} {viewYear}</span>
				<button type="button" onclick={nextMonth} class="min-w-8 min-h-8 inline-flex items-center justify-center text-dim hover:text-ledger rounded hover:bg-line/40">▶</button>
			</div>

			<!-- Weekday headers -->
			<div class="grid grid-cols-7 gap-0 text-center mb-1">
				{#each WEEKDAYS as wd}
					<span class="text-[10px] text-dim py-1">{wd}</span>
				{/each}
			</div>

			<!-- Calendar grid -->
			<div class="grid grid-cols-7 gap-0" role="grid" aria-label="Calendar" onkeydown={onCalendarKeydown}>
				{#each calendarDays as cell (cell.key)}
					{#if cell.day === 0}
						<div class="h-8"></div>
					{:else}
						<button
							tabindex={focusedDay === cell.day ? 0 : -1}
							type="button"
							onclick={() => selectDay(cell.day)}
							class="h-8 text-xs rounded flex items-center justify-center transition-colors
								{selectedDay === cell.day ? 'bg-phosphor text-ink font-medium' : ''}
								{`${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(cell.day).padStart(2, '0')}` === today && selectedDay !== cell.day ? 'text-phosphor font-medium' : 'text-ledger hover:bg-line/40'}
								{selectedDay === cell.day ? '' : ''}"
						>
							{cell.day}
						</button>
					{/if}
				{/each}
			</div>

			<!-- Footer actions -->
			<div class="flex items-center justify-between mt-2 pt-2 border-t border-line">
				<button type="button" onclick={selectToday} class="text-xs text-phosphor hover:text-phosphor-bright transition-colors">{m.common_today()}</button>
				{#if value}
					<button type="button" onclick={clearDate} class="text-xs text-dim hover:text-debit transition-colors">{m.common_clear()}</button>
				{/if}
			</div>
		</div>
	{/if}
</div>
