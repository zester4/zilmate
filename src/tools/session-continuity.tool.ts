// src/tools/session-continuity.tool.ts
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { tool } from 'ai';
import { z } from 'zod';
import { generateText } from 'ai';
import { models } from '../config/models.js';
import { workspaceLayout } from '../workspace/paths.js';
import { loadTurns } from '../memory/history.js';
import { appendNotebookMarkdown } from '../memory/notebook.js';
import { emitProgress } from '../runtime/progress.js';

type Handoff = {
  sessionId: string;
  summary: string;
  nextActions: string[];
  openThreads: string[];
  updatedAt: string;
};

function handoffPath(sessionId: string) {
  return path.join(workspaceLayout().config, `handoff-${sessionId}.json`);
}

export async function loadSessionHandoff(sessionId: string): Promise<Handoff | null> {
  const file = handoffPath(sessionId);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(await readFile(file, 'utf8')) as Handoff;
  } catch {
    return null;
  }
}

export async function saveSessionHandoff(sessionId: string, input: Omit<Handoff, 'sessionId' | 'updatedAt'>) {
  const payload: Handoff = {
    sessionId,
    ...input,
    updatedAt: new Date().toISOString(),
  };
  await mkdir(workspaceLayout().config, { recursive: true });
  await writeFile(handoffPath(sessionId), JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}

export const sessionContinuityTools = {
  getSessionHandoff: tool({
    description: 'Load the last session handoff: summary, next actions, and open threads so you can continue seamlessly.',
    inputSchema: z.object({ sessionId: z.string().optional() }),
    execute: async ({ sessionId = 'default' }) => loadSessionHandoff(sessionId),
  }),

  saveSessionHandoff: tool({
    description: 'Save a session handoff before ending work so the next session can resume instantly.',
    inputSchema: z.object({
      sessionId: z.string().optional(),
      summary: z.string().min(10),
      nextActions: z.array(z.string()).min(1),
      openThreads: z.array(z.string()).optional(),
    }),
    execute: async ({ sessionId = 'default', summary, nextActions, openThreads }) => {
      const saved = await saveSessionHandoff(sessionId, {
        summary,
        nextActions,
        openThreads: openThreads ?? [],
      });
      await appendNotebookMarkdown('Session handoff', `${summary}\n\nNext:\n${nextActions.map((a) => `- ${a}`).join('\n')}`);
      return saved;
    },
  }),

  generateSessionHandoff: tool({
    description: 'Automatically synthesize a session handoff from recent chat turns.',
    inputSchema: z.object({ sessionId: z.string().optional() }),
    execute: async ({ sessionId = 'default' }) => {
      emitProgress({ type: 'thinking', label: 'Generating session handoff' });
      const turns = await loadTurns(sessionId);
      const transcript = turns.slice(-12).map((t) => `${t.role}: ${t.content.slice(0, 400)}`).join('\n');
      const result = await generateText({
        model: models.manager,
        prompt: `Create JSON only: {"summary":"...","nextActions":["..."],"openThreads":["..."]}\nFrom this session:\n${transcript || '(empty session)'}`,
      });
      let parsed: { summary?: string; nextActions?: string[]; openThreads?: string[] } = {};
      try {
        const match = result.text.match(/\{[\s\S]*\}/);
        parsed = match ? JSON.parse(match[0]) as typeof parsed : {};
      } catch {
        parsed = { summary: result.text.trim(), nextActions: ['Continue previous task'] };
      }
      const saved = await saveSessionHandoff(sessionId, {
        summary: parsed.summary || 'Session handoff',
        nextActions: parsed.nextActions?.length ? parsed.nextActions : ['Review last conversation'],
        openThreads: parsed.openThreads ?? [],
      });
      emitProgress({ type: 'done', label: 'Handoff saved' });
      return saved;
    },
  }),
};
