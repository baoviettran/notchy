<script module lang="ts">
	// Survives the {#key settings.locale} remount that setLocale triggers on
	// step 1 — without this, choosing a language bounces the user back here.
	let persistedStep = 1;
</script>

<script lang="ts">
	import { goto } from '$app/navigation';
	import Button from '$lib/components/primitives/Button.svelte';
	import Input from '$lib/components/primitives/Input.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { accounts } from '$lib/stores/accounts.svelte';
	import { dbStore } from '$lib/stores/db.svelte';
	import { parseAmount } from '$lib/utils/number_parse';
	import type { Locale } from '$lib/utils/number_parse';
	import * as m from '$lib/paraglide/messages';

	let step = $state(persistedStep);
	let locale = $state<Locale>(settings.locale);
	let currency = $state(settings.currency);
	let accountName = $state('');
	let accountType = $state<'checking' | 'savings' | 'cash' | 'credit_card'>('checking');
	let initialBalance = $state('');
	let saving = $state(false);
	let error = $state('');
	let completed = $state(false);

	// Focus the first interactive element on step transitions.
	let stepContent = $state<HTMLElement | null>(null);
	$effect(() => {
		step; // track step changes
		// After DOM update, focus the first focusable element in the new step.
		queueMicrotask(() => {
			const el = stepContent?.querySelector<HTMLElement>(
				'button, input, [role="radio"], a'
			);
			el?.focus();
		});
	});

	// Escape key navigates back within the wizard.
	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && step > 1 && !saving && !completed) {
			e.preventDefault();
			step === 3 ? goStep2() : goStep1();
		}
	}

	function langButtonClass(value: Locale) {
		return locale === value ? 'border-phosphor bg-phosphor/10' : 'border-line hover:border-dim';
	}

	const accountTypes = [
		{ value: 'checking', label: m.forms_account_type_checking },
		{ value: 'savings', label: m.forms_account_type_savings },
		{ value: 'cash', label: m.forms_account_type_cash },
		{ value: 'credit_card', label: m.forms_account_type_credit_card }
	] as const;

	const currencies = [
		{ value: 'VND', code: 'VND', plate: 'VN', desc: () => m.onboarding_currency_desc_vnd() },
		{ value: 'USD', code: 'USD', plate: 'US', desc: () => m.onboarding_currency_desc_usd() },
		{ value: 'EUR', code: 'EUR', plate: 'EU', desc: () => m.onboarding_currency_desc_eur() },
		{ value: 'JPY', code: 'JPY', plate: 'JP', desc: () => m.onboarding_currency_desc_jpy() },
		{ value: 'THB', code: 'THB', plate: 'TH', desc: () => m.onboarding_currency_desc_thb() }
	];

	function goStep1() { persistedStep = step = 1; }
	function goStep2() { persistedStep = step = 2; }

	async function nextStep() {
		if (step === 1) {
			// Persist the next step BEFORE setLocale — changing locale triggers
			// a {#key settings.locale} remount that destroys this component
			// mid-execution. persistedStep (module-level) survives the remount.
			persistedStep = 2;
			await settings.setLocale(locale);
			step = 2;
		} else if (step === 2) {
			persistedStep = 3;
			await settings.setCurrency(currency);
			step = 3;
		}
	}

	async function finish() {
		if (!accountName.trim() || saving) return;
		error = '';
		saving = true;
		try {
			let balance: number | undefined;
			if (initialBalance.trim()) {
				try {
					balance = parseAmount(initialBalance, locale, currency);
				} catch {
					error = m.validation_invalid_amount();
					saving = false;
					return;
				}
			}
			await accounts.create({
				name: accountName.trim(),
				type: accountType,
				currency,
				initial_balance: balance,
				initial_balance_date: new Date().toISOString().split('T')[0]
			});
			await settings.completeOnboarding();
			dbStore.firstRunComplete = true;
			persistedStep = 1;
			completed = true;
			// Brief pause so the user sees the success state.
			await new Promise((r) => setTimeout(r, 800));
			goto('/');
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			saving = false;
		}
	}

	function skip() {
		settings.completeOnboarding();
		dbStore.firstRunComplete = true;
		persistedStep = 1;
		goto('/');
	}

	function dotClass(active: boolean) {
		return active ? 'bg-phosphor' : 'bg-line';
	}

	// Pre-compute dot classes to avoid narrowing issues inside {:else if} blocks.
	const dots = $derived([dotClass(step >= 1), dotClass(step >= 2), dotClass(step >= 3)]);
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<svelte:window onkeydown={handleKeydown} />

