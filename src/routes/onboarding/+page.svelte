<script lang="ts">
	import { goto } from '$app/navigation';
	import Button from '$lib/components/primitives/Button.svelte';
	import Input from '$lib/components/primitives/Input.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { accounts } from '$lib/stores/accounts.svelte';
	import { dbStore } from '$lib/stores/db.svelte';
	import { parseAmount } from '$lib/utils/number_parse';
	import type { Locale } from '$lib/utils/number_parse';

	let step = $state(1);
	let locale = $state<Locale>('en');
	let currency = $state('VND');
	let accountName = $state('');
	let accountType = $state<'checking' | 'savings' | 'cash' | 'credit_card'>('checking');
	let initialBalance = $state('');
	let saving = $state(false);

	const accountTypes = [
		{ value: 'checking', label: 'Checking' },
		{ value: 'savings', label: 'Savings' },
		{ value: 'cash', label: 'Cash' },
		{ value: 'credit_card', label: 'Credit Card' }
	] as const;

	const currencies = [
		{ value: 'VND', label: '🇻🇳 VND — Vietnamese đồng' },
		{ value: 'USD', label: '🇺🇸 USD — US Dollar' }
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
		if (!accountName || saving) return;
		saving = true;
		try {
			let balance: number | undefined;
			if (initialBalance) {
				try { balance = parseAmount(initialBalance, locale, currency); } catch { balance = undefined; }
			}
			await accounts.create({
				name: accountName,
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
			<h1 class="figures text-2xl text-ledger tracking-wide">Notchy</h1>
			<p class="plate mt-2">Local-first ledger</p>
		</div>

		{#if step === 1}
			<div class="surface rounded-lg p-6 space-y-5">
				<h2 class="figures text-ledger tracking-wide">{locale === 'vi' ? 'Chọn ngôn ngữ' : 'Choose your language'}</h2>
				<div class="space-y-3">
					<button onclick={() => locale = 'en'}
						class="w-full p-4 rounded-md border text-left transition-colors {locale === 'en' ? 'border-phosphor bg-phosphor/10' : 'border-line hover:border-dim'}">
						<div class="font-medium text-ledger">English</div>
						<div class="text-sm text-dim">Tracks finances in English</div>
					</button>
					<button onclick={() => locale = 'vi'}
						class="w-full p-4 rounded-md border text-left transition-colors {locale === 'vi' ? 'border-phosphor bg-phosphor/10' : 'border-line hover:border-dim'}">
						<div class="font-medium text-ledger">Tiếng Việt</div>
						<div class="text-sm text-dim">Quản lý tài chính bằng Tiếng Việt</div>
					</button>
				</div>
				<div class="flex items-center justify-between pt-2">
					<div class="flex gap-1.5"><span class="w-2 h-2 rounded-full bg-phosphor"></span><span class="w-2 h-2 rounded-full bg-line"></span><span class="w-2 h-2 rounded-full bg-line"></span></div>
					<Button onclick={nextStep}>Continue →</Button>
				</div>
			</div>
		{:else if step === 2}
			<div class="surface rounded-lg p-6 space-y-5">
				<h2 class="figures text-ledger tracking-wide">{locale === 'vi' ? 'Chọn đơn vị tiền tệ' : 'Choose your currency'}</h2>
				<p class="text-sm text-dim">{locale === 'vi' ? 'Tất cả tài khoản sẽ dùng chung đơn vị này.' : 'All accounts will share this currency.'}</p>
				<div class="space-y-3">
					{#each currencies as c}
						<button onclick={() => currency = c.value}
							class="w-full p-4 rounded-md border text-left transition-colors {currency === c.value ? 'border-phosphor bg-phosphor/10' : 'border-line hover:border-dim'}">
							<span class="font-medium text-ledger">{c.label}</span>
						</button>
					{/each}
				</div>
				<div class="flex items-center justify-between pt-2">
					<div class="flex gap-1.5"><span class="w-2 h-2 rounded-full bg-phosphor"></span><span class="w-2 h-2 rounded-full bg-phosphor"></span><span class="w-2 h-2 rounded-full bg-line"></span></div>
					<div class="flex gap-2">
						<Button variant="ghost" onclick={() => step = 1}>← Back</Button>
						<Button onclick={nextStep}>Continue →</Button>
					</div>
				</div>
			</div>
		{:else}
			<div class="surface rounded-lg p-6 space-y-5">
				<h2 class="figures text-ledger tracking-wide">{locale === 'vi' ? 'Tạo tài khoản đầu tiên' : 'Create your first account'}</h2>
				<p class="text-sm text-dim">{locale === 'vi' ? 'Nơi tiền của bạn được lưu trữ.' : 'This is where your money lives.'}</p>
				<div class="space-y-4">
					<div>
						<!-- svelte-ignore a11y_label_has_associated_control -->
						<label class="plate block mb-2">Type</label>
						<div class="flex flex-wrap gap-2">
							{#each accountTypes as t}
								<button onclick={() => accountType = t.value}
									class="px-3 py-1.5 text-sm rounded-md border transition-colors {accountType === t.value ? 'border-phosphor bg-phosphor/10 text-phosphor-bright font-medium' : 'border-line text-dim hover:text-ledger'}"
								>{t.label}</button>
							{/each}
						</div>
					</div>
					<Input label="Name" bind:value={accountName} placeholder="My Checking Account" />
					<Input label="Initial balance (optional)" bind:value={initialBalance} placeholder="e.g. 5tr, 1000000" />
				</div>
				<div class="flex items-center justify-between pt-2">
					<div class="flex gap-1.5"><span class="w-2 h-2 rounded-full bg-phosphor"></span><span class="w-2 h-2 rounded-full bg-phosphor"></span><span class="w-2 h-2 rounded-full bg-phosphor"></span></div>
					<div class="flex gap-2">
						<Button variant="ghost" onclick={() => step = 2}>← Back</Button>
						<Button onclick={finish} disabled={!accountName || saving}>{locale === 'vi' ? 'Hoàn tất' : 'Finish setup'}</Button>
					</div>
				</div>
			</div>
		{/if}
	</div>
</div>
