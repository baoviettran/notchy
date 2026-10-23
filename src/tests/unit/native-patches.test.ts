import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountPatch, Patch, TransactionPatch } from '$lib/native/contracts.generated';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => undefined) }));

import { invoke } from '@tauri-apps/api/core';
import { NativeDatabaseClient } from '$lib/db/native/client';

const client = new NativeDatabaseClient();
const cases: Array<{ name: string; value: string | null | undefined; expected: Patch<string> }> = [
	{ name: 'omitted', value: undefined, expected: { kind: 'omitted' } },
	{ name: 'cleared', value: null, expected: { kind: 'explicit_null' } },
	{ name: 'replaced', value: 'Coffee', expected: { kind: 'replace', value: 'Coffee' } },
	{ name: 'an empty string', value: '', expected: { kind: 'replace', value: '' } }
];

beforeEach(() => vi.clearAllMocks());

describe('native nullable edit fields', () => {
	it.each(cases)('encodes transaction fields when they are $name', async ({ value, expected }) => {
		await client.transactions.update('tx1', {
			amount: 60000, tag_id: value, payee: value, description: value
		});
		const patch: TransactionPatch = {
			kind: null, date: null, amount: 60000, transfer_account_id: null,
			tag_id: expected, payee: expected, description: expected
		};
		expect(invoke).toHaveBeenCalledWith('transaction_update', { id: 'tx1', patch, operationId: expect.any(String) });
	});

	it.each(cases)('encodes the account counterparty when it is $name', async ({ value, expected }) => {
		await client.accounts.update('acct1', { name: 'Updated', counterparty: value });
		const patch: AccountPatch = {
			name: 'Updated', type: null, counterparty: expected, archived: null
		};
		expect(invoke).toHaveBeenCalledWith('account_update', { id: 'acct1', patch, operationId: expect.any(String) });
	});
});