<div class="min-h-screen flex items-center justify-center bg-ink p-4">
	<div class="w-full max-w-md">
		<div class="text-center mb-8">
			<div class="figures-glow text-3xl mb-2" aria-hidden="true">▮</div>
			<h1 class="figures text-2xl text-ledger tracking-wide">{m.app_name()}</h1>
			<p class="plate mt-2">{m.onboarding_local_first()}</p>
		</div>

		<!-- Screen-reader-only step announcement -->
		<p class="sr-only" aria-live="polite">
			{m.onboarding_step_of({ current: step, total: 3 })}
		</p>

		{#if completed}
			<div class="surface rounded-lg p-6 text-center space-y-3">
				<div class="figures text-3xl text-phosphor" aria-hidden="true">✓</div>
				<p class="figures text-lg text-ledger">{m.onboarding_setup_complete()}</p>
			</div>
		{:else if step === 1}
			<div class="surface rounded-lg p-6 space-y-5" bind:this={stepContent}>
				<h2 class="plate">{m.onboarding_choose_language()}</h2>
				<p class="text-sm text-dim">{m.onboarding_step_1_desc()}</p>
				<div role="radiogroup" aria-label={m.onboarding_choose_language()} class="space-y-3">
					<button onclick={() => locale = 'en'} role="radio" aria-checked={locale === 'en'}
						class="w-full p-4 rounded-md border text-left transition-colors {langButtonClass('en')}">
						<div class="font-medium text-ledger">{m.lang_english()}{#if locale === 'en'}<span class="figures text-phosphor ml-2" aria-hidden="true">✓</span>{/if}</div>
						<div class="text-sm text-dim">{m.onboarding_lang_desc_english()}</div>
					</button>
					<button onclick={() => locale = 'vi'} role="radio" aria-checked={locale === 'vi'}
						class="w-full p-4 rounded-md border text-left transition-colors {langButtonClass('vi')}">
						<div class="font-medium text-ledger">{m.lang_vietnamese()}{#if locale === 'vi'}<span class="figures text-phosphor ml-2" aria-hidden="true">✓</span>{/if}</div>
						<div class="text-sm text-dim">{m.onboarding_lang_desc_vietnamese()}</div>
					</button>
				</div>
				<div class="flex items-center justify-between pt-2">
					<div class="flex gap-1.5" role="presentation" aria-hidden="true">
						<span class="w-2.5 h-2.5 rounded-full {dots[0]}"></span>
						<span class="w-2.5 h-2.5 rounded-full {dots[1]}"></span>
						<span class="w-2.5 h-2.5 rounded-full {dots[2]}"></span>
					</div>
					<div class="flex gap-2">
						<Button variant="ghost" onclick={skip}>{m.onboarding_skip()}</Button>
						<Button onclick={nextStep}>{m.onboarding_continue_arrow()}</Button>
					</div>
				</div>
			</div>
		{:else if step === 2}
			<div class="surface rounded-lg p-6 space-y-5" bind:this={stepContent}>
				<h2 class="plate">{m.onboarding_choose_currency()}</h2>
				<p class="text-sm text-dim">{m.onboarding_currency_desc()}</p>
				<div role="radiogroup" aria-label={m.onboarding_choose_currency()} class="space-y-3">
					{#each currencies as c}
						<button onclick={() => currency = c.value} role="radio" aria-checked={currency === c.value}
							class="w-full p-4 rounded-md border text-left transition-colors {currency === c.value ? 'border-phosphor bg-phosphor/10' : 'border-line hover:border-dim'}">
							<span class="flex items-center gap-3">
								<!-- The two-letter code is the currency's identity, stamped
								     like a chip — deliberately not an emoji flag, which
								     Windows (Tauri's primary desktop) doesn't render. -->
								<span class="w-10 h-10 shrink-0 rounded-md border border-line bg-ink flex items-center justify-center figures text-sm text-phosphor" aria-hidden="true">{c.plate}</span>
								<span class="min-w-0">
									<span class="block font-medium text-ledger">{c.code}{#if currency === c.value}<span class="figures text-phosphor ml-2" aria-hidden="true">✓</span>{/if}</span>
									<span class="block text-sm text-dim">— {c.desc()}</span>
								</span>
							</span>
						</button>
					{/each}
				</div>
				<p class="text-xs text-dim">{m.onboarding_currency_permanent()}</p>
				<div class="flex items-center justify-between pt-2">
					<div class="flex gap-1.5" role="presentation" aria-hidden="true">
						<span class="w-2.5 h-2.5 rounded-full {dots[0]}"></span>
						<span class="w-2.5 h-2.5 rounded-full {dots[1]}"></span>
						<span class="w-2.5 h-2.5 rounded-full {dots[2]}"></span>
					</div>
					<div class="flex gap-2">
						<Button variant="ghost" onclick={goStep1}>{m.onboarding_back()}</Button>
						<Button onclick={nextStep}>{m.onboarding_continue_arrow()}</Button>
					</div>
				</div>
			</div>
		{:else}
			<div class="surface rounded-lg p-6 space-y-5" bind:this={stepContent}>
				<h2 class="plate">{m.onboarding_create_account()}</h2>
				<p class="text-sm text-dim">{m.onboarding_account_desc()}</p>
				<div class="space-y-4">
					<div>
						<!-- svelte-ignore a11y_label_has_associated_control False positive: label is associated via aria-labelledby on role=radiogroup -->
						<label id="account-type-label" class="plate block mb-2">{m.forms_type()}</label>
						<div role="radiogroup" aria-labelledby="account-type-label" class="flex flex-wrap gap-2">
							{#each accountTypes as t}
								<button onclick={() => accountType = t.value} role="radio" aria-checked={accountType === t.value}
									class="inline-flex items-center min-h-9 pointer-coarse:min-h-11 px-3 text-sm rounded-md border transition-colors {accountType === t.value ? 'border-phosphor bg-phosphor/10 text-phosphor-bright font-medium' : 'border-line text-dim hover:text-ledger'}"
								>{t.label()}{#if accountType === t.value}<span class="figures ml-2" aria-hidden="true">✓</span>{/if}</button>
							{/each}
						</div>
					</div>
					<Input label={m.common_name()} bind:value={accountName} placeholder={m.onboarding_account_name_placeholder()} />
					<Input label={m.forms_initial_balance()} bind:value={initialBalance} placeholder={m.onboarding_amount_hint()} />
					<p class="text-xs text-dim leading-relaxed">{m.onboarding_quick_add_hint()}</p>
					{#if error}<p class="text-sm text-debit" role="alert">{error}</p>{/if}
				</div>
				<div class="flex items-center justify-between pt-2">
					<div class="flex gap-1.5" role="presentation" aria-hidden="true">
						<span class="w-2.5 h-2.5 rounded-full {dots[0]}"></span>
						<span class="w-2.5 h-2.5 rounded-full {dots[1]}"></span>
						<span class="w-2.5 h-2.5 rounded-full {dots[2]}"></span>
					</div>
					<div class="flex gap-2">
						<Button variant="ghost" onclick={goStep2}>{m.onboarding_back()}</Button>
						<Button onclick={finish} disabled={!accountName.trim() || saving}>
							{#if saving}{m.onboarding_saving()}{:else}{m.onboarding_finish()}{/if}
						</Button>
					</div>
				</div>
			</div>
		{/if}
	</div>
</div>
