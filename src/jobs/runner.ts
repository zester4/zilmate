import { runManager } from '../agents/manager.js';
import { printProgress } from '../cli/format.js';
import type { ProgressEvent } from '../runtime/progress.js';
import { isRecurringSchedule, nextRunFromSchedule } from './schedule.js';
import { appendJobLog, getJob, listJobs, resolveDependencies, saveJob, updateJobStatus } from './store.js';
import type { RunJobOptions, ZilMateJob } from './types.js';
import { assessJobAnomaly, recordJobFingerprint } from './anomaly.js';

function now() {
  return new Date().toISOString();
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function withoutTransientFields(job: ZilMateJob): ZilMateJob {
  const { error: _error, completedAt: _completedAt, runAt: _runAt, nextRunAt: _nextRunAt, ...rest } = job;
  return rest as ZilMateJob;
}

export async function cancelJob(id: string) {
  // Also cancel any dependent jobs
  const allJobs = await listJobs({});
  const dependents = allJobs.filter((j) => j.dependsOn?.includes(id) && j.status === 'waiting');
  for (const dep of dependents) {
    await updateJobStatus(dep.id, 'cancelled', { error: `Parent job ${id} was cancelled.`, completedAt: now() });
    await appendJobLog(dep.id, 'info', `Cancelled due to parent job ${id} being cancelled.`);
  }

  const job = await updateJobStatus(id, 'cancelled', { completedAt: now() });
  if (job) await appendJobLog(id, 'info', 'Job cancelled.');
  return job;
}

export async function runJob(id: string, options: RunJobOptions = {}) {
  const job = await getJob(id);
  if (!job) throw new Error(`Job not found: ${id}`);
  if (job.status === 'cancelled') return job;

  // Check for approval requirement
  if (job.requiresApproval && !job.approvedAt) {
    await appendJobLog(job.id, 'warning', 'Job requires approval before running.');
    return job;
  }

  const startedAt = now();
  const timeoutMs = job.timeoutMs;
  let timeoutHandle: NodeJS.Timeout | undefined;

  const running = await saveJob({
    ...withoutTransientFields(job),
    status: 'running' as const,
    attempts: job.attempts + 1,
    lastRunAt: startedAt,
    progress: 0,
  } as ZilMateJob);
  await appendJobLog(job.id, 'info', `Running job attempt ${running.attempts}.`);

  // Set up timeout
    if (timeoutMs && timeoutMs > 0) {
      timeoutHandle = setTimeout(async () => {
        await appendJobLog(job.id, 'error', `Job timed out after ${timeoutMs}ms.`);
        await saveJob({
          ...withoutTransientFields(running),
          status: 'failed' as const,
          error: `Timed out after ${timeoutMs}ms`,
          completedAt: now(),
        } as ZilMateJob);
      }, timeoutMs);
    }

  recordJobFingerprint(job);
  const anomaly = await assessJobAnomaly(job);
  if (!anomaly.normal) {
    await appendJobLog(job.id, 'info', `Anomaly assessment: ${anomaly.reason}`, anomaly);
  }

  try {
    const text = await runManager(job.task, {
      sessionId: `job-${job.id}`,
      progress: async (event: ProgressEvent) => {
        await appendJobLog(job.id, 'progress', event.label, event);
      },
    });

    if (timeoutHandle) clearTimeout(timeoutHandle);

    await appendJobLog(job.id, 'result', 'Job completed.', { text });

    // Mark job as succeeded
    let finalJob: ZilMateJob;
    if (options.rescheduleRecurring && isRecurringSchedule(job.schedule)) {
      const nextRunAt = nextRunFromSchedule(job.schedule);
      finalJob = await saveJob({
        ...withoutTransientFields(running),
        status: 'queued' as const,
        result: text,
        ...(nextRunAt ? { runAt: nextRunAt, nextRunAt } : {}),
        completedAt: now(),
        progress: 100,
      } as ZilMateJob);
    } else {
      finalJob = await saveJob({
        ...running,
        status: 'succeeded' as const,
        result: text,
        completedAt: now(),
        progress: 100,
      } as ZilMateJob);
    }

    // Resolve dependencies for waiting jobs
    await resolveDependencies();

    return finalJob;
  } catch (error) {
    if (timeoutHandle) clearTimeout(timeoutHandle);

    const message = errorMessage(error);
    await appendJobLog(job.id, 'error', message);
    const shouldRetry = running.attempts < running.maxAttempts;

    // Exponential backoff with jitter
    const baseDelay = Math.min(running.attempts, 10) * 60 * 1000;
    const jitter = Math.random() * 30 * 1000;
    const retryAt = shouldRetry ? new Date(Date.now() + baseDelay + jitter).toISOString() : undefined;

    const newStatus = shouldRetry ? 'queued' : 'failed';
    const failed = await saveJob({
      ...withoutTransientFields(running),
      status: newStatus as 'queued' | 'failed',
      error: message,
      ...(retryAt ? { runAt: retryAt, nextRunAt: retryAt } : {}),
      ...(shouldRetry ? {} : { completedAt: now() }),
      progress: shouldRetry ? undefined : 0,
    } as ZilMateJob);

    return failed;
  }
}

export async function runDueJobs() {
  // First, resolve any pending dependencies
  await resolveDependencies();

  const queued = await listJobs({ status: 'queued', limit: 100 });
  const due = queued.filter((job) => !job.runAt || new Date(job.runAt).getTime() <= Date.now());

  // Sort by priority within due jobs
  const priorityOrder = { critical: 0, high: 1, normal: 2, low: 3 };
  due.sort((a, b) => (priorityOrder[a.priority] ?? 2) - (priorityOrder[b.priority] ?? 2));

  // Track concurrency groups
  const concurrencyRunning = new Set<string>();

  for (const job of due) {
    // Check concurrency limits
    if (job.concurrencyGroup) {
      if (concurrencyRunning.has(job.concurrencyGroup)) {
        continue; // Skip: another job in this group is running
      }
      concurrencyRunning.add(job.concurrencyGroup);
    }

    await runJob(job.id, { rescheduleRecurring: true });

    if (job.concurrencyGroup) {
      concurrencyRunning.delete(job.concurrencyGroup);
    }
  }

  return due.length;
}

export async function handleJobWebhook(input: { jobId: string; secret?: string }, expectedSecret?: string) {
  if (expectedSecret && input.secret !== expectedSecret) {
    throw new Error('Invalid ZilMate job webhook secret.');
  }
  return runJob(input.jobId, { rescheduleRecurring: true });
}

export async function startJobWorker(options: { intervalSeconds?: number; once?: boolean; quiet?: boolean } = {}) {
  const intervalMs = Math.max(1, options.intervalSeconds ?? 10) * 1000;
  if (!options.quiet) printProgress({ type: 'tool:start', label: 'ZilMate job worker started', detail: `${intervalMs / 1000}s interval` });

  do {
    const count = await runDueJobs();
    if (!options.quiet && count > 0) printProgress({ type: 'step', label: 'Processed queued jobs', detail: String(count) });
    if (options.once) break;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  } while (true);
}