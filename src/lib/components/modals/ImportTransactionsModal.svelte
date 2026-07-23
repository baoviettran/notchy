<script lang="ts">
  import { ImportStore } from '$lib/stores/import.svelte';
  import Modal from '$lib/components/primitives/Modal.svelte';
  import Button from '$lib/components/primitives/Button.svelte';
  import * as m from '$lib/paraglide/messages';
  import { getDb } from '$lib/db';
  import { accounts } from '$lib/stores/accounts.svelte';
  import { settings } from '$lib/stores/settings.svelte';
  import { transactions } from '$lib/stores/transactions.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import { formatCurrency } from '$lib/utils/currency';

  let { open = $bindable(false) }: { open?: boolean } = $props();

  let store = $state<ImportStore | null>(null);
  let selectedAccountId = $state('');
  let fileText = $state('');
  let loading = $state(false);
  let errorMsg = $state<string | null>(null);

  // Re-classify live whenever the mapping changes. Per the spec invariant:
  // "Mapping edits re-classify live — preview always reflects current mapping."
  // Uses $effect (not $derived) because reclassify() mutates store.rows.
  $effect(() => {
    if (store) {
      // Touch every mapping property so Svelte tracks them as dependencies.
      const _touch = [
        store.mapping.date, store.mapping.amount, store.mapping.payee,
        store.mapping.notes, store.mapping.debit, store.mapping.credit,
        store.mapping.signConvention, store.mapping.dateFormat, store.mapping.amountLocale
      ];
      store.reclassify();
    }
  });

  const activeAccounts = $derived(accounts.items.filter(a => !a.archived));

  async function onFileChosen(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    fileText = await file.text();
  }

  async function onLoad() {
    if (!fileText || !selectedAccountId) return;
    loading = true;
    errorMsg = null;
    try {
      const db = await getDb();
      store = new ImportStore(db, settings.currency);
      await store.loadFile(fileText, selectedAccountId);
    } catch (e) {
      errorMsg = m.import_tx_error_parse();
      store = null;
    } finally {
      loading = false;
    }
  }

  async function onCommit() {
    if (!store) return;
    loading = true;
    try {
      const count = await store.commit();
      if (count > 0) {
        // Cross-window refresh: emit the existing event the layout listens for.
        // In Tauri, @tauri-apps/api/event emit reaches other webviews; in the
        // web/E2E build, dispatch a window event the same listener catches.
        try {
          if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
            const { emit } = await import('@tauri-apps/api/event');
            await emit('transaction:saved', {});
          } else {
            window.dispatchEvent(new Event('transaction:saved'));
          }
        } catch { /* non-fatal: list refresh still runs below */ }
        await transactions.load();
        toast.show(m.import_tx_commit_success({ count }));
      } else {
        toast.show(m.import_tx_commit_none());
      }
      open = false;
      reset();
    } finally {
      loading = false;
    }
  }

  function reset() {
    store = null;
    fileText = '';
    selectedAccountId = '';
    errorMsg = null;
  }

  // Live summary counts from the store
  let newCount = $derived(store?.newCount ?? 0);
  let dupCount = $derived(store?.duplicateCount ?? 0);
  let invalidCount = $derived(store?.invalidCount ?? 0);
  let includedCount = $derived(store?.includedCount ?? 0);

  // Column-role options for the editable mapping dropdowns
  const dateFormats = ['YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY'] as const;

  // Computed phase for template (helps TypeScript narrow store)
  let currentPhase = $derived(store ? store.phase : 'select');
</script>

