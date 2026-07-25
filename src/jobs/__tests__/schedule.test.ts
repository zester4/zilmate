// src/jobs/__tests__/schedule.test.ts
// Unit tests for the schedule module (nextRunFromSchedule, isDue, isRecurringSchedule, qstashCron)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { nextRunFromSchedule, isDue, isRecurringSchedule, qstashCron } from '../schedule.js';

describe('Schedule', () => {
  it('should parse "every N minutes"', () => {
    const result = nextRunFromSchedule('every 15 minutes');
    assert.ok(result, 'Should return a date string');
    const date = new Date(result!);
    assert.ok(date.getTime() > Date.now(), 'Should be in the future');
  });

  it('should parse "every N hours"', () => {
    const result = nextRunFromSchedule('every 3 hours');
    assert.ok(result);
    const date = new Date(result!);
    assert.ok(date.getTime() > Date.now());
  });

  it('should parse "every N days"', () => {
    const result = nextRunFromSchedule('every 2 days');
    assert.ok(result);
    const date = new Date(result!);
    assert.ok(date.getTime() > Date.now());
  });

  it('should parse "hourly"', () => {
    const result = nextRunFromSchedule('hourly');
    assert.ok(result);
    const date = new Date(result!);
    const diffMs = date.getTime() - Date.now();
    assert.ok(diffMs > 0 && diffMs < 2 * 60 * 60 * 1000, 'Should be within 2 hours');
  });

  it('should parse "daily"', () => {
    const result = nextRunFromSchedule('daily');
    assert.ok(result);
    const date = new Date(result!);
    const diffMs = date.getTime() - Date.now();
    assert.ok(diffMs > 0 && diffMs < 2 * 24 * 60 * 60 * 1000, 'Should be within 2 days');
  });

  it('should parse an ISO date string', () => {
    const future = new Date(Date.now() + 3600000).toISOString();
    const result = nextRunFromSchedule(future);
    assert.equal(result, future);
  });

  it('should return undefined for invalid schedule', () => {
    const result = nextRunFromSchedule('invalid schedule');
    assert.equal(typeof result, 'undefined');
  });

  it('should return undefined for empty schedule', () => {
    assert.equal(typeof nextRunFromSchedule(''), 'undefined');
    assert.equal(typeof nextRunFromSchedule(undefined), 'undefined');
  });

  it('isDue should return true for past dates', () => {
    const past = new Date(Date.now() - 10000).toISOString();
    assert.ok(isDue(past));
  });

  it('isDue should return false for future dates', () => {
    const future = new Date(Date.now() + 10000).toISOString();
    assert.equal(isDue(future), false);
  });

  it('isDue should return true for undefined', () => {
    assert.ok(isDue(undefined!) === true);
  });

  it('isRecurringSchedule should detect recurring patterns', () => {
    assert.ok(isRecurringSchedule('every 15 minutes'));
    assert.ok(isRecurringSchedule('hourly'));
    assert.ok(isRecurringSchedule('daily'));
    assert.ok(isRecurringSchedule('cron:0 9 * * *'));
    assert.ok(isRecurringSchedule('cron(0 9 * * *)'));
    assert.equal(isRecurringSchedule('once'), false);
    assert.equal(isRecurringSchedule(undefined as any), false);
  });

  it('qstashCron should convert schedules to cron expressions', () => {
    assert.equal(qstashCron('cron:0 9 * * *'), '0 9 * * *');
    assert.equal(qstashCron('cron(0 9 * * *)'), '0 9 * * *');
    assert.equal(qstashCron('hourly'), '0 * * * *');
    assert.equal(qstashCron('daily'), '0 9 * * *');
    assert.equal(typeof qstashCron('once'), 'undefined');
    assert.equal(typeof qstashCron(undefined), 'undefined');
  });
});