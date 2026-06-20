# ZilMate SDK

Use ZilMate as a programmable agent layer in Next.js, server routes, background workers, and automation scripts. The SDK wraps the same manager, subagents, memory, jobs, and voice stack as the CLI.

## Install

```bash
npm install zilmate
```

Set environment variables (see `.env.example`):

```env
AI_GATEWAY_API_KEY=...
ZILMATE_USER_ID=zilmate-your-id
```

Optional: `COMPOSIO_API_KEY`, `TAVILY_API_KEY`, Upstash Redis/QStash, `DEEPGRAM_API_KEY`.

## Quick start (Node / Next.js server)

```ts
import { createZilMate } from 'zilmate/server';

const zilmate = createZilMate({
  sessionId: 'dashboard-user-123',
  onProgress: (event) => console.log(event.type, event.label),
});

const { text } = await zilmate.manager({ message: 'Summarize my open jobs and suggest next steps.' });
console.log(text);
```

## Next.js App Router — streaming chat route

Create `app/api/zilmate/route.ts`:

```ts
import { createZilMate } from 'zilmate/server';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(request: Request) {
  const { message, sessionId = 'web-default' } = await request.json();

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: unknown) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
      };

      const zilmate = createZilMate({
        sessionId,
        onProgress: (event) => send({ type: 'progress', event }),
      });

      try {
        const { text } = await zilmate.manager({ message });
        send({ type: 'done', text });
      } catch (error) {
        send({
          type: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache',
    },
  });
}
```

Client hook (React):

```tsx
'use client';

import { useState } from 'react';

export function ZilMateChat() {
  const [input, setInput] = useState('');
  const [reply, setReply] = useState('');
  const [progress, setProgress] = useState<string[]>([]);

  async function send() {
    setProgress([]);
    const res = await fetch('/api/zilmate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: input, sessionId: 'web-1' }),
    });

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        const chunk = JSON.parse(line);
        if (chunk.type === 'progress') setProgress((p) => [...p, chunk.event.label]);
        if (chunk.type === 'done') setReply(chunk.text);
      }
    }
  }

  return (
    <div>
      <textarea value={input} onChange={(e) => setInput(e.target.value)} />
      <button onClick={send}>Ask ZilMate</button>
      <ul>{progress.map((p) => <li key={p}>{p}</li>)}</ul>
      <pre>{reply}</pre>
    </div>
  );
}
```

## Subagents

The manager orchestrates specialized subagents. Call them directly when you do not need full orchestration.

| Method | Agent | Best for |
|--------|-------|----------|
| `manager()` | Main orchestrator | General tasks, routing, tools, memory |
| `coding()` | Coding agent + appBuilder + qaIntegration | Repo edits, builds, tests, patches |
| `imageAgent()` | Image director | Prompt refinement + generation/editing |
| `goalManager()` | Goal planner | Break goals into steps and schedules |
| `research()` | Docs/web research | Sourced answers |
| `help()` | Quick help | Usage and troubleshooting |
| `post()` | Copywriter | Short social/status posts |

### Coding agent with sub-coders

```ts
const zilmate = createZilMate({ sessionId: 'repo-session' });

const { text } = await zilmate.coding({
  prompt: [
    'In this Next.js repo:',
    '1) Add a /api/health route',
    '2) Run typecheck',
    '3) Return files changed and test output',
  ].join('\n'),
});
```

Internally, the coding agent can delegate to:

- **appBuilder** — full app/game/UI implementation
- **qaIntegration** — tests, build fixes, release checks

It also uses **code intelligence tools**: `grepCodebase`, `reviewWorkingTree`, `explainSymbol`, `scaffoldFiles`, `runProjectChecks`.

### Image director

```ts
const { text } = await zilmate.imageAgent({
  prompt: 'Product hero image: dark SaaS dashboard on laptop, cyan accent, no text gibberish, 16:9',
});
```

The image agent runs `enhanceImagePrompt` then `generateImage` for precise visuals.

## Agentic features (10x differentiators)

