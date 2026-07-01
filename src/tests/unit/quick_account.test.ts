import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from './helpers/test-db';
import { runMigrations } from '$lib/db/migrations/runner';
import { migrations } from '$lib/db/migrations/index';
import { getDefaultQuickAccount, setDefaultQuickAccount } from '$lib/db/repos/quick_account';
import { createAccount } from '$lib/db/repos/accounts';
import type { DatabaseService } from '$lib/db/service';

let db: DatabaseService;
beforeEach(async () => {
  db = createTestDb();
  await runMigrations(db, migrations);
});

describe('default quick account meta', () => {
  it('returns null when unset', async () => {
    expect(await getDefaultQuickAccount(db)).toBeNull();
  });

  it('round-trips a set value', async () => {
    const id = await createAccount(db, { name: 'Checking', type: 'checking', currency: 'VND' });
    await setDefaultQuickAccount(db, id);
    expect(await getDefaultQuickAccount(db)).toBe(id);
  });

  it('overwrites the previous value', async () => {
    const a = await createAccount(db, { name: 'A', type: 'checking', currency: 'VND' });
    const b = await createAccount(db, { name: 'B', type: 'savings', currency: 'VND' });
    await setDefaultQuickAccount(db, a);
    await setDefaultQuickAccount(db, b);
    expect(await getDefaultQuickAccount(db)).toBe(b);
  });
});
