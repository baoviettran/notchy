export type RowStatus = 'new' | 'duplicate' | 'invalid';

export interface ClassifyResult {
  status: RowStatus;
  duplicateOfId?: string;
  error?: string;
}

/**
 * Classify a single import row against existing transactions (DB rows +
 * already-classified pending rows from the same file).
 *
 * Match key is magnitude-only: (account_id, date, amount). Kind is NOT
 * compared — a bank that flips the sign on a re-export would otherwise slip
 * past a kind-aware check. Matching magnitude-only catches it.
 */
export function classifyRow(
  candidate: { accountId: string; date: string; amount: number; kind: 'expense' | 'income' },
  existing: { id: string; accountId: string; date: string; amount: number; kind: string }[]
): ClassifyResult {
  if (!candidate.date || !candidate.accountId) {
    return { status: 'invalid', error: 'missing_required_fields' };
  }
  if (candidate.amount <= 0 || !Number.isFinite(candidate.amount)) {
    return { status: 'invalid', error: 'invalid_amount' };
  }

  const match = existing.find(
    tx => tx.accountId === candidate.accountId &&
          tx.date === candidate.date &&
          tx.amount === candidate.amount
  );

  if (match) {
    return { status: 'duplicate', duplicateOfId: match.id };
  }
  return { status: 'new' };
}
