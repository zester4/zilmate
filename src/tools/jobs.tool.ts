import { tool } from 'ai';
import { z } from 'zod';
import { requestConfirmation } from '../runtime/confirm.js';
import { emitProgress } from '../runtime/progress.js';
import { registerQStashSchedule } from '../jobs/qstash.js';
import { appendJobLog, createJob, getJob, getJobLogs, getJobStats, listJobs, updateJobStatus } from '../jobs/store.js';
import { resolveDependencies } from '../jobs/store.js';
import type { JobPriority } from '../jobs/types.js';

const jobStatusSchema = z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled', 'waiting']);
const jobPrioritySchema = z.enum(['critical', 'high', 'normal', 'low']).default('normal');
const metadataSchema = z.record(z.string(), z.unknown());

const notificationSchema = z.object({
  on: z.array(z.enum(['success', 'failure', 'start'])).min(1),
  slack: z.string().optional(),
  email: z.string().optional(),
  desktop: z.boolean().optional(),
  webhook: z.string().optional(),
});

async function confirmJobAction(action: string, details: string[]) {
  return requestConfirmation({
    toolkitSlug: 'ZILMATE',
    toolSlug: 'JOBS',
    action,
    access: 'Write',
    targetTools: ['ZILMATE_JOBS'],
    details,
    summary: details.join('; '),
  });
}

