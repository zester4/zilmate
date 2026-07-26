import { tool } from 'ai';
import { z } from 'zod';
import { chromium } from 'playwright';
import { emitProgress } from '../runtime/progress.js';

const workflowStore = new Map<string, { id: string; createdAt: string; steps: Array<{ action: string; target?: string | undefined; selector?: string | undefined; value?: string | undefined }>; results: Array<{ action: string; ok: boolean; detail?: string | undefined }> }>();

function createWorkflowId() {
  return `wf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export const browserWorkflowTools = {
  runBrowserWorkflow: tool({
    description: 'Run a multi-step browser workflow with navigation, interaction, and extraction steps.',
    inputSchema: z.object({
      steps: z.array(z.object({
        action: z.enum(['navigate', 'click', 'type', 'wait', 'extract']),
        target: z.string().optional(),
        value: z.string().optional(),
        selector: z.string().optional(),
      })).min(1),
      timeoutMs: z.number().int().min(1000).max(60000).optional(),
    }),
    execute: async ({ steps, timeoutMs }) => {
      emitProgress({ type: 'tool:start', label: 'Running browser workflow', detail: `${steps.length} step(s)` });
      const workflowId = createWorkflowId();
      const browser = await chromium.launch({ headless: true });
      const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
      const page = await context.newPage();

      const results: Array<{ action: string; ok: boolean; detail?: string }> = [];
      const workflowRecord = {
        id: workflowId,
        createdAt: new Date().toISOString(),
        steps: steps.map((step) => ({ action: step.action, target: step.target, selector: step.selector, value: step.value })),
        results,
      };
      workflowStore.set(workflowId, workflowRecord);

      try {
        for (const step of steps) {
          if (step.action === 'navigate' && step.target) {
            await page.goto(step.target, { waitUntil: 'load', timeout: timeoutMs ?? 15000 });
            results.push({ action: 'navigate', ok: true, detail: step.target });
          } else if (step.action === 'click' && step.selector) {
            await page.click(step.selector, { timeout: timeoutMs ?? 15000 });
            results.push({ action: 'click', ok: true, detail: step.selector });
          } else if (step.action === 'type' && step.selector && step.value) {
            await page.fill(step.selector, '');
            await page.type(step.selector, step.value, { delay: 25 });
            results.push({ action: 'type', ok: true, detail: step.selector });
          } else if (step.action === 'wait') {
            await page.waitForTimeout(timeoutMs ?? 1000);
            results.push({ action: 'wait', ok: true, detail: 'waited' });
          } else if (step.action === 'extract' && step.selector) {
            const text = await page.locator(step.selector).innerText();
            results.push({ action: 'extract', ok: true, detail: text });
          } else {
            results.push({ action: step.action, ok: false, detail: 'invalid step schema' });
          }
        }

        workflowRecord.results.push(...results);
        return { workflowId, success: results.every((entry) => entry.ok), results };
      } catch (error) {
        workflowRecord.results.push({ action: 'error', ok: false, detail: error instanceof Error ? error.message : String(error) });
        return { workflowId, success: false, results: workflowRecord.results };
      } finally {
        await browser.close();
        emitProgress({ type: 'tool:end', label: 'Browser workflow completed' });
      }
    },
  }),

  inspectBrowserWorkflow: tool({
    description: 'Inspect a recorded browser workflow trace and its execution results.',
    inputSchema: z.object({ workflowId: z.string() }),
    execute: async ({ workflowId }) => {
      const record = workflowStore.get(workflowId);
      if (!record) {
        throw new Error(`Workflow ${workflowId} not found.`);
      }
      emitProgress({ type: 'tool:end', label: 'Inspecting browser workflow', detail: workflowId });
      return record;
    },
  }),
};