### 1. Situational awareness

Before major work, the manager can call `getSituationBrief` (cwd, git, workspace, models, jobs, memory, projects). Use directly:

```ts
const brief = await zilmate.situation({ sessionId: 'default' });
console.log(brief.git, brief.recentJobs, brief.models);
```

### 2. Session continuity (handoffs)

Resume work across sessions:

```ts
const handoff = await zilmate.handoff({ sessionId: 'default' });
if (handoff) {
  await zilmate.manager({
    message: `Continue from handoff:\n${handoff.summary}\nNext: ${handoff.nextActions.join(', ')}`,
  });
}
```

The manager can also call `generateSessionHandoff` / `saveSessionHandoff` before ending a long task.

## Model selection

CLI users run `/model pick`. In code, persist selections to the workspace:

```ts
import { applyStoredModelSelections, saveModelSelection } from 'zilmate/server';

await applyStoredModelSelections();
await saveModelSelection('manager', 'anthropic/claude-sonnet-4');
await saveModelSelection('coding', 'openai/gpt-5.4-mini');
```

Models are stored in `~/Downloads/ZilMate/config/models.json` (or `ZILMATE_WORKSPACE`).

## Memory

```ts
await zilmate.remember({ text: 'User prefers pnpm and App Router', tags: ['prefs'] });
const hits = await zilmate.recall({ query: 'package manager', limit: 5 });
```

## Background jobs

```ts
const job = await zilmate.createJob({
  task: 'Weekly summary of GitHub PRs',
  schedule: '0 9 * * 1',
});

await zilmate.runDueJobs();
const logs = await zilmate.getJobLogs(job.id);
```

Expose webhooks for QStash:

```ts
// app/api/jobs/webhook/route.ts
import { createZilMate } from 'zilmate/server';

export async function POST(req: Request) {
  const body = await req.json();
  const zilmate = createZilMate();
  const job = await zilmate.handleJobWebhook(body, process.env.ZILMATE_JOB_WEBHOOK_SECRET);
  return Response.json({ ok: true, jobId: job.id });
}
```

Use `zilmate jobs listen --tunnel` (Cloudflare quick tunnel) during local development.

## Voice (Deepgram)

```ts
const session = await zilmate.startVoiceSession({
  onProgress: (e) => console.log(e.label),
});

// session exposes Deepgram agent wiring — see src/voice/deepgram.ts
console.log(session.config.listenModel);
await session.close?.();
```

## Confirmation in server contexts

Destructive tools require explicit approval. Provide a handler:

```ts
import type { ConfirmationHandler } from 'zilmate/server';

const confirm: ConfirmationHandler = async (request) => {
  // In a web app, push to UI and await user click
  console.log('Approve?', request.message);
  return true;
};

const zilmate = createZilMate({ confirm });
```

## Exports reference

```ts
import {
  createZilMate,
  chat,
  help,
  post,
  research,
  image,
  applyStoredModelSelections,
  buildSituationBrief,
  loadSessionHandoff,
  clearSessionApprovals,
} from 'zilmate/server';
```

## CLI parity

| CLI | SDK |
|-----|-----|
| `zilmate talk` | `createZilMate().manager()` |
| `zilmate coding "..."` | `createZilMate().coding()` |
| `zilmate heal` | manager + heal tools (via manager) |
| `zilmate jobs worker` | `runDueJobs()` + worker process |
| `/model pick` | `saveModelSelection()` |

## Production checklist

1. Run `zilmate setup` once per environment (merge-safe).
2. Set `ZILMATE_WORKSPACE` for durable notebook/knowledge/skills.
3. Enable Redis for multi-instance memory and jobs.
4. Use QStash + Cloudflare tunnel for hosted schedules.
5. Never expose `AI_GATEWAY_API_KEY` to the browser — keep SDK calls on the server.

## Learn more

- Repository: https://github.com/zester4/zilo-manager
- Agent skill: `plugins/zilmate/skills/zilmate/SKILL.md`
- AI SDK patterns: https://sdk.vercel.ai/docs
