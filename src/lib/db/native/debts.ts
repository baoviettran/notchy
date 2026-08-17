/**
 * Debt domain adapter — inactive typed stub.
 *
 * Matches the signatures of `src/lib/db/repos/debts.ts`.
 * This module is NOT wired into the active import map; it exists only so
 * the future native-boundary cutover has a compilation-checked target.
 *
 * Every function throws at runtime if called.
 */

import type {
  DebtSummary,
  OperationId,
} from '$lib/native/contracts.generated';

export type { DebtSummary };

async function die(): Promise<never> {
  throw new Error('native debt adapter not wired');
}

export async function listDebts(): Promise<DebtSummary> {
  return die();
}

export async function writeOff(
  _accountId: string,
  _amount: number,
  _tagId: string,
  _opId: OperationId,
): Promise<string> {
  return die();
}
