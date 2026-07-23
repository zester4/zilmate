import { randomUUID } from 'node:crypto';
import { readJson, writeJson } from '../memory/local-store.js';
import { getRedis } from '../memory/redis.js';
import { nextRunFromSchedule } from './schedule.js';
import type { CreateJobInput, JobLog, JobLogLevel, JobPriority, JobStatus, ListJobsOptions, ZilMateJob, JobStats } from './types.js';

const jobsFile = 'jobs.json';
const logsFile = 'job-logs.json';
const jobsIndexKey = 'zilo-manager:jobs:v1';
const jobKey = (id: string) => `zilo-manager:job:${id}`;
const jobLogsKey = (id: string) => `zilo-manager:job-logs:${id}`;

function now() {
  return new Date().toISOString();
}

function normalizeLimit(limit: number | undefined) {
  return Number.isFinite(limit) && limit && limit > 0 ? Math.min(Math.floor(limit), 200) : 25;
}

async function readLocalJobs() {
  return readJson<ZilMateJob[]>(jobsFile, []);
}

async function writeLocalJobs(jobs: ZilMateJob[]) {
  await writeJson(jobsFile, jobs);
}

async function readLocalLogs() {
  return readJson<Record<string, JobLog[]>>(logsFile, {});
}

async function writeLocalLogs(logs: Record<string, JobLog[]>) {
  await writeJson(logsFile, logs);
}

const priorityOrder: Record<JobPriority, number> = { critical: 0, high: 1, normal: 2, low: 3 };

function sortByPriority(a: ZilMateJob, b: ZilMateJob): number {
  const pa = priorityOrder[a.priority] ?? 2;
  const pb = priorityOrder[b.priority] ?? 2;
  if (pa !== pb) return pa - pb;
  return b.updatedAt.localeCompare(a.updatedAt);
}

export async function createJob(input: CreateJobInput) {
  const createdAt = now();
  const runAt = input.runAt instanceof Date
    ? input.runAt.toISOString()
    : input.runAt || nextRunFromSchedule(input.schedule) || createdAt;

  // If job has dependencies, start in 'waiting' status
  const status: JobStatus = input.dependsOn && input.dependsOn.length > 0 ? 'waiting' : 'queued';

  const job: ZilMateJob = {
    id: `job_${randomUUID()}`,
    task: input.task,
    status,
    priority: input.priority ?? 'normal',
    ...(input.schedule ? { schedule: input.schedule } : {}),
    source: input.source ?? { type: input.schedule ? 'schedule' : 'manual' },
    metadata: input.metadata ?? {},
    createdAt,
    updatedAt: createdAt,
    runAt,
    nextRunAt: runAt,
    attempts: 0,
    maxAttempts: input.maxAttempts ?? 3,
    ...(input.dependsOn ? { dependsOn: input.dependsOn } : {}),
    ...(input.notify ? { notify: input.notify } : {}),
    ...(input.tags ? { tags: input.tags } : {}),
    ...(input.timeoutMs ? { timeoutMs: input.timeoutMs } : {}),
    ...(input.requiresApproval ? { requiresApproval: true } : {}),
    ...(input.concurrencyGroup ? { concurrencyGroup: input.concurrencyGroup } : {}),
  };

  const redis = getRedis();
  if (redis) {
    const ids = (await redis.get<string[]>(jobsIndexKey)) ?? [];
    await redis.set(jobKey(job.id), job);
    await redis.set(jobsIndexKey, [job.id, ...ids.filter((id) => id !== job.id)].slice(0, 500));
  } else {
    const jobs = await readLocalJobs();
    await writeLocalJobs([job, ...jobs.filter((item) => item.id !== job.id)].slice(0, 500));
  }

  await appendJobLog(job.id, 'info', `Queued job: ${job.task}`, { source: job.source, metadata: job.metadata, priority: job.priority });
  return job;
}

export async function listJobs(options: ListJobsOptions = {}) {
  const limit = normalizeLimit(options.limit);
  const redis = getRedis();
  let jobs: ZilMateJob[];

  if (redis) {
    const ids = (await redis.get<string[]>(jobsIndexKey)) ?? [];
    const values = await Promise.all(ids.map((id) => redis.get<ZilMateJob>(jobKey(id))));
    jobs = values.filter((job): job is ZilMateJob => Boolean(job));
  } else {
    jobs = await readLocalJobs();
  }

  return jobs
    .filter((job) => {
      if (options.status && job.status !== options.status) return false;
      if (options.tags && options.tags.length > 0) {
        const jobTags = job.tags ?? [];
        if (!options.tags.some((t) => jobTags.includes(t))) return false;
      }
      if (options.priority && job.priority !== options.priority) return false;
      if (options.concurrencyGroup && job.concurrencyGroup !== options.concurrencyGroup) return false;
      return true;
    })
    .sort(sortByPriority)
    .slice(0, limit);
}

export async function getJob(id: string) {
  const redis = getRedis();
  if (redis) return redis.get<ZilMateJob>(jobKey(id));
  const jobs = await readLocalJobs();
  return jobs.find((job) => job.id === id) ?? null;
}

export async function saveJob(job: ZilMateJob) {
  const updated: ZilMateJob = { ...job, updatedAt: now() };
  const redis = getRedis();
  if (redis) {
    await redis.set(jobKey(updated.id), updated);
    const ids = (await redis.get<string[]>(jobsIndexKey)) ?? [];
    await redis.set(jobsIndexKey, [updated.id, ...ids.filter((id) => id !== updated.id)].slice(0, 500));
    return updated;
  }

  const jobs = await readLocalJobs();
  await writeLocalJobs([updated, ...jobs.filter((item) => item.id !== updated.id)].slice(0, 500));
  return updated;
}

