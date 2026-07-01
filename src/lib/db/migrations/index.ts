import type { Migration } from './runner';
import { migration001 } from './001_initial';
import { migration002 } from './002_triggers';
import { migration003 } from './003_seed';
import { migration004 } from './004_rollover_toggle';

export const migrations: Migration[] = [migration001, migration002, migration003, migration004];