<Modal bind:open title={m.import_tx_title()}>
  {#if !store}
    <!-- Phase: select -->
    <div class="space-y-4">
      <label class="block">
        <span class="text-sm text-dim">{m.import_tx_select_account()}</span>
        <select bind:value={selectedAccountId} class="mt-1 w-full bg-ink border border-line rounded-md px-3 py-2 text-sm text-ledger">
          <option value="">—</option>
          {#each activeAccounts as acc}
            <option value={acc.id}>{acc.name}</option>
          {/each}
        </select>
      </label>

      <label class="block">
        <span class="text-sm text-dim">{m.import_tx_select_file()}</span>
        <input type="file" accept=".csv,text/csv" onchange={onFileChosen}
          class="mt-1 block w-full text-sm text-dim file:mr-3 file:rounded-md file:border-0 file:bg-phosphor file:px-3 file:py-1.5 file:text-ink" />
      </label>

      {#if errorMsg}
        <p class="text-sm text-debit">{errorMsg}</p>
      {/if}

      <div class="flex justify-end">
        <Button onclick={onLoad} disabled={!selectedAccountId || !fileText || loading}>
          {m.import_tx_load()}
        </Button>
      </div>
    </div>
  {:else}
    {@const s = store}
    {#if s.phase === 'mapping'}
      <!-- Phase: editable mapping -->
      <div class="space-y-4">
        <h3 class="text-sm text-ledger font-medium">{m.import_tx_mapping_heading()}</h3>

        <!-- Sign convention toggle -->
        <div class="grid grid-cols-2 gap-3">
          <label class="block">
            <span class="text-xs text-dim">{m.import_tx_mapping_sign()}</span>
            <select bind:value={s.mapping.signConvention} class="mt-1 w-full bg-ink border border-line rounded-md px-2 py-1.5 text-sm text-ledger">
              <option value="signed">{m.import_tx_mapping_sign_signed()}</option>
              <option value="debit_credit_separate">{m.import_tx_mapping_sign_separate()}</option>
            </select>
          </label>
        </div>

        <!-- Column role dropdowns -->
        <div class="grid grid-cols-2 gap-3">
          <label class="block">
            <span class="text-xs text-dim">{m.import_tx_mapping_date()}</span>
            <select bind:value={s.mapping.date} class="mt-1 w-full bg-ink border border-line rounded-md px-2 py-1.5 text-sm text-ledger">
              <option value={null}>{m.import_tx_mapping_ignore()}</option>
              {#each s.rows[0].raw as header, i}<option value={i}>{header || `Column ${i + 1}`}</option>{/each}
            </select>
          </label>

          {#if s.mapping.signConvention === 'signed'}
            <label class="block">
              <span class="text-xs text-dim">{m.import_tx_mapping_amount()}</span>
              <select bind:value={s.mapping.amount} class="mt-1 w-full bg-ink border border-line rounded-md px-2 py-1.5 text-sm text-ledger">
                <option value={null}>{m.import_tx_mapping_ignore()}</option>
                {#each s.rows[0].raw as header, i}<option value={i}>{header || `Column ${i + 1}`}</option>{/each}
              </select>
            </label>
          {:else}
            <label class="block">
              <span class="text-xs text-dim">{m.import_tx_mapping_debit()}</span>
              <select bind:value={s.mapping.debit} class="mt-1 w-full bg-ink border border-line rounded-md px-2 py-1.5 text-sm text-ledger">
                <option value={null}>{m.import_tx_mapping_ignore()}</option>
                {#each s.rows[0].raw as header, i}<option value={i}>{header || `Column ${i + 1}`}</option>{/each}
              </select>
            </label>

            <label class="block">
              <span class="text-xs text-dim">{m.import_tx_mapping_credit()}</span>
              <select bind:value={s.mapping.credit} class="mt-1 w-full bg-ink border border-line rounded-md px-2 py-1.5 text-sm text-ledger">
                <option value={null}>{m.import_tx_mapping_ignore()}</option>
                {#each s.rows[0].raw as header, i}<option value={i}>{header || `Column ${i + 1}`}</option>{/each}
              </select>
            </label>
          {/if}

          <label class="block">
            <span class="text-xs text-dim">{m.import_tx_mapping_payee()}</span>
            <select bind:value={s.mapping.payee} class="mt-1 w-full bg-ink border border-line rounded-md px-2 py-1.5 text-sm text-ledger">
              <option value={null}>{m.import_tx_mapping_ignore()}</option>
              {#each s.rows[0].raw as header, i}<option value={i}>{header || `Column ${i + 1}`}</option>{/each}
            </select>
          </label>

          <label class="block">
            <span class="text-xs text-dim">{m.import_tx_mapping_notes()}</span>
            <select bind:value={s.mapping.notes} class="mt-1 w-full bg-ink border border-line rounded-md px-2 py-1.5 text-sm text-ledger">
              <option value={null}>{m.import_tx_mapping_ignore()}</option>
              {#each s.rows[0].raw as header, i}<option value={i}>{header || `Column ${i + 1}`}</option>{/each}
            </select>
          </label>
        </div>

        <!-- Format overrides -->
        <div class="grid grid-cols-2 gap-3">
          <label class="block">
            <span class="text-xs text-dim">{m.import_tx_mapping_date_format()}</span>
            <select bind:value={s.mapping.dateFormat} class="mt-1 w-full bg-ink border border-line rounded-md px-2 py-1.5 text-sm text-ledger">
              {#each dateFormats as f}<option value={f}>{f}</option>{/each}
            </select>
          </label>

          <label class="block">
            <span class="text-xs text-dim">{m.import_tx_mapping_amount_locale()}</span>
            <select bind:value={s.mapping.amountLocale} class="mt-1 w-full bg-ink border border-line rounded-md px-2 py-1.5 text-sm text-ledger">
              <option value="en">{m.import_tx_mapping_amount_locale_en()}</option>
              <option value="vi">{m.import_tx_mapping_amount_locale_vi()}</option>
            </select>
          </label>
        </div>

        <p class="text-xs text-dim">
          {m.import_tx_summary({ count: newCount, duplicates: dupCount, invalid: invalidCount })}
        </p>

        <div class="flex justify-between">
          <Button variant="ghost" onclick={reset}>{m.import_tx_back()}</Button>
          <Button onclick={() => s.goToPreview()} disabled={newCount === 0}>
            {m.import_tx_preview_next()}
          </Button>
        </div>
      </div>
    {:else if s.phase === 'preview'}
      <!-- Phase: preview -->
      <div class="space-y-4">
        <p class="text-sm text-dim">
          {m.import_tx_summary({ count: newCount, duplicates: dupCount, invalid: invalidCount })}
        </p>

        <div class="max-h-96 overflow-y-auto border border-line rounded-md">
          <table class="w-full text-sm">
            <thead class="bg-ink sticky top-0">
              <tr class="text-left text-xs text-dim">
                <th class="p-2">{m.import_tx_col_include()}</th>
                <th class="p-2">{m.import_tx_col_date()}</th>
                <th class="p-2">{m.import_tx_col_payee()}</th>
                <th class="p-2 text-right">{m.import_tx_col_amount()}</th>
                <th class="p-2">{m.import_tx_col_status()}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-line">
              {#each s.rows as row, i}
                <tr class="{row.status === 'duplicate' ? 'opacity-50' : ''} {row.status === 'invalid' ? 'bg-debit/10' : ''}">
                  <td class="p-2">
                    <input type="checkbox" bind:checked={s.rows[i].included}
                      disabled={row.status === 'invalid'} />
                  </td>
                  <td class="p-2 text-ledger">{row.date ?? '—'}</td>
                  <td class="p-2 text-ledger">{row.payee ?? '—'}</td>
                  <td class="p-2 text-right figures {row.kind === 'expense' ? 'text-debit' : 'text-phosphor'}">
                    {#if row.amount != null}{formatCurrency(row.amount, settings.currency, settings.locale)}{/if}
                  </td>
                  <td class="p-2 text-xs">
                    {#if row.status === 'new'}{m.import_tx_status_new()}
                    {:else if row.status === 'duplicate'}{m.import_tx_status_duplicate()}
                    {:else}{m.import_tx_status_invalid()}{/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>

        <div class="flex justify-between">
          <Button variant="ghost" onclick={() => s.backToMapping()}>{m.import_tx_back()}</Button>
          <Button onclick={onCommit} disabled={includedCount === 0 || loading}>
            {m.import_tx_commit({ count: includedCount })}
          </Button>
        </div>
      </div>
    {:else if s.phase === 'done'}
      <p class="text-sm text-ledger">{m.import_tx_done()}</p>
      <div class="flex justify-end mt-4">
        <Button onclick={() => { open = false; reset(); }}>{m.import_tx_done()}</Button>
      </div>
    {/if}
  {/if}
</Modal>
