/**
 * Reconciliation domain adapter — inactive typed stub.
 *
 * Matches the signatures of `src/lib/db/repos/reconciliations.ts`.
 * This module is NOT wired into the active import map; it exists only so
 * the future native-boundary cutover has a compilation-checked target.
 *
 * Every function throws at runtime if called.
 */

import type {
  OperationId,
  Reconciliation,
  ReconcileResult,
} from '$lib/native/contracts.generated';

export type { Reconciliation, ReconcileResult };

async function die(): Promise<never> {
  throw new Error('native reconciliation adapter not wired');
}

export async function getReconciliationHistory(
  _accountId: string,
): Promise<Reconciliation[]> {
  return die();
}

export async function reconcile(
  _accountId: string,
  _actualBalance: number,
  _createAdjustment: boolean,
  _opId: OperationId,
  _notes?: string | null,
): Promise<ReconcileResult> {
  return die();
}
