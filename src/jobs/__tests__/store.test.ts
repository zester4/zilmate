// src/jobs/__tests__/store.test.ts
// Unit tests for the jobs store (createJob, listJobs, getJob, saveJob, resolveDependencies, getJobStats)
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let tempDir: string;
const originalCwd = process.cwd();

describe('Jobs Store', () => {
  before(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'zilmate-jobs-test-'));
    process.chdir(tempDir);
  });

  after(async () => {
    process.chdir(originalCwd);
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should create a job with default values', async () => {
    const { createJob, getJob } = await import('../store.js');
    const job = await createJob({ task: 'Test task' });
    
    assert.ok(job.id.startsWith('job_'));
    assert.equal(job.task, 'Test task');
    assert.equal(job.status, 'queued');
    assert.equal(job.priority, 'normal');
    assert.equal(job.attempts, 0);
    assert.equal(job.maxAttempts, 3);
    assert.equal(job.source.type, 'manual');
    assert.ok(job.createdAt);
    assert.ok(job.updatedAt);

    const fetched = await getJob(job.id);
    assert.ok(fetched);
    assert.equal(fetched!.id, job.id);
  });

  it('should create a job with priority', async () => {
    const { createJob } = await import('../store.js');
    const job = await createJob({ task: 'Critical task', priority: 'critical' });
    assert.equal(job.priority, 'critical');
  });

  it('should create a job with dependencies (waiting status)', async () => {
    const { createJob } = await import('../store.js');
    const parent = await createJob({ task: 'Parent task' });
    const child = await createJob({ task: 'Child task', dependsOn: [parent.id] });
    
    assert.equal(child.status, 'waiting');
    assert.deepEqual(child.dependsOn, [parent.id]);
  });

  it('should create a job with tags', async () => {
    const { createJob } = await import('../store.js');
    const job = await createJob({ task: 'Tagged task', tags: ['test', 'goal-manager'] });
    assert.deepEqual(job.tags, ['test', 'goal-manager']);
  });

  it('should create a job with notification config', async () => {
    const { createJob } = await import('../store.js');
    const job = await createJob({
      task: 'Notify task',
      notify: { on: ['success', 'failure'], desktop: true },
    });
    assert.ok(job.notify);
    assert.deepEqual(job.notify!.on, ['success', 'failure']);
    assert.equal(job.notify!.desktop, true);
  });

  it('should list jobs sorted by priority then date', async () => {
    const { createJob, listJobs } = await import('../store.js');
    const low = await createJob({ task: 'Low priority', priority: 'low' });
    const high = await createJob({ task: 'High priority', priority: 'high' });
    const critical = await createJob({ task: 'Critical priority', priority: 'critical' });

    // Use a high limit to ensure all jobs are returned
    const jobs = await listJobs({ limit: 200 });
    // Filter to just our 3 test jobs to avoid interference from other tests
    const testIds = new Set([low.id, high.id, critical.id]);
    const filtered = jobs.filter((j) => testIds.has(j.id));
    
    // Critical (priority 0) should come before high (priority 1) and low (priority 3)
    assert.equal(filtered.length, 3, 'All 3 test jobs should be in the list');
    assert.equal(filtered[0]!.id, critical.id, 'Critical should be first');
    assert.equal(filtered[1]!.id, high.id, 'High should be second');
    assert.equal(filtered[2]!.id, low.id, 'Low should be third');
  });

  it('should filter jobs by status', async () => {
    const { createJob, listJobs, updateJobStatus } = await import('../store.js');
    await createJob({ task: 'Queued task' });
    const running = await createJob({ task: 'Running task' });
    await updateJobStatus(running.id, 'running');

    const queuedJobs = await listJobs({ status: 'queued' });
    const runningJobs = await listJobs({ status: 'running' });

    assert.ok(queuedJobs.every((j) => j.status === 'queued'));
    assert.ok(runningJobs.every((j) => j.status === 'running'));
  });

  it('should filter jobs by tags', async () => {
    const { createJob, listJobs } = await import('../store.js');
    await createJob({ task: 'Task A', tags: ['alpha'] });
    await createJob({ task: 'Task B', tags: ['beta'] });

    const alphaJobs = await listJobs({ tags: ['alpha'] });
    assert.ok(alphaJobs.every((j) => j.tags?.includes('alpha')));
  });

  it('should update job status', async () => {
    const { createJob, updateJobStatus } = await import('../store.js');
    const job = await createJob({ task: 'Updatable task' });
    const updated = await updateJobStatus(job.id, 'running', { progress: 50 });
    assert.ok(updated);
    assert.equal(updated!.status, 'running');
    assert.equal(updated!.progress, 50);
  });

  it('should resolve dependencies when parent succeeds', async () => {
    const { createJob, updateJobStatus, resolveDependencies } = await import('../store.js');
    const parent = await createJob({ task: 'Parent' });
    const child = await createJob({ task: 'Child', dependsOn: [parent.id] });
    
    assert.equal(child.status, 'waiting');

    await updateJobStatus(parent.id, 'succeeded', { completedAt: new Date().toISOString() });
    
    const resolved = await resolveDependencies();
    const resolvedChild = resolved.find((j) => j.id === child.id);
    assert.ok(resolvedChild, 'Child should be resolved');
    assert.equal(resolvedChild!.status, 'queued');
  });

  it('should fail dependent job when parent fails', async () => {
    const { createJob, updateJobStatus, resolveDependencies } = await import('../store.js');
    const parent = await createJob({ task: 'Failing parent' });
    const child = await createJob({ task: 'Dependent child', dependsOn: [parent.id] });

    await updateJobStatus(parent.id, 'failed', { error: 'Something went wrong' });

    const resolved = await resolveDependencies();
    const failedChild = resolved.find((j) => j.id === child.id);
    assert.ok(failedChild);
    assert.equal(failedChild!.status, 'failed');
    assert.ok(failedChild!.error?.includes('Dependency failed'));
  });

  it('should compute job statistics', async () => {
    const { createJob, updateJobStatus, getJobStats } = await import('../store.js');
    const before = await getJobStats();
    const beforeTotal = before.total;

    await createJob({ task: 'Queued job' });
    const success = await createJob({ task: 'Success job' });
    await updateJobStatus(success.id, 'succeeded', { completedAt: new Date().toISOString(), lastRunAt: new Date(Date.now() - 1000).toISOString() });
    const fail = await createJob({ task: 'Fail job' });
    await updateJobStatus(fail.id, 'failed', { completedAt: new Date().toISOString(), lastRunAt: new Date(Date.now() - 2000).toISOString() });

    const stats = await getJobStats();
    assert.equal(stats.total, beforeTotal + 3);
    assert.equal(stats.byStatus.queued, before.byStatus.queued + 1);
    assert.equal(stats.byStatus.succeeded, before.byStatus.succeeded + 1);
    assert.equal(stats.byStatus.failed, before.byStatus.failed + 1);
    assert.equal(stats.successRate, (before.byStatus.succeeded + 1) / (before.byStatus.succeeded + before.byStatus.failed + 2));
    assert.ok(stats.avgDurationMs >= 0);
  });

  it('should create a job with timeout and concurrency group', async () => {
    const { createJob } = await import('../store.js');
    const job = await createJob({
      task: 'Timed concurrent task',
      timeoutMs: 30000,
      concurrencyGroup: 'group-a',
    });
    assert.equal(job.timeoutMs, 30000);
    assert.equal(job.concurrencyGroup, 'group-a');
  });

  it('should create a job requiring approval', async () => {
    const { createJob } = await import('../store.js');
    const job = await createJob({ task: 'Approval task', requiresApproval: true });
    assert.equal(job.requiresApproval, true);
    assert.equal(job.approvedAt, undefined);
  });
});