export async function updateJobStatus(id: string, status: JobStatus, patch: Partial<ZilMateJob> = {}) {
  const job = await getJob(id);
  if (!job) return null;
  return saveJob({ ...job, ...patch, status });
}

export async function appendJobLog(jobId: string, level: JobLogLevel, message: string, data?: unknown) {
  const event = data && typeof data === 'object' && 'type' in data && 'label' in data ? data as JobLog['event'] : undefined;
  const log: JobLog = {
    id: `log_${randomUUID()}`,
    jobId,
    createdAt: now(),
    level,
    message,
    ...(event ? { event } : {}),
    ...(data !== undefined ? { data } : {}),
  };

  const redis = getRedis();
  if (redis) {
    const current = (await redis.get<JobLog[]>(jobLogsKey(jobId))) ?? [];
    await redis.set(jobLogsKey(jobId), [...current, log].slice(-500));
  } else {
    const logs = await readLocalLogs();
    logs[jobId] = [...(logs[jobId] ?? []), log].slice(-500);
    await writeLocalLogs(logs);
  }

  return log;
}

export async function getJobLogs(jobId: string) {
  const redis = getRedis();
  if (redis) return (await redis.get<JobLog[]>(jobLogsKey(jobId))) ?? [];
  const logs = await readLocalLogs();
  return logs[jobId] ?? [];
}

/**
 * Check and resolve job dependencies. If all dependencies of a waiting job
 * have succeeded, move it to 'queued'. If any dependency failed, mark as 'failed'.
 */
export async function resolveDependencies() {
  const redis = getRedis();
  let jobs: ZilMateJob[];

  if (redis) {
    const ids = (await redis.get<string[]>(jobsIndexKey)) ?? [];
    const values = await Promise.all(ids.map((id) => redis.get<ZilMateJob>(jobKey(id))));
    jobs = values.filter((job): job is ZilMateJob => Boolean(job));
  } else {
    jobs = await readLocalJobs();
  }

  const waiting = jobs.filter((j) => j.status === 'waiting' && j.dependsOn && j.dependsOn.length > 0);
  const resolved: ZilMateJob[] = [];

  for (const job of waiting) {
    const deps = job.dependsOn!;
    const depStatuses: Record<string, JobStatus> = {};

    for (const depId of deps) {
      const dep = jobs.find((j) => j.id === depId);
      depStatuses[depId] = dep?.status ?? 'failed';
    }

    const allSucceeded = Object.values(depStatuses).every((s) => s === 'succeeded');
    const anyFailed = Object.values(depStatuses).some((s) => s === 'failed' || s === 'cancelled');

    if (allSucceeded) {
      const updated = await updateJobStatus(job.id, 'queued', { dependencyStatus: depStatuses });
      if (updated) {
        resolved.push(updated);
        await appendJobLog(job.id, 'info', 'Dependencies resolved, job queued.', { depStatuses });
      }
    } else if (anyFailed) {
      const updated = await updateJobStatus(job.id, 'failed', {
        error: `Dependency failed: ${Object.entries(depStatuses).filter(([, s]) => s === 'failed' || s === 'cancelled').map(([id]) => id).join(', ')}`,
        dependencyStatus: depStatuses,
      });
      if (updated) {
        resolved.push(updated);
        await appendJobLog(job.id, 'error', 'Dependency failed, job cancelled.', { depStatuses });
      }
    } else {
      // Still waiting
      await saveJob({ ...job, dependencyStatus: depStatuses });
    }
  }

  return resolved;
}

/**
 * Compute aggregate job statistics.
 */
export async function getJobStats(): Promise<JobStats> {
  const redis = getRedis();
  let jobs: ZilMateJob[];

  if (redis) {
    const ids = (await redis.get<string[]>(jobsIndexKey)) ?? [];
    const values = await Promise.all(ids.map((id) => redis.get<ZilMateJob>(jobKey(id))));
    jobs = values.filter((job): job is ZilMateJob => Boolean(job));
  } else {
    jobs = await readLocalJobs();
  }

  const byStatus: Record<JobStatus, number> = { queued: 0, running: 0, succeeded: 0, failed: 0, cancelled: 0, waiting: 0 };
  const byPriority: Record<JobPriority, number> = { critical: 0, high: 0, normal: 0, low: 0 };
  const byTag: Record<string, number> = {};

  for (const job of jobs) {
    byStatus[job.status] = (byStatus[job.status] ?? 0) + 1;
    byPriority[job.priority] = (byPriority[job.priority] ?? 0) + 1;
    for (const tag of job.tags ?? []) {
      byTag[tag] = (byTag[tag] ?? 0) + 1;
    }
  }

  const completed = (byStatus.succeeded ?? 0) + (byStatus.failed ?? 0);
  const successRate = completed > 0 ? (byStatus.succeeded ?? 0) / completed : 0;
  const failureRate = completed > 0 ? (byStatus.failed ?? 0) / completed : 0;

  // Calculate average duration for completed jobs
  let totalDurationMs = 0;
  let durationCount = 0;
  for (const job of jobs) {
    if (job.lastRunAt && job.completedAt) {
      const duration = new Date(job.completedAt).getTime() - new Date(job.lastRunAt).getTime();
      if (duration > 0) {
        totalDurationMs += duration;
        durationCount++;
      }
    }
  }

  return {
    total: jobs.length,
    byStatus,
    byPriority,
    byTag,
    successRate,
    avgDurationMs: durationCount > 0 ? totalDurationMs / durationCount : 0,
    failureRate,
  };
}