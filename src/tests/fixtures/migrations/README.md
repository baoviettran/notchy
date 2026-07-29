# Released migration fixtures

These are committed SQLite snapshots of the only schemas that reached a release. They exercise the real user upgrade paths, rather than synthetic pre-release schemas.

| Fixture | Release tag | Applied migrations | Starting `schema_version` | SHA-256 |
| --- | --- | --- | --- | --- |
| `v003.sqlite` | `v0.1.0` | 001–003 | `3` | `7de2e5f72c8a45f0162fc8a84241534c3064a22117f5e17f6dc439b0d9865993` |
| `v004.sqlite` | `v0.1.1` (`v0.1.2` and `v0.1.3` use the same schema) | 001–004 | `4` | `dc25092540d0844ef370aefd358db9f0c98b57e2b73e950598d55e2577ea9dbd` |

Schemas 1 and 2 were never released, and schema 5 is unreleased. Do not add fixtures for them unless a future release makes an intermediate schema a real upgrade source.

## Seeded rows

The temporary Vitest builders used the following fixed values, in addition to the migrations' own seed data.

| Fixture | Account ID | Tag ID | Transaction ID | Integer amount | Tag type |
| --- | --- | --- | --- | --- | --- |
| `v003.sqlite` | `acct_fixture_v003` | `tag_fixture_v003` | `txn_fixture_v003` | `123456789` | `bucket_essentials` |
| `v004.sqlite` | `acct_fixture_v004` | `tag_fixture_v004` | `txn_fixture_v004` | `987654321` | `bucket_learning` |

Both transactions are `expense` rows and reference their fixture account and tag. The v004 builder also verified the migration-004 `rollover_enabled` default is `1` for `bucket_essentials`.

## Regeneration

Never use `git checkout` in the active worktree. Generate one fixture at a time in a disposable detached worktree. Create the following two temporary files in each worktree; together they are the canonical Vitest builder for regenerating these fixtures.

`fixture-vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
	resolve: {
		alias: { '$lib': new URL('./src/lib', import.meta.url).pathname }
	},
	test: { environment: 'node' }
});
```

`src/tests/fixture-builder.test.ts`:

```ts
import BetterSqlite3 from 'better-sqlite3';
import { rm } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { migrations } from '$lib/db/migrations';
import { runMigrations } from '$lib/db/migrations/runner';
import type { DatabaseService, QueryResult, Row } from '$lib/db/service';

const fixtures = {
	v003: {
		path: '/tmp/v003.sqlite', label: 'v003', version: 3, accountId: 'acct_fixture_v003',
		tagId: 'tag_fixture_v003', transactionId: 'txn_fixture_v003', amount: 123456789,
		accountType: 'checking', tagTypeId: 'bucket_essentials', now: '2025-02-03T04:05:06.789Z'
	},
	v004: {
		path: '/tmp/v004.sqlite', label: 'v004', version: 4, accountId: 'acct_fixture_v004',
		tagId: 'tag_fixture_v004', transactionId: 'txn_fixture_v004', amount: 987654321,
		accountType: 'savings', tagTypeId: 'bucket_learning', now: '2025-02-04T04:05:06.789Z'
	}
} as const;

const fixture = fixtures[process.env.NOTCHY_FIXTURE as keyof typeof fixtures];
if (!fixture) throw new Error('Set NOTCHY_FIXTURE to v003 or v004');

class FixtureDatabase implements DatabaseService {
	constructor(private db: BetterSqlite3.Database) {}
	async execute(sql: string, params: unknown[] = []): Promise<QueryResult> {
		const result = this.db.prepare(sql).run(...params);
		return { rowsAffected: result.changes, lastInsertId: Number(result.lastInsertRowid) };
	}
	async query<T = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
		return this.db.prepare(sql).all(...params) as T[];
	}
	async transaction<T>(fn: (tx: DatabaseService) => Promise<T>): Promise<T> {
		this.db.exec('SAVEPOINT fixture_builder');
		try {
			const result = await fn(this);
			this.db.exec('RELEASE SAVEPOINT fixture_builder');
			return result;
		} catch (error) {
			this.db.exec('ROLLBACK TO SAVEPOINT fixture_builder');
			this.db.exec('RELEASE SAVEPOINT fixture_builder');
			throw error;
		}
	}
	async close(): Promise<void> { this.db.close(); }
}

describe('released migration fixture builder', () => {
	it(`creates ${fixture.version}`, async () => {
		await rm(fixture.path, { force: true });
		const db = new FixtureDatabase(new BetterSqlite3(fixture.path));
		try {
			await runMigrations(db, migrations);
			await db.execute(
				`INSERT INTO accounts (id, name, type, currency, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
				[fixture.accountId, `Historical ${fixture.label} Account`, fixture.accountType, 'VND', fixture.now, fixture.now]
			);
			await db.execute(
				`INSERT INTO category_tags (id, type_id, name, is_system, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
				[fixture.tagId, fixture.tagTypeId, `Historical ${fixture.label} Tag`, 0, 99, fixture.now, fixture.now]
			);
			await db.execute(
				`INSERT INTO transactions (id, kind, date, amount, account_id, tag_id, payee, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				[fixture.transactionId, 'expense', fixture.now.slice(0, 10), fixture.amount, fixture.accountId, fixture.tagId, 'Historical Merchant', `Historical ${fixture.label} transaction`, fixture.now, fixture.now]
			);
			expect(await db.query<{ value: string }>(`SELECT value FROM app_meta WHERE key = 'schema_version'`)).toEqual([{ value: String(fixture.version) }]);
			if (fixture.version === 4) {
				expect(await db.query<{ rollover_enabled: number }>(`SELECT rollover_enabled FROM category_types WHERE id = 'bucket_essentials'`)).toEqual([{ rollover_enabled: 1 }]);
			}
		} finally {
			await db.close();
		}
	});
});
```

```sh
REPO=/absolute/path/to/local-personal-finance-management
git worktree add --detach /tmp/notchy-fixture-v003 v0.1.0
ln -s "$REPO/node_modules" /tmp/notchy-fixture-v003/node_modules
pnpm --dir /tmp/notchy-fixture-v003 exec svelte-kit sync
# Create the two temporary files above, then run this exact builder.
NOTCHY_FIXTURE=v003 pnpm --dir /tmp/notchy-fixture-v003 exec vitest run --config fixture-vitest.config.ts src/tests/fixture-builder.test.ts
cp /tmp/v003.sqlite "$REPO/src/tests/fixtures/migrations/v003.sqlite"
git worktree remove --force /tmp/notchy-fixture-v003

git worktree add --detach /tmp/notchy-fixture-v004 v0.1.1
ln -s "$REPO/node_modules" /tmp/notchy-fixture-v004/node_modules
pnpm --dir /tmp/notchy-fixture-v004 exec svelte-kit sync
# Create the two temporary files above, then run this exact builder.
NOTCHY_FIXTURE=v004 pnpm --dir /tmp/notchy-fixture-v004 exec vitest run --config fixture-vitest.config.ts src/tests/fixture-builder.test.ts
cp /tmp/v004.sqlite "$REPO/src/tests/fixtures/migrations/v004.sqlite"
git worktree remove --force /tmp/notchy-fixture-v004

sha256sum "$REPO/src/tests/fixtures/migrations/v003.sqlite" \
	"$REPO/src/tests/fixtures/migrations/v004.sqlite"
```

Migration 003 generates a `device_id` and timestamped seed rows at build time, so a regenerated binary can have a different checksum even when its schema and documented fixed rows are identical. Update this table's checksum whenever intentionally replacing a fixture.
