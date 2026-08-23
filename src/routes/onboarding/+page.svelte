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

	let step = $state(1);
	let locale = $state<Locale>('en');
	let currency = $state('VND');
	let accountName = $state('');
	let accountType = $state<'checking' | 'savings' | 'cash' | 'credit_card'>('checking');
	let initialBalance = $state('');
	let saving = $state(false);
	let error = $state('');

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
		{ value: 'VND', code: 'VND', plate: 'VN' },
		{ value: 'USD', code: 'USD', plate: 'US' }
	];

	async function nextStep() {
		if (step === 1) {
			await settings.setLocale(locale);
			step = 2;
		} else if (step === 2) {
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
			goto('/');
		} finally {
			saving = false;
		}
	}
</script>

<div class="min-h-screen flex items-center justify-center bg-ink p-4">
	<div class="w-full max-w-md">
		<div class="text-center mb-8">
			<div class="figures-glow text-3xl mb-2">▮</div>
			<h1 class="figures text-2xl text-ledger tracking-wide">{m.app_name()}</h1>
			<p class="plate mt-2">{m.onboarding_local_first()}</p>
		</div>

		{#if step === 1}
			<div class="surface rounded-lg p-6 space-y-5">
				<h2 class="figures text-ledger tracking-wide">{m.onboarding_choose_language()}</h2>
				<div class="space-y-3">
					<button onclick={() => locale = 'en'} aria-pressed={locale === 'en'}
						class="w-full p-4 rounded-md border text-left transition-colors {langButtonClass('en')}">
						<div class="font-medium text-ledger">{m.lang_english()}{#if locale === 'en'}<span class="figures text-phosphor ml-2" aria-hidden="true">✓</span>{/if}</div>
						<div class="text-sm text-dim">{m.onboarding_lang_desc_english()}</div>
					</button>
					<button onclick={() => locale = 'vi'} aria-pressed={locale === 'vi'}
						class="w-full p-4 rounded-md border text-left transition-colors {langButtonClass('vi')}">
						<div class="font-medium text-ledger">{m.lang_vietnamese()}{#if locale === 'vi'}<span class="figures text-phosphor ml-2" aria-hidden="true">✓</span>{/if}</div>
						<div class="text-sm text-dim">{m.onboarding_lang_desc_vietnamese()}</div>
					</button>
				</div>
				<div class="flex items-center justify-between pt-2">
					<div class="flex gap-1.5"><span class="w-2 h-2 rounded-full bg-phosphor"></span><span class="w-2 h-2 rounded-full bg-line"></span><span class="w-2 h-2 rounded-full bg-line"></span></div>
					<Button onclick={nextStep}>{m.onboarding_continue_arrow()}</Button>
				</div>
			</div>
		{:else if step === 2}
			<div class="surface rounded-lg p-6 space-y-5">
				<h2 class="figures text-ledger tracking-wide">{m.onboarding_choose_currency()}</h2>
				<p class="text-sm text-dim">{m.onboarding_currency_desc()}</p>
				<div class="space-y-3">
					{#each currencies as c}
						<button onclick={() => currency = c.value} aria-pressed={currency === c.value}
							class="w-full p-4 rounded-md border text-left transition-colors {currency === c.value ? 'border-phosphor bg-phosphor/10' : 'border-line hover:border-dim'}">
							<span class="flex items-center gap-3">
								<!-- The two-letter code is the currency's identity, stamped
								     like a chip — deliberately not an emoji flag, which
								     Windows (Tauri's primary desktop) doesn't render. -->
								<span class="w-10 h-10 shrink-0 rounded-md border border-line bg-ink flex items-center justify-center figures text-sm text-phosphor" aria-hidden="true">{c.plate}</span>
								<span class="min-w-0">
									<span class="block font-medium text-ledger">{c.code}{#if currency === c.value}<span class="figures text-phosphor ml-2" aria-hidden="true">✓</span>{/if}</span>
									<span class="block text-sm text-dim">— {c.value === 'VND' ? m.onboarding_currency_desc_vnd() : m.onboarding_currency_desc_usd()}</span>
								</span>
							</span>
						</button>
					{/each}
				</div>
				<div class="flex items-center justify-between pt-2">
					<div class="flex gap-1.5"><span class="w-2 h-2 rounded-full bg-phosphor"></span><span class="w-2 h-2 rounded-full bg-phosphor"></span><span class="w-2 h-2 rounded-full bg-line"></span></div>
					<div class="flex gap-2">
						<Button variant="ghost" onclick={() => step = 1}>{m.onboarding_back()}</Button>
						<Button onclick={nextStep}>{m.onboarding_continue_arrow()}</Button>
					</div>
				</div>
			</div>
		{:else}
			<div class="surface rounded-lg p-6 space-y-5">
				<h2 class="figures text-ledger tracking-wide">{m.onboarding_create_account()}</h2>
				<p class="text-sm text-dim">{m.onboarding_account_desc()}</p>
				<div class="space-y-4">
					<div>
						<!-- svelte-ignore a11y_label_has_associated_control -->
						<label class="plate block mb-2">{m.forms_type()}</label>
						<div class="flex flex-wrap gap-2">
							{#each accountTypes as t}
								<button onclick={() => accountType = t.value} aria-pressed={accountType === t.value}
									class="inline-flex items-center min-h-9 pointer-coarse:min-h-11 px-3 text-sm rounded-md border transition-colors {accountType === t.value ? 'border-phosphor bg-phosphor/10 text-phosphor-bright font-medium' : 'border-line text-dim hover:text-ledger'}"
								>{t.label()}{#if accountType === t.value}<span class="figures ml-2" aria-hidden="true">✓</span>{/if}</button>
							{/each}
						</div>
					</div>
					<Input label={m.common_name()} bind:value={accountName} placeholder={m.onboarding_account_name_placeholder()} />
					<Input label={m.forms_initial_balance()} bind:value={initialBalance} placeholder={m.onboarding_amount_hint()} />
					{#if error}<p class="text-sm text-debit">{error}</p>{/if}
				</div>
				<div class="flex items-center justify-between pt-2">
					<div class="flex gap-1.5"><span class="w-2 h-2 rounded-full bg-phosphor"></span><span class="w-2 h-2 rounded-full bg-phosphor"></span><span class="w-2 h-2 rounded-full bg-phosphor"></span></div>
					<div class="flex gap-2">
						<Button variant="ghost" onclick={() => step = 2}>{m.onboarding_back()}</Button>
						<Button onclick={finish} disabled={!accountName.trim() || saving}>{m.onboarding_finish()}</Button>
					</div>
				</div>
			</div>
		{/if}
	</div>
</div>
