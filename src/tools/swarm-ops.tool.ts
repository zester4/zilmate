import { tool } from 'ai';
import { z } from 'zod';
import { readJson, writeJson } from '../memory/local-store.js';

export async function getControlState(deptRunId: string): Promise<'RUNNING' | 'PAUSED'> {
  const states = await readJson<Record<string, 'RUNNING' | 'PAUSED'>>('swarm-control-states.json', {});
  return states[deptRunId] || 'RUNNING';
}

export const swarmOpsTools = {
  pauseDepartment: tool({
    description: 'Pause a department session to halt activity.',
    inputSchema: z.object({
      deptRunId: z.string().describe('The departmental session ID to pause.'),
    }),
    execute: async ({ deptRunId }) => {
      const states = await readJson<Record<string, 'RUNNING' | 'PAUSED'>>('swarm-control-states.json', {});
      states[deptRunId] = 'PAUSED';
      await writeJson('swarm-control-states.json', states);
      return { status: 'PAUSED', deptRunId };
    },
  }),

  resumeDepartment: tool({
    description: 'Resume a paused department session.',
    inputSchema: z.object({
      deptRunId: z.string().describe('The departmental session ID to resume.'),
    }),
    execute: async ({ deptRunId }) => {
      const states = await readJson<Record<string, 'RUNNING' | 'PAUSED'>>('swarm-control-states.json', {});
      states[deptRunId] = 'RUNNING';
      await writeJson('swarm-control-states.json', states);
      return { status: 'RUNNING', deptRunId };
    },
  }),
};
