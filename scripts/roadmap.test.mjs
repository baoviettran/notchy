import { describe, it, expect } from 'vitest';
import { normalizeSubject, extractCommitSubject, parseTasks, matchGit, rollupStatus, validateStaleness, renderMarkdown, renderStdoutTable } from './roadmap.mjs';

describe('normalizeSubject', () => {
  it('parses type(scope): body', () => {
    const result = normalizeSubject('feat(categorize-rules): add migration 005');
    expect(result).toEqual({
      type: 'feat',
      scope: 'categorize-rules',
      body: 'add migration 005'
    });
  });

  it('parses type: body (no scope)', () => {
    const result = normalizeSubject('test: cover upgrades from released database fixtures');
    expect(result).toEqual({
      type: 'test',
      scope: null,
      body: 'cover upgrades from released database fixtures'
    });
  });

  it('returns body=whole subject if no conventional prefix', () => {
    const result = normalizeSubject('just a plain subject');
    expect(result).toEqual({
      type: null,
      scope: null,
      body: 'just a plain subject'
    });
  });
});

describe('extractCommitSubject', () => {
  it('extracts from "Commit with `subject`" form', () => {
    const text = 'Step 6: Commit with `test: cover upgrades from released database fixtures`.';
    const result = extractCommitSubject(text);
    expect(result).toBe('test: cover upgrades from released database fixtures');
  });

  it('extracts from git commit -m "subject" form', () => {
    const text = '```bash\ngit commit -m "feat(categorize-rules): add migration 005"\n```';
    const result = extractCommitSubject(text);
    expect(result).toBe('feat(categorize-rules): add migration 005');
  });

  it('extracts from heredoc form', () => {
    const text = 'git commit -m "$(cat <<\'EOF\'\nfeat(db): add migration 005\nEOF\n)"';
    const result = extractCommitSubject(text);
    expect(result).toBe('feat(db): add migration 005');
  });

  it('returns null if no directive found', () => {
    const text = 'Just a regular step with no commit directive';
    const result = extractCommitSubject(text);
    expect(result).toBeNull();
  });
});

describe('parseTasks', () => {
  it('parses ### Task headers', () => {
    const planText = `
### Task 1: First task

Some description.

- [ ] **Step 1: Do something.**
- [ ] **Step 2: Commit with \`test: first task\`.**

### Task 2: Second task

- [ ] **Step 1: Do another thing.**
- [ ] **Step 2: Commit with \`docs: second task\`.**

## Self-Review

Some review notes.
`;
    const tasks = parseTasks(planText);
    expect(tasks).toHaveLength(2);
    expect(tasks[0]).toEqual({
      headerLevel: 3,
      number: 1,
      title: 'First task',
      steps: [
        { checkbox: ' ', stepNum: 1, text: 'Do something.' },
        { checkbox: ' ', stepNum: 2, text: 'Commit with `test: first task`.' }
      ]
    });
    expect(tasks[1].number).toBe(2);
    expect(tasks[1].title).toBe('Second task');
  });

  it('parses ## Task headers (h2)', () => {
    const planText = `
## Task 1: H2 task

- [ ] **Step 1: Do it.**
`;
    const tasks = parseTasks(planText);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].headerLevel).toBe(2);
  });

  it('stops at terminal sections', () => {
    const planText = `
### Task 1: Real task

- [ ] **Step 1: Do it.**

## Summary

This is not a task.
`;
    const tasks = parseTasks(planText);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe('Real task');
  });
});

describe('matchGit', () => {
  const commits = [
    { sha: 'abc1234', subject: 'feat(db): add migration 005 for categorize_rules table' },
    { sha: 'def5678', subject: 'test: cover upgrades from released database fixtures' },
    { sha: 'ghi9012', subject: 'docs: add desktop release smoke checklist' }
  ];

  it('matches scope-agnostic body substring', () => {
    const result = matchGit('feat(categorize-rules): add migration 005 for categorize_rules table', commits);
    expect(result).toEqual({ sha: 'abc1234', additionalMatches: 0 });
  });

  it('matches unscoped directive', () => {
    const result = matchGit('test: cover upgrades from released database fixtures', commits);
    expect(result).toEqual({ sha: 'def5678', additionalMatches: 0 });
  });

  it('returns null if no match', () => {
    const result = matchGit('feat: nonexistent feature', commits);
    expect(result).toBeNull();
  });

  it('counts additional matches', () => {
    const commitsWithDupes = [
      { sha: 'aaa1111', subject: 'test: cover upgrades from released database fixtures' },
      { sha: 'bbb2222', subject: 'test: cover upgrades from released database fixtures' },
      { sha: 'ccc3333', subject: 'docs: something else' }
    ];
    const result = matchGit('test: cover upgrades from released database fixtures', commitsWithDupes);
    expect(result).toEqual({ sha: 'aaa1111', additionalMatches: 1 });
  });
});

