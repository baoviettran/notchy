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

export function parseTasks(planText) {
  const tasks = [];
  const taskHeaderRegex = /^(#{2,3})\s+Task\s+(\d+):\s*(.+)$/gm;
  const terminalSectionRegex = /^## (Self-Review|Self-Review Notes|Summary|Acceptance|Out of Scope|Open Questions)/m;
  const stepRegex = /^- \[([ x])\]\s+\*\*Step\s+(\d+):\s*(.+?)\*\*\s*$/gm;

  let match;
  const taskStarts = [];
  while ((match = taskHeaderRegex.exec(planText)) !== null) {
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
    const nextTaskStart = i + 1 < taskStarts.length ? taskStarts[i + 1].startIndex : planText.length;
    let taskBody = planText.slice(task.headerEnd, nextTaskStart);

    // Stop at terminal section
    const terminalMatch = taskBody.match(terminalSectionRegex);
    if (terminalMatch) {
      taskBody = taskBody.slice(0, terminalMatch.index);
    }

    const steps = [];
    let stepMatch;
    stepRegex.lastIndex = 0;
    while ((stepMatch = stepRegex.exec(taskBody)) !== null) {
      steps.push({
        checkbox: stepMatch[1],
        stepNum: parseInt(stepMatch[2]),
        text: stepMatch[3]
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
