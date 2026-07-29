import { describe, it, expect } from 'vitest';
import { normalizeSubject, extractCommitSubject, parseTasks, matchGit } from './roadmap.mjs';

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