export const jobTools = {
  createJob: tool({
    description: 'Queue a ZilMate background job. Supports priority levels (critical/high/normal/low), job dependencies (waits for parent jobs to succeed), tags for filtering, notifications on completion, timeouts, approval requirements, and concurrency groups. Use when the user asks ZilMate to keep working after chat, schedule a task, prepare a report later, monitor something, or follow up. Requires confirmation.',
    inputSchema: z.object({
      task: z.string().min(3),
      schedule: z.string().min(1).optional().describe('Optional schedule such as daily, hourly, every 15 minutes, or cron:0 9 * * *.'),
      runAt: z.string().min(1).optional().describe('Optional ISO date/time or parseable date for the first run.'),
      priority: jobPrioritySchema.optional().describe('Priority level: critical, high, normal, low. Higher priority jobs run first.'),
      dependsOn: z.array(z.string()).optional().describe('Job IDs that must succeed before this job runs.'),
      tags: z.array(z.string()).optional().describe('Tags for filtering and grouping jobs.'),
      notify: notificationSchema.optional().describe('Notification config for success/failure/start events.'),
      timeoutMs: z.number().int().positive().optional().describe('Max execution time in milliseconds before the job is killed.'),
      requiresApproval: z.boolean().optional().describe('If true, job waits for user approval before executing.'),
      concurrencyGroup: z.string().optional().describe('Only one job per concurrency group runs at a time.'),
      metadata: metadataSchema.optional(),
    }),
    execute: async ({ task, schedule, runAt, priority, dependsOn, tags, notify, timeoutMs, requiresApproval, concurrencyGroup, metadata }) => {
      const details = [
        `Task: ${task}`,
        ...(schedule ? [`Schedule: ${schedule}`] : []),
        ...(runAt ? [`Run at: ${runAt}`] : []),
        ...(priority ? [`Priority: ${priority}`] : []),
        ...(dependsOn ? [`Depends on: ${dependsOn.join(', ')}`] : []),
        ...(tags ? [`Tags: ${tags.join(', ')}`] : []),
        ...(notify ? [`Notify on: ${notify.on.join(', ')}`] : []),
        ...(timeoutMs ? [`Timeout: ${timeoutMs}ms`] : []),
        ...(requiresApproval ? ['Requires approval'] : []),
        ...(concurrencyGroup ? [`Concurrency group: ${concurrencyGroup}`] : []),
      ];
      const approved = await confirmJobAction('Create background job', details);
      if (!approved) throw new Error('Blocked job creation. Ask the user to approve creating the background job.');

      emitProgress({ type: 'tool:start', label: 'Creating job', detail: task });
      const job = await createJob({
        task,
        ...(schedule ? { schedule } : {}),
        ...(runAt ? { runAt } : {}),
        priority,
        dependsOn,
        tags,
        notify,
        timeoutMs,
        requiresApproval,
        concurrencyGroup,
        source: schedule ? { type: 'schedule' } : { type: 'manual' },
        metadata: metadata ?? {},
      });
      const registered = await registerQStashSchedule(job);
      emitProgress({ type: 'tool:end', label: 'Job queued', detail: registered.id });
      return registered;
    },
  }),

  listJobs: tool({
    description: 'List ZilMate background jobs by status, priority, tags, or concurrency group. Use this to help the user see queued, running, completed, failed, or cancelled work.',
    inputSchema: z.object({
      status: jobStatusSchema.optional(),
      priority: jobPrioritySchema.optional(),
      tags: z.array(z.string()).optional(),
      concurrencyGroup: z.string().optional(),
      limit: z.number().int().min(1).max(100).optional(),
    }),
    execute: async ({ status, priority, tags, concurrencyGroup, limit }) => {
      emitProgress({ type: 'fetch:start', label: 'Listing jobs', detail: status ?? 'all' });
      const jobs = await listJobs({
        ...(status ? { status } : {}),
        ...(priority ? { priority } : {}),
        ...(tags ? { tags } : {}),
        ...(concurrencyGroup ? { concurrencyGroup } : {}),
        limit: limit ?? 25,
      });
      emitProgress({ type: 'fetch:end', label: 'Jobs listed', detail: `${jobs.length} job${jobs.length === 1 ? '' : 's'}` });
      return jobs;
    },
  }),

  showJob: tool({
    description: 'Show one ZilMate background job by id.',
    inputSchema: z.object({
      id: z.string().min(3),
    }),
    execute: async ({ id }) => {
      emitProgress({ type: 'fetch:start', label: 'Loading job', detail: id });
      const job = await getJob(id);
      emitProgress({ type: 'fetch:end', label: job ? 'Job loaded' : 'Job not found', detail: id });
      return job;
    },
  }),

  listJobLogs: tool({
    description: 'Show logs, progress events, results, and errors for one ZilMate background job.',
    inputSchema: z.object({
      id: z.string().min(3),
    }),
    execute: async ({ id }) => {
      emitProgress({ type: 'fetch:start', label: 'Loading job logs', detail: id });
      const logs = await getJobLogs(id);
      emitProgress({ type: 'fetch:end', label: 'Job logs loaded', detail: `${logs.length} log${logs.length === 1 ? '' : 's'}` });
      return logs;
    },
  }),

  cancelJob: tool({
    description: 'Cancel one ZilMate background job by id. Also cancels any dependent jobs waiting on it. Requires confirmation.',
    inputSchema: z.object({
      id: z.string().min(3),
    }),
    execute: async ({ id }) => {
      const approved = await confirmJobAction('Cancel job', [`Job: ${id}`]);
      if (!approved) throw new Error('Blocked cancelling job. Ask the user to approve cancelling it.');

      emitProgress({ type: 'tool:start', label: 'Cancelling job', detail: id });
      const job = await updateJobStatus(id, 'cancelled', { completedAt: new Date().toISOString() });
      if (job) await appendJobLog(id, 'info', 'Job cancelled by agent.');
      emitProgress({ type: 'tool:end', label: job ? 'Job cancelled' : 'Job not found', detail: id });
      return job;
    },
  }),

  approveJob: tool({
    description: 'Approve a job that requires approval before it can run. Use this when the user confirms they want a pending job to execute.',
    inputSchema: z.object({
      id: z.string().min(3),
    }),
    execute: async ({ id }) => {
      emitProgress({ type: 'tool:start', label: 'Approving job', detail: id });
      const job = await getJob(id);
      if (!job) throw new Error(`Job not found: ${id}`);
      if (!job.requiresApproval) throw new Error(`Job ${id} does not require approval.`);
      const approved = await updateJobStatus(id, 'queued', { approvedAt: new Date().toISOString(), requiresApproval: false });
      if (approved) await appendJobLog(id, 'info', 'Job approved by user.');
      emitProgress({ type: 'tool:end', label: 'Job approved', detail: id });
      return approved;
    },
  }),

  getJobStats: tool({
    description: 'Get aggregate statistics about all ZilMate background jobs: counts by status, priority, tags, success/failure rates, and average duration.',
    inputSchema: z.object({}),
    execute: async () => {
      emitProgress({ type: 'fetch:start', label: 'Computing job statistics' });
      const stats = await getJobStats();
      emitProgress({ type: 'fetch:end', label: 'Job statistics ready' });
      return stats;
    },
  }),

  resolveJobDependencies: tool({
    description: 'Manually trigger dependency resolution for waiting jobs. Checks if all parent jobs have completed and moves waiting jobs to queued if dependencies are met.',
    inputSchema: z.object({}),
    execute: async () => {
      emitProgress({ type: 'tool:start', label: 'Resolving job dependencies' });
      const resolved = await resolveDependencies();
      emitProgress({ type: 'tool:end', label: 'Dependencies resolved', detail: `${resolved.length} job${resolved.length === 1 ? '' : 's'} moved` });
      return { resolved: resolved.length, jobs: resolved };
    },
  }),
};