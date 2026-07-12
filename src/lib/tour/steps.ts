export interface TourStep {
	id: string;
	/** CSS selectors tried in order; first visible element wins. */
	targets: string[];
	titleKey: string;
	bodyKey: string;
}

export const TOUR_STEPS: TourStep[] = [
	{
		id: 'net',
		targets: ['[data-tour="net"]'],
		titleKey: 'tour_net_title',
		bodyKey: 'tour_net_body'
	},
	{
		id: 'add',
		targets: ['[data-tour="add"]'],
		titleKey: 'tour_add_title',
		bodyKey: 'tour_add_body'
	},
	{
		id: 'transactions',
		targets: ['[data-tour="transactions"]'],
		titleKey: 'tour_transactions_title',
		bodyKey: 'tour_transactions_body'
	},
	{
		id: 'budgets',
		targets: ['[data-tour="budgets"]'],
		titleKey: 'tour_budgets_title',
		bodyKey: 'tour_budgets_body'
	},
	{
		id: 'more',
		targets: ['[data-tour="accounts"]', '[data-tour="settings"]'],
		titleKey: 'tour_more_title',
		bodyKey: 'tour_more_body'
	}
];
