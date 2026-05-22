<script lang="ts">
	import { goto } from '$app/navigation';
	import Button from '$lib/components/primitives/Button.svelte';
	import Input from '$lib/components/primitives/Input.svelte';

	let step = $state(1);
	let locale = $state('en');
	let currency = $state('VND');
	let accountName = $state('');
	let accountType = $state('checking');
	let initialBalance = $state('');

	const accountTypes = [
		{ value: 'checking', label: 'Checking' },
		{ value: 'savings', label: 'Savings' },
		{ value: 'cash', label: 'Cash' },
		{ value: 'credit_card', label: 'Credit Card' }
	];

	const currencies = [
		{ value: 'VND', label: '🇻🇳 VND — Vietnamese đồng' },
		{ value: 'USD', label: '🇺🇸 USD — US Dollar' }
	];

	async function finish() {
		// In production, this calls settings.setLocale, settings.setCurrency, accounts.create, settings.completeOnboarding
		goto('/');
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
					<button
						onclick={() => locale = 'en'}
						class="w-full p-4 rounded-lg border-2 text-left transition-colors {locale === 'en' ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20' : 'border-zinc-200 dark:border-zinc-700'}"
					>
						<div class="font-medium text-zinc-900 dark:text-zinc-50">English</div>
						<div class="text-sm text-zinc-500">Tracks finances in English</div>
					</button>
					<button
						onclick={() => locale = 'vi'}
						class="w-full p-4 rounded-lg border-2 text-left transition-colors {locale === 'vi' ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20' : 'border-zinc-200 dark:border-zinc-700'}"
					>
						<div class="font-medium text-zinc-900 dark:text-zinc-50">Tiếng Việt</div>
						<div class="text-sm text-zinc-500">Quản lý tài chính bằng Tiếng Việt</div>
					</button>
				</div>
				<div class="flex items-center justify-between pt-4">
					<div class="flex gap-1">
						<span class="w-2 h-2 rounded-full bg-emerald-500"></span>
						<span class="w-2 h-2 rounded-full bg-zinc-300"></span>
						<span class="w-2 h-2 rounded-full bg-zinc-300"></span>
					</div>
					<Button onclick={() => step = 2}>Continue →</Button>
				</div>
			</div>
		{:else if step === 2}
			<div class="bg-white dark:bg-zinc-800 rounded-xl p-6 shadow-sm space-y-4">
				<h2 class="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Choose your currency</h2>
				<p class="text-sm text-zinc-500">All accounts will share this currency.</p>
				<div class="space-y-3">
					{#each currencies as c}
						<button
							onclick={() => currency = c.value}
							class="w-full p-4 rounded-lg border-2 text-left transition-colors {currency === c.value ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20' : 'border-zinc-200 dark:border-zinc-700'}"
						>
							<span class="font-medium text-zinc-900 dark:text-zinc-50">{c.label}</span>
						</button>
					{/each}
				</div>
				<div class="flex items-center justify-between pt-4">
					<div class="flex gap-1">
						<span class="w-2 h-2 rounded-full bg-emerald-500"></span>
						<span class="w-2 h-2 rounded-full bg-emerald-500"></span>
						<span class="w-2 h-2 rounded-full bg-zinc-300"></span>
					</div>
					<div class="flex gap-2">
						<Button variant="ghost" onclick={() => step = 1}>← Back</Button>
						<Button onclick={() => step = 3}>Continue →</Button>
					</div>
				</div>
			</div>
		{:else}
			<div class="bg-white dark:bg-zinc-800 rounded-xl p-6 shadow-sm space-y-4">
				<h2 class="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Create your first account</h2>
				<p class="text-sm text-zinc-500">This is where your money lives — usually your main bank account or wallet.</p>
				<div class="space-y-3">
					<div>
						<label class="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">Type</label>
						<div class="flex flex-wrap gap-2">
							{#each accountTypes as t}
								<button
									onclick={() => accountType = t.value}
									class="px-3 py-1.5 text-sm rounded-md border transition-colors {accountType === t.value ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700' : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400'}"
								>{t.label}</button>
							{/each}
						</div>
					</div>
					<Input label="Name" bind:value={accountName} placeholder="My Checking Account" />
					<Input label="Initial balance (optional)" bind:value={initialBalance} placeholder="0" />
				</div>
				<div class="flex items-center justify-between pt-4">
					<div class="flex gap-1">
						<span class="w-2 h-2 rounded-full bg-emerald-500"></span>
						<span class="w-2 h-2 rounded-full bg-emerald-500"></span>
						<span class="w-2 h-2 rounded-full bg-emerald-500"></span>
					</div>
					<div class="flex gap-2">
						<Button variant="ghost" onclick={() => step = 2}>← Back</Button>
						<Button onclick={finish} disabled={!accountName}>Finish setup</Button>
					</div>
				</div>
			</div>
		{/if}
	</div>
</div>
