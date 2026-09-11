import type { Task, Project, TaskComment } from '../types';

// ── YAML-like frontmatter serialization (v1, no external deps) ───────────────

function escapeYamlValue(value: string): string {
  if (value.includes('\n') || value.includes(':') || value.startsWith(' ') || value.startsWith('-')) {
    return JSON.stringify(value);
  }
  return value;
}

export function serializeTask(task: Task): string {
  const lines = [
    '---',
    `id: ${task.id}`,
    `title: ${escapeYamlValue(task.title)}`,
    `status: ${task.status}`,
    `importance: ${task.importance}`,
    `date: ${task.date}`,
    `projectId: ${task.projectId ?? ''}`,
    `assignees: ${task.assignees.join(', ')}`,
    `createdAt: ${task.createdAt}`,
    `updatedAt: ${task.updatedAt}`,
    `order: ${task.order}`,
    '---',
    '',
    task.content || '',
  ];
  return lines.join('\n');
}

export function parseTask(text: string): Partial<Task> & { content?: string } {
  const match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return {};

  const frontmatter = match[1];
  const content = match[2].trim();

  const result: Record<string, string> = {};
  for (const line of frontmatter.split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    result[key] = value;
  }

  const assignees = result.assignees
    ? result.assignees.split(',').map((s) => s.trim()).filter(Boolean)
    : [];

  return {
    id: result.id || undefined,
    title: result.title || undefined,
    status: (result.status as Task['status']) || undefined,
    importance: (result.importance as Task['importance']) || undefined,
    date: result.date || undefined,
    projectId: result.projectId || undefined,
    assignees,
    createdAt: result.createdAt ? Number(result.createdAt) : undefined,
    updatedAt: result.updatedAt ? Number(result.updatedAt) : undefined,
    order: result.order ? Number(result.order) : undefined,
    content,
  };
}

// ── INDEX.md generation ───────────────────────────────────────────────────────

interface FileEntry {
  path: string;
  taskTitle: string;
  summary?: string;
}

export function generateIndex(
  tasks: Task[],
  projects: Project[],
  files: FileEntry[]
): string {
  const lines = ['# Task Index', ''];

  // Projects
  lines.push('## Projects');
  lines.push('| Name | Color | Tasks |');
  lines.push('|------|-------|-------|');
  for (const p of projects) {
    const count = tasks.filter((t) => t.projectId === p.id).length;
    lines.push(`| ${p.name} | ${p.color} | ${count} |`);
  }
  lines.push('');

  // Tasks
  lines.push('## Tasks');
  lines.push('| Title | Status | Importance | Date | Project | Assignees | Order |');
  lines.push('|-------|--------|------------|------|---------|-----------|-------|');
  for (const t of tasks) {
    const proj = projects.find((p) => p.id === t.projectId);
    lines.push(
      `| ${t.title} | ${t.status} | ${t.importance} | ${t.date} | ${proj?.name ?? '—'} | ${t.assignees.join(', ') || '—'} | ${t.order} |`
    );
  }
  lines.push('');

  // Files
  if (files.length > 0) {
    lines.push('## Files');
    lines.push('| Path | Task | Summary |');
    lines.push('|------|------|---------|');
    for (const f of files) {
      lines.push(`| ${f.path} | ${f.taskTitle} | ${f.summary ?? '—'} |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ── Task summary generation ───────────────────────────────────────────────────

export function generateTaskSummary(
  task: Task,
  comments: TaskComment[],
  projectName?: string
): string {
  const lines = [
    `# Summary: ${task.title}`,
    '',
    '## Metadata',
    `- **Status:** ${task.status}`,
    `- **Importance:** ${task.importance}`,
    `- **Date:** ${task.date}`,
    `- **Project:** ${projectName ?? '—'}`,
    `- **Assignees:** ${task.assignees.join(', ') || '—'}`,
    `- **Created:** ${new Date(task.createdAt).toLocaleString()}`,
    `- **Updated:** ${new Date(task.updatedAt).toLocaleString()}`,
    '',
    '## Comments',
  ];

  if (comments.length === 0) {
    lines.push('_No comments yet._');
  } else {
    for (const c of comments) {
      const date = new Date(c.createdAt).toLocaleString();
      lines.push(`- **${date}:** ${c.text}`);
      if (c.attachmentDataUrl) {
        lines.push('  - Attachment: [local file]');
      }
    }
  }

  lines.push('');
  return lines.join('\n');
}

// ── Date helpers for NLP parser ───────────────────────────────────────────────

export function getTodayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function getTomorrowIso(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function addDaysIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function parseIsoDate(input: string): string | null {
  // Try YYYY-MM-DD
  const isoMatch = input.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return input;

  // Try MM/DD/YYYY or DD/MM/YYYY
  const slashMatch = input.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slashMatch) {
    const [, m, d, y] = slashMatch;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  return null;
}