describe('rollupStatus', () => {
  it('returns planned when no tasks done', () => {
    const tasks = [
      { steps: [{ checkbox: ' ' }], directive: null, gitMatch: null },
      { steps: [{ checkbox: ' ' }], directive: null, gitMatch: null }
    ];
    expect(rollupStatus(tasks)).toBe('planned');
  });

  it('returns in-progress when some tasks done', () => {
    const tasks = [
      { steps: [{ checkbox: 'x' }], directive: 'test: done', gitMatch: { sha: 'abc1234' } },
      { steps: [{ checkbox: ' ' }], directive: null, gitMatch: null }
    ];
    expect(rollupStatus(tasks)).toBe('in-progress');
  });

  it('returns implemented when all tasks have box [x] and commit matched', () => {
    const tasks = [
      { steps: [{ checkbox: 'x' }], directive: 'test: one', gitMatch: { sha: 'abc1234' } },
      { steps: [{ checkbox: 'x' }], directive: 'test: two', gitMatch: { sha: 'def5678' } }
    ];
    expect(rollupStatus(tasks)).toBe('implemented');
  });

  it('returns implemented-pending-checkbox when all commits present but boxes open', () => {
    const tasks = [
      { steps: [{ checkbox: ' ' }], directive: 'test: one', gitMatch: { sha: 'abc1234' } },
      { steps: [{ checkbox: ' ' }], directive: 'test: two', gitMatch: { sha: 'def5678' } }
    ];
    expect(rollupStatus(tasks)).toBe('implemented-pending-checkbox');
  });

  it('returns stale when box [x] but no matching commit', () => {
    const tasks = [
      { steps: [{ checkbox: 'x' }], directive: 'test: missing', gitMatch: null }
    ];
    expect(rollupStatus(tasks)).toBe('stale');
  });
});

describe('validateStaleness', () => {
  it('returns empty warnings if STATUS.md does not exist', () => {
    const result = validateStaleness(null, []);
    expect(result.warnings).toHaveLength(0);
  });

  it('returns empty warnings if all SHAs present', () => {
    const statusMd = `
| Task | SHA |
| --- | --- |
| 1 | abc1234 |
`;
    const commits = [{ sha: 'abc1234', subject: 'test' }];
    const result = validateStaleness(statusMd, commits);
    expect(result.warnings).toHaveLength(0);
  });

  it('warns if SHA in STATUS.md not in git log', () => {
    const statusMd = `
| Task | SHA |
| --- | --- |
| 1 | abc1234 |
| 2 | def5678 |
`;
    const commits = [{ sha: 'abc1234', subject: 'test' }];
    const result = validateStaleness(statusMd, commits);
    expect(result.warnings).toContain('⚠ stale: SHA def5678 no longer in history (rebased/amended)');
  });
});

describe('renderMarkdown', () => {
  it('renders header with timestamp and summary', () => {
    const plans = [
      {
        topic: 'test-confidence',
        planPath: 'specs/plans/2026-07-27-test-confidence-improvement.md',
        specPath: 'specs/2026-07-27-test-confidence-audit.md',
        status: 'implemented-pending-checkbox',
        tasks: [
          {
            number: 1,
            title: 'Add migration fixtures',
            steps: [{ checkbox: ' ' }, { checkbox: ' ' }],
            directive: 'test: cover upgrades',
            gitMatch: { sha: 'abc1234' }
          }
        ]
      }
    ];
    const md = renderMarkdown(plans, 231);
    expect(md).toContain('<!-- AUTO-GENERATED');
    expect(md).toContain('# Roadmap Status');
    expect(md).toContain('Plans: 1 | Commits: 231');
    expect(md).toContain('## Plan: test-confidence');
    expect(md).toContain('implemented-pending-checkbox');
  });
});

describe('renderStdoutTable', () => {
  it('renders one row per plan', () => {
    const plans = [
      { topic: 'test-confidence', status: 'implemented', tasks: [{ steps: [{ checkbox: 'x' }] }, { steps: [{ checkbox: 'x' }] }] },
      { topic: 'categorize-rules', status: 'in-progress', tasks: [{ steps: [{ checkbox: 'x' }] }, { steps: [{ checkbox: ' ' }] }] }
    ];
    const table = renderStdoutTable(plans);
    expect(table).toContain('test-confidence');
    expect(table).toContain('implemented');
    expect(table).toContain('categorize-rules');
    expect(table).toContain('in-progress');
  });
});
