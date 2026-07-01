import type { DatabaseService } from '$lib/db/service';
import { getMeta, setMeta } from './meta';

const KEY = 'default_quick_account_id';

export async function getDefaultQuickAccount(db: DatabaseService): Promise<string | null> {
  const v = await getMeta(db, KEY);
  return v ?? null;
}

export async function setDefaultQuickAccount(db: DatabaseService, accountId: string): Promise<void> {
  await setMeta(db, KEY, accountId);
}
