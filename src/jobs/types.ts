import type { ProgressEvent } from '../runtime/progress.js';

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'waiting';

export type JobPriority = 'critical' | 'high' | 'normal' | 'low';

export type JobSource = {
  type: 'manual' | 'schedule' | 'composio-trigger' | 'api' | 'chain';
  id?: string | undefined;
  toolkitSlug?: string | undefined;
  triggerSlug?: string | undefined;
};

export type JobMetadata = Record<string, unknown>;

export type JobStep = {
  name: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed';
  result?: string | undefined;
  error?: string | undefined;
  startedAt?: string | undefined;
  completedAt?: string | undefined;
};

export type JobNotification = {
  on: ('success' | 'failure' | 'start')[];
  slack?: string | undefined;
  email?: string | undefined;
  desktop?: boolean | undefined;
  webhook?: string | undefined;
};

export type ZilMateJob = {
  id: string;
  task: string;
  status: JobStatus;
  priority: JobPriority;
  schedule?: string | undefined;
  source: JobSource;
  metadata: JobMetadata;
  createdAt: string;
  updatedAt: string;
  runAt?: string | undefined;
  nextRunAt?: string | undefined;
  lastRunAt?: string | undefined;
  completedAt?: string | undefined;
  attempts: number;
  maxAttempts: number;
  timeoutMs?: number | undefined;
  qstashScheduleId?: string | undefined;
  result?: string | undefined;
  error?: string | undefined;
  dependsOn?: string[] | undefined;
  dependencyStatus?: Record<string, JobStatus> | undefined;
  steps?: JobStep[] | undefined;
  progress?: number | undefined;
  notify?: JobNotification | undefined;
  tags?: string[] | undefined;
  requiresApproval?: boolean | undefined;
  approvedAt?: string | undefined;
  concurrencyGroup?: string | undefined;
};

export type JobLogLevel = 'info' | 'progress' | 'error' | 'result' | 'warning';

export type JobLog = {
  id: string;
  jobId: string;
  createdAt: string;
  level: JobLogLevel;
  message: string;
  event?: ProgressEvent | undefined;
  data?: unknown;
};

export type CreateJobInput = {
  task: string;
  schedule?: string | undefined;
  source?: JobSource | undefined;
  metadata?: JobMetadata | undefined;
  runAt?: string | Date | undefined;
  maxAttempts?: number | undefined;
  priority?: JobPriority | undefined;
  dependsOn?: string[] | undefined;
  notify?: JobNotification | undefined;
  tags?: string[] | undefined;
  timeoutMs?: number | undefined;
  requiresApproval?: boolean | undefined;
  concurrencyGroup?: string | undefined;
};

export type ListJobsOptions = {
  status?: JobStatus | undefined;
  limit?: number | undefined;
  tags?: string[] | undefined;
  priority?: JobPriority | undefined;
  concurrencyGroup?: string | undefined;
};

export type RunJobOptions = {
  rescheduleRecurring?: boolean | undefined;
};

export type JobStats = {
  total: number;
  byStatus: Record<JobStatus, number>;
  byPriority: Record<JobPriority, number>;
  byTag: Record<string, number>;
  successRate: number;
  avgDurationMs: number;
  failureRate: number;
};