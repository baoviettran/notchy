<script lang="ts">
	import Button from '$lib/components/primitives/Button.svelte';
	import ConfirmDialog from '$lib/components/primitives/ConfirmDialog.svelte';
	import { buildTechnicalReport } from '$lib/recovery';
	import type { RecoveryContext, StartupFailureCode } from '$lib/db/startup';
	import * as m from '$lib/paraglide/messages';

	let {
		context,
		onretry,
		onrestore,
		onopenfolder,
		onquit
	}: {
		context: RecoveryContext;
		onretry: () => void | Promise<void>;
		onrestore: () => void | Promise<void>;
		onopenfolder: () => void | Promise<void>;
		onquit: () => void | Promise<void>;
	} = $props();
	let confirmRestore = $state(false);

	// Plain-language summary per failure code. `context.detail` (which may embed
	// SQL parameters or queried rows) is never rendered into user-visible copy.
	const codeMessages: Record<StartupFailureCode, () => string> = {
		database_corrupt: m.recovery_code_database_corrupt,
		database_schema_invalid: m.recovery_code_database_schema_invalid,
		database_schema_newer: m.recovery_code_database_schema_newer,
		upgrade_backup_failed: m.recovery_code_upgrade_backup_failed,
		migration_failed: m.recovery_code_migration_failed,
		post_migration_verification_failed: m.recovery_code_post_migration_verification_failed
	};

	async function copyReport() {
		await navigator.clipboard.writeText(buildTechnicalReport(context));
	}
</script>

<main role="status" class="h-screen flex flex-col items-center justify-center bg-ink text-ledger p-4">
	<div class="w-full max-w-md surface rounded-lg p-6 space-y-5">
		<div class="text-center">
			<div class="figures-glow text-2xl animate-flash">▮▮</div>
			<h1 class="figures text-xl text-ledger tracking-wide mt-2">{m.recovery_title()}</h1>
			<p class="plate mt-1">{codeMessages[context.code]()}</p>
		</div>

		<dl class="space-y-2 text-sm">
			<div class="flex justify-between gap-4">
				<dt class="plate shrink-0">{m.recovery_app_version()}</dt>
				<dd class="text-ledger truncate">{context.appVersion}</dd>
			</div>
			<div class="flex justify-between gap-4">
				<dt class="plate shrink-0">{m.recovery_latest_schema()}</dt>
				<dd class="text-ledger truncate">{context.latestSchemaVersion}</dd>
			</div>
			<div class="flex justify-between gap-4">
				<dt class="plate shrink-0">{m.recovery_detected_schema()}</dt>
				<dd class="text-ledger truncate">{context.detectedSchemaVersion ?? m.recovery_unknown()}</dd>
			</div>
			<div class="flex justify-between gap-4">
				<dt class="plate shrink-0">{m.recovery_database_path()}</dt>
				<dd class="text-ledger truncate font-mono text-xs">{context.liveDatabasePath}</dd>
			</div>
			{#if context.backupPath}
				<div class="flex justify-between gap-4">
					<dt class="plate shrink-0">{m.recovery_backup_path()}</dt>
					<dd class="text-ledger truncate font-mono text-xs">{context.backupPath}</dd>
				</div>
			{/if}
		</dl>

		<div class="flex flex-wrap justify-center gap-2 pt-1">
			<Button onclick={onretry}>{m.recovery_retry()}</Button>
			{#if context.backupPath}
				<Button variant="secondary" onclick={() => (confirmRestore = true)}>{m.recovery_restore()}</Button>
			{/if}
			<Button variant="ghost" onclick={onopenfolder}>{m.recovery_open_folder()}</Button>
			<Button variant="ghost" onclick={copyReport}>{m.recovery_copy_report()}</Button>
			<Button variant="ghost" onclick={onquit}>{m.recovery_quit()}</Button>
		</div>
	</div>

	{#if context.backupPath}
		<ConfirmDialog
			bind:open={confirmRestore}
			title={m.recovery_restore_confirm_title()}
			message={m.recovery_restore_confirm_message({ path: context.liveDatabasePath })}
			confirmLabel={m.recovery_restore()}
			onconfirm={onrestore}
		/>
	{/if}
</main>
