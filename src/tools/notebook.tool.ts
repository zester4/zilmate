import { tool } from 'ai';
import { z } from 'zod';
import {
  addNotebookEntry,
  appendNotebookMarkdown,
  listNotebookEntries,
  readNotebookMarkdown,
  searchNotebook,
  getNotebookPaths,
} from '../memory/notebook.js';
import { emitProgress } from '../runtime/progress.js';

export const notebookTools = {
  readNotebook: tool({
    description: 'Read ZilMate private notebook.md: durable project/user working notes separate from short-lived scratchpad.',
    inputSchema: z.object({ limitChars: z.number().int().min(500).max(50_000).optional() }),
    execute: async ({ limitChars }) => {
      const text = await readNotebookMarkdown();
      return {
        paths: await getNotebookPaths(),
        content: limitChars ? text.slice(-limitChars) : text,
      };
    },
  }),

  appendNotebook: tool({
    description: 'Save durable project memory to notebook.md and notes.json: architecture decisions, setup steps, recurring errors, commands, ports, preferences, and handoff notes.',
    inputSchema: z.object({
      title: z.string().min(1),
      body: z.string().min(1),
      tags: z.array(z.string()).optional(),
    }),
    execute: async ({ title, body, tags }) => {
      emitProgress({ type: 'step', label: 'Updating notebook', detail: title });
      const entry = await addNotebookEntry({
        title,
        body,
        ...(tags ? { tags } : {}),
      });
      return entry;
    },
  }),

  searchNotebook: tool({
    description: 'Search durable structured notebook entries by keyword before asking the user to repeat prior project context.',
    inputSchema: z.object({ query: z.string().min(2), limit: z.number().int().min(1).max(20).optional() }),
    execute: async ({ query, limit }) => searchNotebook(query, limit ?? 10),
  }),

  listNotebookEntries: tool({
    description: 'List recent durable notebook entries from notes.json for project/session recall.',
    inputSchema: z.object({ limit: z.number().int().min(1).max(50).optional() }),
    execute: async ({ limit }) => listNotebookEntries(limit ?? 15),
  }),

  quickNotebookNote: tool({
    description: 'Quick append to notebook.md for lightweight durable notes when structured metadata is unnecessary.',
    inputSchema: z.object({ section: z.string().min(1), content: z.string().min(1) }),
    execute: async ({ section, content }) => appendNotebookMarkdown(section, content),
  }),
};
