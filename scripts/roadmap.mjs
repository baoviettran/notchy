// scripts/roadmap.mjs

export function normalizeSubject(subject) {
  const match = subject.match(/^(\w+)(?:\(([^)]+)\))?:\s*(.+)$/);
  if (!match) {
    return { type: null, scope: null, body: subject };
  }
  return {
    type: match[1],
    scope: match[2] || null,
    body: match[3]
  };
}

export function extractCommitSubject(taskFinalStepText) {
  // Form 1: Commit with `subject`
  const form1 = taskFinalStepText.match(/Commit with\s+`([^`]+)`/);
  if (form1) return form1[1];

  // Form 3: heredoc git commit -m "$(cat <<'EOF'\nsubject\n... (check before form2,
  // because form2's greedy "([^"]+)" would eat the heredoc body)
  const form3 = taskFinalStepText.match(/git commit -m "\$\(cat <<'?EOF'?\n([^\n]+)/);
  if (form3) return form3[1];

  // Form 2: git commit -m "subject"
  const form2 = taskFinalStepText.match(/git commit -m "([^"]+)"/);
  if (form2) return form2[1];

  return null;
}

export function matchGit(directiveSubject, commits) {
  const directiveBody = normalizeSubject(directiveSubject).body;
  let match = null;
  let additionalMatches = 0;

  for (const commit of commits) {
    const commitBody = normalizeSubject(commit.subject).body;
    if (commitBody.includes(directiveBody)) {
      if (!match) {
        match = { sha: commit.sha, additionalMatches: 0 };
      } else {
        additionalMatches++;
      }
    }
  }

  if (match) {
    match.additionalMatches = additionalMatches;
  }
  return match;
}

export function rollupStatus(tasks) {
  let stale = false;
  let allDone = true;
  let doneCount = 0;
  let allHaveCommits = tasks.length > 0;

  for (const task of tasks) {
    const allChecked = task.steps.length > 0 && task.steps.every(s => s.checkbox === 'x');
    const hasMatch = !!task.gitMatch;

    if (allChecked && !hasMatch) {
      stale = true;
    }

    const taskDone = allChecked && hasMatch;
    if (taskDone) doneCount++;
    else allDone = false;

    if (!hasMatch) allHaveCommits = false;
  }

  if (stale) return 'stale';
  if (allDone) return 'implemented';
  if (doneCount > 0) return 'in-progress';
  if (allHaveCommits) return 'implemented-pending-checkbox';
  return 'planned';
}

export function parseTasks(planText) {
  const tasks = [];
  const taskHeaderRegex = /^(#{2,3})\s+Task\s+(\d+):\s*(.+)$/gm;
  const terminalSectionRegex = /^## (Self-Review|Self-Review Notes|Summary|Acceptance|Out of Scope|Open Questions)/m;
  const stepRegex = /^- \[([ x])\]\s+\*\*Step\s+(\d+):\s*(.*?)\*\*\s*/gm;

  // Filter out code block content to avoid extracting example tasks from code blocks.
  // Replace code-block lines with same-length blank strings to preserve character offsets.
  const lines = planText.split('\n');
  let inCodeBlock = false;
  const cleanText = lines.map(line => {
    if (line.trim().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      return line; // keep fence lines as-is (they don't match task/step regex)
    }
    return inCodeBlock ? ' '.repeat(line.length) : line;
  }).join('\n');

  let match;
  const taskStarts = [];
  while ((match = taskHeaderRegex.exec(cleanText)) !== null) {
    taskStarts.push({
      headerLevel: match[1].length,
      number: parseInt(match[2]),
      title: match[3].trim(),
      startIndex: match.index,
      headerEnd: match.index + match[0].length
    });
  }

  for (let i = 0; i < taskStarts.length; i++) {
    const task = taskStarts[i];
    const nextTaskStart = i + 1 < taskStarts.length ? taskStarts[i + 1].startIndex : cleanText.length;

    // Use cleanText for finding task/step positions (avoids phantom tasks in code blocks)
    let cleanTaskBody = cleanText.slice(task.headerEnd, nextTaskStart);

    // Stop at terminal section
    const terminalMatch = cleanTaskBody.match(terminalSectionRegex);
    if (terminalMatch) {
      cleanTaskBody = cleanTaskBody.slice(0, terminalMatch.index);
    }

    // Use original planText for step content extraction (preserves code blocks with directives)
    const originalTaskBody = planText.slice(task.headerEnd, nextTaskStart);
    let originalBoundedBody = originalTaskBody;
    if (terminalMatch) {
      originalBoundedBody = originalTaskBody.slice(0, terminalMatch.index);
    }

    // Find step positions using cleanText
    const stepPositions = [];
    let stepMatch;
    stepRegex.lastIndex = 0;
    while ((stepMatch = stepRegex.exec(cleanTaskBody)) !== null) {
      stepPositions.push({
        checkbox: stepMatch[1],
        stepNum: parseInt(stepMatch[2]),
        title: stepMatch[3],
        index: stepMatch.index,
        end: stepMatch.index + stepMatch[0].length
      });
    }

    // Extract step content from original text (includes code blocks)
    // Text = bold title + body (everything after closing ** up to next step or end of task)
    const steps = [];
    for (let j = 0; j < stepPositions.length; j++) {
      const pos = stepPositions[j];
      const nextPos = j + 1 < stepPositions.length ? stepPositions[j + 1].index : originalBoundedBody.length;
      const body = originalBoundedBody.slice(pos.end, nextPos).trim();
      const text = body ? `${pos.title}\n\n${body}` : pos.title;
      steps.push({
        checkbox: pos.checkbox,
        stepNum: pos.stepNum,
        text
      });
    }

    tasks.push({
      headerLevel: task.headerLevel,
      number: task.number,
      title: task.title,
      steps
    });
  }

  return tasks;
}

export function validateStaleness(existingStatusMd, commits) {
  const warnings = [];
  if (!existingStatusMd) return { warnings };

  const shaRegex = /\|\s*([0-9a-f]{7})\s*\|/g;
  const commitShas = new Set(commits.map(c => c.sha));
  let match;
  while ((match = shaRegex.exec(existingStatusMd)) !== null) {
    const sha = match[1];
    if (!commitShas.has(sha)) {
      warnings.push(`⚠ stale: SHA ${sha} no longer in history (rebased/amended)`);
    }
  }

  return { warnings };
}

export function renderMarkdown(plans, commitCount) {
  const timestamp = new Date().toISOString();
  let md = `<!-- AUTO-GENERATED by \`pnpm test:roadmap\` on ${timestamp}. Do not hand-edit. -->\n`;
  md += `<!-- Re-run: pnpm test:roadmap. Source: specs/plans/*.md + git log. -->\n\n`;
  md += `# Roadmap Status\n`;
  md += `Generated: ${timestamp} | Plans: ${plans.length} | Commits: ${commitCount}\n\n`;

  for (const plan of plans) {
    md += `## Plan: ${plan.topic}\n`;
    md += `- Plan: ${plan.planPath}\n`;
    md += `- Spec: ${plan.specPath || '—'}\n`;
    md += `- Status: ${plan.status}\n\n`;

    md += `| Task | Title | Box | Commit subject | SHA | Status |\n`;
    md += `| --- | --- | --- | --- | --- | --- |\n`;

    for (const task of plan.tasks) {
      const openCount = task.steps.filter(s => s.checkbox === ' ').length;
      const totalCount = task.steps.length;
      const boxStr = `[${task.steps.every(s => s.checkbox === 'x') ? 'x' : ' '}] (${totalCount - openCount}/${totalCount})`;
      const shaStr = task.gitMatch ? task.gitMatch.sha : '—';
      const taskStatus = task.gitMatch
        ? (task.steps.every(s => s.checkbox === 'x') ? 'done' : 'committed, box open')
        : (task.steps.every(s => s.checkbox === 'x') ? 'stale (no commit)' : 'not started');

      md += `| ${task.number} | ${task.title} | ${boxStr} | ${task.directive || '—'} | ${shaStr} | ${taskStatus} |\n`;
    }
    md += `\n`;
  }

  return md;
}

