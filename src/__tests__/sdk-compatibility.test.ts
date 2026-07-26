import test from 'node:test';
import assert from 'node:assert/strict';
import { createZilMate, resolveSubagentRoute } from '../server.js';
import { createJobWebhookHandler } from '../jobs/webhook-server.js';

test('createZilMate exposes the public SDK methods without requiring constructor-time auth', () => {
  const sdk = createZilMate({ sessionId: 'compat-test' });
  assert.equal(typeof sdk.chat, 'function');
  assert.equal(typeof sdk.manager, 'function');
  assert.equal(typeof sdk.coding, 'function');
  assert.equal(typeof sdk.createJob, 'function');
  assert.equal(typeof sdk.handleJobWebhook, 'function');
  assert.equal(typeof sdk.callSubagent, 'function');
});

test('resolveSubagentRoute recognizes swarm specialist keys for SDK delegation', () => {
  assert.equal(resolveSubagentRoute('cto'), 'swarm');
  assert.equal(resolveSubagentRoute('coding'), 'specialist');
  assert.equal(resolveSubagentRoute('digitalCorporation'), 'manager');
});

test('createZilMate emits audit events when onAudit is provided', async () => {
  const events: Array<Record<string, unknown>> = [];
  const sdk = createZilMate({
    sessionId: 'audit-test',
    onAudit: (event) => events.push(event as Record<string, unknown>),
  });

  await assert.rejects(() => sdk.help({ question: 'hi' }), /Missing AI Gateway auth/);

  assert.ok(events.length >= 2);
  const first = events[0]!;
  const last = events.at(-1)!;
  assert.equal(first.action, 'help');
  assert.equal(first.phase, 'start');
  assert.equal(last.phase, 'error');
  assert.equal(last.status, 'error');
});

test('webhook handler rejects malformed payloads with a clear 400 response', async () => {
  const handler = createJobWebhookHandler();
  const req = { method: 'POST', url: '/jobs/webhook', body: '{}' } as any;
  const res = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
    writeHead(status: number, headers?: Record<string, string>) {
      this.statusCode = status;
      if (headers) {
        Object.assign(this.headers, headers);
      }
    },
    end(body: string) {
      this.body = body;
    },
  } as any;

  await handler(req, res);

  assert.equal(res.statusCode, 400);
  assert.match(res.body, /Missing jobId/);
});
