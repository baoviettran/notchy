// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { ImportStore } from '$lib/stores/import.svelte';
import { createTestDb } from './helpers/test-db';
import { runMigrations } from '$lib/db/migrations/runner';
import { migrations } from '$lib/db/migrations/index';
import * as txRepo from '$lib/db/repos/transactions';
import type { DatabaseService } from '$lib/db/service';

describe('ImportStore', () => {
  let db: DatabaseService;
  let store: InstanceType<typeof ImportStore>;

  beforeEach(async () => {
    db = createTestDb();
    await runMigrations(db, migrations);
    await db.execute(
      `INSERT INTO accounts (id, name, type, currency, created_at, updated_at)
       VALUES ('acc1', 'Checking', 'checking', 'VND', datetime('now'), datetime('now'))`
    );
    store = new ImportStore(db, 'VND');
  });

  it('starts in select phase', () => {
    expect(store.phase).toBe('select');
  });

  it('transitions to mapping after loadFile and infers columns', async () => {
    const csv = 'date,amount,payee\n2024-01-01,100,Store\n2024-01-02,200,Other';
    await store.loadFile(csv, 'acc1');
    expect(store.phase).toBe('mapping');
    expect(store.mapping.date).toBe(0);
    expect(store.mapping.amount).toBe(1);
    expect(store.mapping.payee).toBe(2);
  });

  it('flags rows matching an existing DB transaction as duplicate (excluded by default)', async () => {
    await txRepo.createTransaction(db, {
      kind: 'expense', date: '2024-01-01', amount: 100, account_id: 'acc1', payee: 'Store'
    });

    const csv = 'date,amount,payee\n2024-01-01,100,Store\n2024-01-02,200,Other';
    await store.loadFile(csv, 'acc1');

    expect(store.rows).toHaveLength(2);
    expect(store.rows[0].status).toBe('duplicate');
    expect(store.rows[0].included).toBe(false);
    expect(store.rows[1].status).toBe('new');
    expect(store.rows[1].included).toBe(true);
  });

  it('flags the second identical row in the same file as a duplicate of the first', async () => {
    const csv = 'date,amount,payee\n2024-01-01,100,Store\n2024-01-01,100,Store';
    await store.loadFile(csv, 'acc1');

    expect(store.rows).toHaveLength(2);
    expect(store.rows[0].status).toBe('new');
    expect(store.rows[0].included).toBe(true);
    expect(store.rows[1].status).toBe('duplicate');
    expect(store.rows[1].included).toBe(false);
  });

  it('commits only included non-invalid rows', async () => {
    const csv = 'date,amount,payee\n2024-01-01,100,Store A\n2024-01-02,200,Store B';
    await store.loadFile(csv, 'acc1');

    // User unchecks the first row
    store.rows[0].included = false;

    const count = await store.commit();
    expect(count).toBe(1);

    const txs = await txRepo.listTransactions(db, { account_id: 'acc1' });
    expect(txs).toHaveLength(1);
    expect(txs[0].payee).toBe('Store B');
  });

  it('detects duplicates among transactions older than the default limit of 50', async () => {
    // Insert 60 transactions spanning Jan 1 – Mar 1 2024 (60 days).
    // listTransactions orders by date DESC, so with limit=50 the 10 oldest
    // (Jan 1–10) would be missed. The CSV duplicates Jan 5 (day 5, oldest
    // decile) to prove the explicit large limit loads all rows for dedup.
    for (let i = 0; i < 60; i++) {
      const d = new Date(2024, 0, 1 + i); // Jan 1 + i days
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      await txRepo.createTransaction(db, {
        kind: 'expense',
        date: iso,
        amount: 100 * (i + 1),
        account_id: 'acc1',
        payee: `Store ${i + 1}`
      });
    }

    // Row 1 duplicates Jan 5 (amount=500, the 5th inserted, beyond top-50 DESC).
    // Row 2 is genuinely new.
    const csv = 'date,amount,payee\n2024-01-05,500,Store 5\n2024-07-01,999,New Store';
    await store.loadFile(csv, 'acc1');

    expect(store.rows).toHaveLength(2);
    expect(store.rows[0].status).toBe('duplicate');
    expect(store.rows[0].included).toBe(false);
    expect(store.rows[1].status).toBe('new');
    expect(store.rows[1].included).toBe(true);
  });

  it('reclassifies amounts when the user switches the amount locale to vi', async () => {
    // EU-format amounts under a US-inferred locale parse wrong until overridden.
    // Amount field is quoted because it contains an embedded comma (1.234,56).
    const csv = 'date,amount,payee\n01/01/2024,"1.234,56",Store';
    await store.loadFile(csv, 'acc1');

    // With vi amountLocale, "1.234,56" → 1234.56 → 1235 VND (Math.round).
    store.mapping.amountLocale = 'vi';
    store.reclassify();

    const valid = store.rows.filter(r => r.status !== 'invalid');
    expect(valid.length).toBeGreaterThan(0);
    expect(valid[0].amount).toBe(1235);
  });
});