export function renderStdoutTable(plans) {
  let table = 'Plan                          | Status                          | Tasks\n';
  table += '----------------------------- | ------------------------------- | -----\n';
  for (const plan of plans) {
    const doneCount = plan.tasks.filter(t => t.steps.every(s => s.checkbox === 'x')).length;
    const totalCount = plan.tasks.length;
    table += `${plan.topic.padEnd(28)} | ${plan.status.padEnd(30)} | ${doneCount}/${totalCount}\n`;
  }
  return table;
}

import { readFileSync, writeFileSync, existsSync, globSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

async function main() {
  // 1. Gather inputs
  const planPaths = globSync('specs/plans/*.md');
  const specPaths = globSync('specs/*.md');
  const gitLogOutput = execSync('git log --format="%h\t%s"', { encoding: 'utf-8' });
  const commits = gitLogOutput.trim().split('\n').map(line => {
    const [sha, ...subjectParts] = line.split('\t');
    return { sha, subject: subjectParts.join('\t') };
  });

  // 2. Build spec index by topic slug
  const specIndex = {};
  for (const specPath of specPaths) {
    const filename = specPath.split('/').pop();
    const match = filename.match(/^\d{4}-\d{2}-\d{2}-(.+?)(?:-design)?\.md$/);
    if (match) {
      specIndex[match[1]] = specPath;
    }
  }

  // 3. Parse each plan
  const plans = [];
  for (const planPath of planPaths.sort().reverse()) {
    const planText = readFileSync(planPath, 'utf-8');
    const filename = planPath.split('/').pop();
    const match = filename.match(/^\d{4}-\d{2}-\d{2}-(.+)\.md$/);
    const topic = match ? match[1] : filename;

    const tasks = parseTasks(planText);
    for (const task of tasks) {
      const finalStep = task.steps[task.steps.length - 1];
      const directive = finalStep ? extractCommitSubject(finalStep.text) : null;
      const gitMatch = directive ? matchGit(directive, commits) : null;
      task.directive = directive;
      task.gitMatch = gitMatch;
    }

    const status = rollupStatus(tasks);
    const specPath = specIndex[topic] || null;

    plans.push({ topic, planPath, specPath, status, tasks });
  }

  // 4. Validate staleness
  const existingStatusMd = existsSync('specs/STATUS.md') ? readFileSync('specs/STATUS.md', 'utf-8') : null;
  const { warnings } = validateStaleness(existingStatusMd, commits);
  for (const plan of plans) {
    const allBoxesFlipped = plan.tasks.every(t => t.steps.every(s => s.checkbox === 'x'));
    const noCommits = plan.tasks.every(t => !t.gitMatch);
    if (allBoxesFlipped && noCommits && plan.tasks.length > 0) {
      warnings.push(`⚠ stale: plan ${plan.topic} has all boxes flipped but no matching commits`);
    }
  }

  // 5. Render and write
  const markdown = renderMarkdown(plans, commits.length);
  writeFileSync('specs/STATUS.md', markdown);

  // 6. Print stdout table
  console.log(renderStdoutTable(plans));

  // 7. Exit with appropriate code
  if (warnings.length > 0) {
    for (const warning of warnings) {
      console.error(warning);
    }
    process.exit(1);
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
