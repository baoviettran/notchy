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

<div class="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-900 p-4">
	<div class="w-full max-w-md">
		<div class="text-center mb-8">
			<h1 class="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Notchy</h1>
		</div>

		{#if step === 1}
			<div class="bg-white dark:bg-zinc-800 rounded-xl p-6 shadow-sm space-y-4">
				<h2 class="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Choose your language</h2>
				<div class="space-y-3">
					<button onclick={() => locale = 'en'}
						class="w-full p-4 rounded-lg border-2 text-left transition-colors {locale === 'en' ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20' : 'border-zinc-200 dark:border-zinc-700'}">
						<div class="font-medium text-zinc-900 dark:text-zinc-50">English</div>
						<div class="text-sm text-zinc-500">Tracks finances in English</div>
					</button>
					<button onclick={() => locale = 'vi'}
						class="w-full p-4 rounded-lg border-2 text-left transition-colors {locale === 'vi' ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20' : 'border-zinc-200 dark:border-zinc-700'}">
						<div class="font-medium text-zinc-900 dark:text-zinc-50">Tiếng Việt</div>
						<div class="text-sm text-zinc-500">Quản lý tài chính bằng Tiếng Việt</div>
					</button>
				</div>
				<div class="flex items-center justify-between pt-4">
					<div class="flex gap-1"><span class="w-2 h-2 rounded-full bg-emerald-500"></span><span class="w-2 h-2 rounded-full bg-zinc-300"></span><span class="w-2 h-2 rounded-full bg-zinc-300"></span></div>
					<Button onclick={nextStep}>Continue →</Button>
				</div>
			</div>
		{:else if step === 2}
			<div class="bg-white dark:bg-zinc-800 rounded-xl p-6 shadow-sm space-y-4">
				<h2 class="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{locale === 'vi' ? 'Chọn đơn vị tiền tệ' : 'Choose your currency'}</h2>
				<p class="text-sm text-zinc-500">{locale === 'vi' ? 'Tất cả tài khoản sẽ dùng chung đơn vị này.' : 'All accounts will share this currency.'}</p>
				<div class="space-y-3">
					{#each currencies as c}
						<button onclick={() => currency = c.value}
							class="w-full p-4 rounded-lg border-2 text-left transition-colors {currency === c.value ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20' : 'border-zinc-200 dark:border-zinc-700'}">
							<span class="font-medium text-zinc-900 dark:text-zinc-50">{c.label}</span>
						</button>
					{/each}
				</div>
				<div class="flex items-center justify-between pt-4">
					<div class="flex gap-1"><span class="w-2 h-2 rounded-full bg-emerald-500"></span><span class="w-2 h-2 rounded-full bg-emerald-500"></span><span class="w-2 h-2 rounded-full bg-zinc-300"></span></div>
					<div class="flex gap-2">
						<Button variant="ghost" onclick={() => step = 1}>← Back</Button>
						<Button onclick={nextStep}>Continue →</Button>
					</div>
				</div>
			</div>
		{:else}
			<div class="bg-white dark:bg-zinc-800 rounded-xl p-6 shadow-sm space-y-4">
				<h2 class="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{locale === 'vi' ? 'Tạo tài khoản đầu tiên' : 'Create your first account'}</h2>
				<p class="text-sm text-zinc-500">{locale === 'vi' ? 'Nơi tiền của bạn được lưu trữ.' : 'This is where your money lives.'}</p>
				<div class="space-y-3">
					<div>
						<!-- svelte-ignore a11y_label_has_associated_control -->
						<label class="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">Type</label>
						<div class="flex flex-wrap gap-2">
							{#each accountTypes as t}
								<button onclick={() => accountType = t.value}
									class="px-3 py-1.5 text-sm rounded-md border transition-colors {accountType === t.value ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700' : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400'}"
								>{t.label}</button>
							{/each}
						</div>
					</div>
					<Input label="Name" bind:value={accountName} placeholder="My Checking Account" />
					<Input label="Initial balance (optional)" bind:value={initialBalance} placeholder="e.g. 5tr, 1000000" />
				</div>
				<div class="flex items-center justify-between pt-4">
					<div class="flex gap-1"><span class="w-2 h-2 rounded-full bg-emerald-500"></span><span class="w-2 h-2 rounded-full bg-emerald-500"></span><span class="w-2 h-2 rounded-full bg-emerald-500"></span></div>
					<div class="flex gap-2">
						<Button variant="ghost" onclick={() => step = 2}>← Back</Button>
						<Button onclick={finish} disabled={!accountName || saving}>{locale === 'vi' ? 'Hoàn tất' : 'Finish setup'}</Button>
					</div>
				</div>
			</div>
		{/if}
	</div>
</div>
