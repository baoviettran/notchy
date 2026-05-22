import type { Migration } from './runner';
import { ulid } from '../../utils/id';

export const migration003: Migration = {
	version: 3,
	name: 'seed_data',
	async up(db) {
		const now = new Date().toISOString();

		// Generate device_id
		await db.execute(
			`INSERT OR IGNORE INTO app_meta (key, value) VALUES ('device_id', ?)`,
			[ulid()]
		);

		// Seed buckets
		const buckets = [
			{ id: 'bucket_essentials', name: 'Essentials', budgetable: 1, sort: 0, is_system: 0 },
			{ id: 'bucket_learning', name: 'Learning & Entertainment', budgetable: 1, sort: 1, is_system: 0 },
			{ id: 'bucket_saving', name: 'Saving & Investment', budgetable: 1, sort: 2, is_system: 0 },
			{ id: 'bucket_adjustments', name: 'Adjustments', budgetable: 0, sort: 3, is_system: 1 }
		];

		for (const b of buckets) {
			await db.execute(
				`INSERT OR IGNORE INTO category_types (id, name, is_system, budgetable, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
				[b.id, b.name, b.is_system, b.budgetable, b.sort, now, now]
			);
		}

		// Seed system tags
		const tags = [
			{ id: 'tag_initial_balance', type_id: 'bucket_adjustments', name: 'Initial Balance' },
			{ id: 'tag_loss', type_id: 'bucket_adjustments', name: 'Loss' },
			{ id: 'tag_gift', type_id: 'bucket_adjustments', name: 'Gift' },
			{ id: 'tag_reconciliation', type_id: 'bucket_adjustments', name: 'Reconciliation' }
		];

		for (const t of tags) {
			await db.execute(
				`INSERT OR IGNORE INTO category_tags (id, type_id, name, is_system, sort_order, created_at, updated_at) VALUES (?, ?, ?, 1, 0, ?, ?)`,
				[t.id, t.type_id, t.name, now, now]
			);
		}
	}
};
