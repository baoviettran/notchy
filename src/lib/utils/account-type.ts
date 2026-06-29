import * as m from '$lib/paraglide/messages';
import type { AccountType } from '$lib/db/repos/accounts';

// Human-readable name for each account type. Used by the accounts list and
// detail page so the raw enum is never shown to the user.
const TYPE_LABELS: Record<AccountType, () => string> = {
	checking: m.forms_account_type_checking,
	savings: m.forms_account_type_savings,
	cash: m.forms_account_type_cash,
	credit_card: m.forms_account_type_credit_card,
	loan_to_person: m.forms_account_type_loan_to_person,
	loan_from_person: m.forms_account_type_loan_from_person
};

/** Resolve an account type to a localized label, falling back to the raw type. */
export function accountTypeLabel(type: AccountType): string {
	return (TYPE_LABELS[type] ?? (() => type))();
}

export { TYPE_LABELS };
