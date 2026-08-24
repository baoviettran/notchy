<script lang="ts">
  import { ImportStore } from '$lib/stores/import.svelte';
  import Modal from '$lib/components/primitives/Modal.svelte';
  import Button from '$lib/components/primitives/Button.svelte';
  import Select from '$lib/components/primitives/Select.svelte';
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

    // Warn if file > 10MB
    if (file.size > 10 * 1024 * 1024) {
      errorMsg = m.import_tx_error_file_too_large();
      return;
    }

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
    } catch {
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
        try {
          if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
            const { emit } = await import('@tauri-apps/api/event');
            await emit('transaction:saved', {});
          } else {
            window.dispatchEvent(new Event('transaction:saved'));
          }
        } catch { /* non-fatal: list refresh still runs below */ }
        await transactions.load();
        toast.show(count === 1 ? m.import_tx_commit_success_one({ count }) : m.import_tx_commit_success({ count }));
      } else {
        toast.show(m.import_tx_commit_none());
      }
      open = false;
      reset();
    } catch {
      errorMsg = m.import_tx_error_commit();
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

  const dateFormats = ['YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY'] as const;

  let currentPhase = $derived(store ? store.phase : 'select');

  // First data row's raw value for a column: every role dropdown shows what
  // it actually points at instead of asking the user to trust headers.
  function sampleFor(col: number | null): string | null {
    if (col == null || !store) return null;
    const raw = store.rows[0]?.raw?.[col];
    const s = raw == null ? '' : String(raw).trim();
    return s === '' ? null : s;
  }

  function columnOptions(s: ImportStore): { value: number | null; label: string }[] {
    return [
      { value: null, label: m.import_tx_mapping_ignore() },
      ...s.headerRow.map((header, i) => ({ value: i as number | null, label: header || m.import_tx_column_fallback({ number: i + 1 }) }))
    ];
  }

  type ColumnRole = 'date' | 'amount' | 'debit' | 'credit' | 'payee' | 'notes';
  type RoleGroup = 'money' | 'detail';

  function roleFields(s: ImportStore): { key: ColumnRole; label: string; col: number | null; group: RoleGroup }[] {
    return [
      { key: 'date', label: m.import_tx_mapping_date(), col: s.mapping.date, group: 'money' },
      ...(s.mapping.signConvention === 'signed'
        ? [{ key: 'amount' as const, label: m.import_tx_mapping_amount(), col: s.mapping.amount, group: 'money' as const }]
        : [
            { key: 'debit' as const, label: m.import_tx_mapping_debit(), col: s.mapping.debit, group: 'money' as const },
            { key: 'credit' as const, label: m.import_tx_mapping_credit(), col: s.mapping.credit, group: 'money' as const }
          ]),
      { key: 'payee', label: m.import_tx_mapping_payee(), col: s.mapping.payee, group: 'detail' },
      { key: 'notes', label: m.import_tx_mapping_notes(), col: s.mapping.notes, group: 'detail' }
    ];
  }

  const signOptions = [
    { value: 'signed', label: m.import_tx_mapping_sign_signed() },
    { value: 'debit_credit_separate', label: m.import_tx_mapping_sign_separate() }
  ];
  const localeOptions = [
    { value: 'en', label: m.import_tx_mapping_amount_locale_en() },
    { value: 'vi', label: m.import_tx_mapping_amount_locale_vi() }
  ];

  const dateFormatOptions = dateFormats.map((f) => ({ value: f, label: f }));
</script>

<Modal bind:open title={m.import_tx_title()} locked={loading}>
  {#if !store}
    <!-- Phase: select -->
    <div class="space-y-4">
      <Select
        label={m.import_tx_select_account()}
        bind:value={selectedAccountId}
        options={[{ value: '', label: '—' }, ...activeAccounts.map((acc) => ({ value: acc.id, label: acc.name }))]}
      />

      <div class="space-y-1">
        <span class="plate block">{m.import_tx_select_file()}</span>
        <input type="file" accept=".csv,text/csv" onchange={onFileChosen}
          class="block w-full text-sm text-dim file:mr-3 file:rounded-md file:border-0 file:bg-phosphor file:px-3 file:py-1.5 file:text-ink" />
      </div>

      {#if errorMsg}
        <p class="text-sm text-debit" role="alert">{errorMsg}</p>
      {/if}

      <div class="flex justify-end">
        <Button onclick={onLoad} disabled={!selectedAccountId || !fileText || loading}>
          {m.import_tx_load()}
        </Button>
      </div>
    </div>
  {:else}
    {@const s = store}
    {#if currentPhase === 'mapping'}
      <!-- Phase: editable mapping. Chunked into three labeled groups — money
           columns (the ones that decide whether a row is valid), detail
           columns, then formats. The sign convention sits above the money
           grid it reshapes, so the mutation reads as cause then effect. -->
      <div class="space-y-5">
        <section class="space-y-3">
          <h3 class="plate">{m.import_tx_group_money()}</h3>
          <Select label={m.import_tx_mapping_sign()} bind:value={s.mapping.signConvention} options={signOptions} />
          <div class="grid grid-cols-2 gap-x-4 gap-y-3">
            {#each roleFields(s).filter((r) => r.group === 'money') as role (role.key)}
              <div>
                <Select
                  label={role.label}
                  bind:value={s.mapping[role.key]}
                  options={columnOptions(s)}
                />
                {#if sampleFor(role.col)}
                  <p class="mt-1 text-xs text-dim figures truncate">{m.import_tx_mapping_sample()}: {sampleFor(role.col)}</p>
                {/if}
              </div>
            {/each}
          </div>
        </section>

        <section class="space-y-3 border-t border-line pt-4">
          <h3 class="plate">{m.import_tx_group_detail()}</h3>
          <div class="grid grid-cols-2 gap-x-4 gap-y-3">
            {#each roleFields(s).filter((r) => r.group === 'detail') as role (role.key)}
              <div>
                <Select
                  label={role.label}
                  bind:value={s.mapping[role.key]}
                  options={columnOptions(s)}
                />
                {#if sampleFor(role.col)}
                  <p class="mt-1 text-xs text-dim figures truncate">{m.import_tx_mapping_sample()}: {sampleFor(role.col)}</p>
                {/if}
              </div>
            {/each}
          </div>
        </section>

        <section class="space-y-3 border-t border-line pt-4">
          <h3 class="plate">{m.import_tx_group_formats()}</h3>
          <div class="grid grid-cols-2 gap-4">
            <Select label={m.import_tx_mapping_date_format()} bind:value={s.mapping.dateFormat} options={dateFormatOptions} />
            <Select label={m.import_tx_mapping_amount_locale()} bind:value={s.mapping.amountLocale} options={localeOptions} />
          </div>
        </section>

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
    {:else if currentPhase === 'preview'}
      <!-- Phase: preview -->
      <div class="space-y-4">
        <p class="text-sm text-dim">
          {m.import_tx_summary({ count: newCount, duplicates: dupCount, invalid: invalidCount })}
        </p>

        {#if errorMsg}
          <p class="text-sm text-debit" role="alert">{errorMsg}</p>
        {/if}

        <div class="max-h-96 overflow-y-auto border border-line rounded-md">
          <table class="w-full text-sm">
            <thead class="bg-ink sticky top-0">
              <tr class="text-left plate">
                <th class="p-2 font-normal">{m.import_tx_col_include()}</th>
                <th class="p-2 font-normal">{m.import_tx_col_date()}</th>
                <th class="p-2 font-normal">{m.import_tx_col_payee()}</th>
                <th class="p-2 text-right font-normal">{m.import_tx_col_amount()}</th>
                <th class="p-2 font-normal">{m.import_tx_col_status()}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-line">
              {#each s.rows as row, i}
                <tr class="{row.status !== 'new' ? 'opacity-50' : ''} {row.status === 'invalid' ? 'bg-debit/10' : ''}">
                  <td class="p-2">
                    <!-- Only genuinely new rows are committable; duplicates and
                          invalid rows are locked so a stray click can't double-book. -->
                    <input type="checkbox" bind:checked={s.rows[i].included}
                      disabled={row.status !== 'new'} />
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
    {:else if currentPhase === 'done'}
      <p class="text-sm text-ledger">{m.import_tx_done()}</p>
      <div class="flex justify-end mt-4">
        <Button onclick={() => { open = false; reset(); }}>{m.import_tx_done()}</Button>
      </div>
    {/if}
  {/if}
</Modal>
