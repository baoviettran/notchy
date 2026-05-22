export interface UndoEntry {
	id: string;
	description: string;
	undo: () => Promise<void>;
	expires: number;
}

class SessionStore {
	lastUsedAccountId = $state<string | null>(null);
	lastEnteredDate = $state<string | null>(null);
	undoStack = $state<UndoEntry[]>([]);

	pushUndo(entry: Omit<UndoEntry, 'expires'>): void {
		this.undoStack = [{ ...entry, expires: Date.now() + 5000 }];
	}

	popUndo(): UndoEntry | null {
		const entry = this.undoStack[0] ?? null;
		this.undoStack = [];
		return entry;
	}
}

export const session = new SessionStore();
