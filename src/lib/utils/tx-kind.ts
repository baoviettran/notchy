import * as m from '$lib/paraglide/messages';

// Human-readable fallback for transactions without a payee — name the entry
// by what it is to the person reading the list, never the raw system kind.
const KIND_LABELS: Record<string, () => string> = {
	expense: m.forms_expense,
	income: m.forms_income,
	transfer: m.forms_transfer,
	refund: m.forms_refund,
	adjustment: m.forms_adjustment
};

/** Resolve a raw transaction kind to a localized label, falling back to the raw kind. */
export function labelFor(kind: string): string {
	return (KIND_LABELS[kind] ?? (() => kind))();
}

export { KIND_LABELS };
