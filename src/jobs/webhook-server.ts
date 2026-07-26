import http from 'node:http';
import { handleJobWebhook } from './runner.js';
import { env } from '../config/env.js';

export type JobWebhookServer = {
  port: number;
  url: string;
  close: () => Promise<void>;
};

export type JobWebhookRequest = {
  method?: string | undefined;
  url?: string | undefined;
  body?: unknown;
  headers?: Record<string, string | undefined>;
};

export type JobWebhookResponse = {
  statusCode: number;
  headers: Record<string, string>;
  body?: string | undefined;
  writeHead(status: number, headers?: Record<string, string>): void;
  end(body?: string | undefined): void;
};

function normalizeBody(body: unknown): string {
  if (typeof body === 'string') return body;
  if (body == null) return '';
  if (Buffer.isBuffer(body)) return body.toString('utf8');
  return JSON.stringify(body);
}

export function createJobWebhookHandler(options: { expectedSecret?: string } = {}) {
  return async function handleRequest(req: JobWebhookRequest, res: JobWebhookResponse) {
    try {
      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, service: 'zilmate-jobs' }));
        return;
      }

      if (req.method !== 'POST' || !req.url?.startsWith('/jobs/webhook')) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
        return;
      }

      const payload = JSON.parse(normalizeBody(req.body) || '{}') as { jobId?: string; secret?: string };
      if (!payload.jobId) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing jobId' }));
        return;
      }

      const expectedSecret = options.expectedSecret ?? (env.zilmateJobWebhookSecret || undefined);
      const job = await handleJobWebhook(
        {
          jobId: payload.jobId,
          ...(payload.secret ? { secret: payload.secret } : {}),
        },
        expectedSecret,
      );

      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, job }));
    } catch (error) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  };
}

export async function startJobWebhookServer(port = Number(process.env.ZILMATE_WEBHOOK_PORT || 8787)): Promise<JobWebhookServer> {
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', async () => {
      const body = Buffer.concat(chunks).toString('utf8');
      const handler = createJobWebhookHandler();
      await handler(
        { method: req.method ?? undefined, url: req.url ?? undefined, body, headers: req.headers as Record<string, string | undefined> },
        {
          statusCode: 200,
          headers: {},
          writeHead(status, headers) {
            this.statusCode = status;
            if (headers) Object.assign(this.headers, headers);
          },
          end(bodyText) {
            this.body = bodyText ?? undefined;
            res.writeHead(this.statusCode, this.headers);
            res.end(bodyText);
          },
        } as JobWebhookResponse,
      );
    });
    req.on('error', (error) => {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });

  return {
    port,
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    }),
  };
}
