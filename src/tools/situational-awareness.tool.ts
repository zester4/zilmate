// src/tools/situational-awareness.tool.ts
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { tool } from 'ai';
import { z } from 'zod';
import { env, hasComposio, hasGatewayAuth, hasQStash, hasRedis } from '../config/env.js';
import { models } from '../config/models.js';
import { listJobs } from '../jobs/store.js';
import { recall, listMemories } from '../memory/long-term.js';
import { loadPersonalContext } from '../memory/personal-context.js';
import { getKnowledgeGraph } from '../memory/knowledge-graph.js';
import { workspaceLayout } from '../workspace/paths.js';
import { loadModelSelections } from '../config/model-store.js';
import { emitProgress } from '../runtime/progress.js';

async function gitBrief(cwd: string) {
  if (!existsSync(path.join(cwd, '.git'))) return 'not a git repo';
  return new Promise<string>((resolve) => {
    spawn('git', ['status', '-sb'], { cwd, shell: process.platform === 'win32', windowsHide: true })
      .stdout?.on('data', (c) => { resolve(String(c).trim().slice(0, 500)); });
    setTimeout(() => resolve('git unavailable'), 3000);
  });
}

export async function buildSituationBrief(sessionId?: string) {
  const cwd = process.cwd();
  const layout = workspaceLayout();
  const [jobs, memories, context, graph, modelStore] = await Promise.all([
    listJobs({ limit: 8 }),
    listMemories(),
    loadPersonalContext(),
    getKnowledgeGraph(),
    loadModelSelections(),
  ]);

  let packageName = path.basename(cwd);
  try {
    const pkg = JSON.parse(await readFile(path.join(cwd, 'package.json'), 'utf8')) as { name?: string };
    if (pkg.name) packageName = pkg.name;
  } catch {
    // ignore
  }

  return {
    sessionId: sessionId || 'default',
    cwd,
    package: packageName,
    platform: `${process.platform} · Node ${process.versions.node}`,
    workspace: layout.root,
    models: {
      manager: models.manager,
      coding: models.coding,
      image: models.image,
      overrides: modelStore.roles,
    },
    capabilities: {
      gateway: hasGatewayAuth(),
      composio: hasComposio(),
      redis: hasRedis(),
      qstash: hasQStash(),
      jobs: env.zilmateJobsEnabled,
      voice: env.zilmateVoiceEnabled,
    },
    git: await gitBrief(cwd),
    recentJobs: jobs.map((j) => ({ id: j.id, status: j.status, task: j.task.slice(0, 120) })),
    memoryCount: memories.length,
    owner: context.ownerName || graph.ownerName || '',
    activeProjects: context.projects.filter((p) => p.status === 'active').map((p) => p.name),
    knowledgeNodes: graph.nodes.length,
  };
}

export const situationalAwarenessTools = {
  getSituationBrief: tool({
    description: 'Get a rich snapshot of the user environment: cwd, git, workspace, models, jobs, memory, projects, capabilities. Call at session start or before major decisions.',
    inputSchema: z.object({ sessionId: z.string().optional() }),
    execute: async ({ sessionId }) => {
      emitProgress({ type: 'fetch:start', label: 'Building situation brief' });
      const brief = await buildSituationBrief(sessionId);
      emitProgress({ type: 'fetch:end', label: 'Situation brief ready' });
      return brief;
    },
  }),

  recallRelevantMemories: tool({
    description: 'Recall long-term memories relevant to the current task or topic.',
    inputSchema: z.object({ query: z.string().min(2), limit: z.number().int().min(1).max(12).optional() }),
    execute: async ({ query, limit }) => recall(query, limit ?? 6),
  }),
};
