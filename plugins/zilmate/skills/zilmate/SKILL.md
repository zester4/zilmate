---
name: zilmate
description: Use when helping users understand, build, integrate, package, publish, test, or position ZilMate as a personal AI assistant, CLI, SDK, app-embeddable assistant, realtime voice assistant, automation worker, or tool-powered local/desktop agent. Applies to ZilMate CLI commands, zilmate/server SDK usage, Next.js/backend integration, voice mode, jobs and scheduling, Composio workflows, memory, desktop tools, image generation/editing, security/OSINT/pentest capabilities, npm releases, and product messaging.
---

# ZilMate

ZilMate is a personal AI assistant that can live in the terminal, run behind server-side app routes, and power custom assistant UIs. Treat it as an assistant runtime with real tools, not as a simple chatbot. It can talk, listen, remember, research, use connected apps, work with local files, schedule jobs, inspect desktop context, generate and edit images, and delegate focused work to specialist subagents.

Do not describe ZilMate as tied to another product unless the user explicitly asks about that product. Keep the framing broad: ZilMate is the assistant layer.

## Product Positioning

Describe ZilMate as:

- A personal assistant for daily planning, writing, research, development, automation, and local desktop work.
- A CLI-first assistant with polished setup, diagnostics, menu flows, memory, jobs, voice, and tool access.
- A server-side SDK developers can import into apps, dashboards, internal tools, and custom chat experiences.
- A bridge between conversation and action: it can call tools, use subagents, save state, and return structured results.
- A package that can be extended with app connectors, local tools, workflows, and product-specific UI.

Avoid vague claims like "all-in-one AI platform" or "just a wrapper." Lead with concrete things ZilMate can do.

## Current Surfaces

- `zilmate` / `zilmate talk`: interactive terminal assistant.
- `zilmate menu`: guided CLI menu for setup, chat, jobs, health, apps, and memory.
- `zilmate voice live`: realtime microphone conversation with spoken replies.
- `zilmate jobs ...`: persistent jobs, schedules, logs, worker, and API-first automation.
- `zilmate setup`: guided setup for keys, voice, jobs, Composio, QStash, desktop features, and optional tools.
- `zilmate doctor`: health checks for keys, tools, models, package state, and feature readiness.
- `zilmate/server`: server-side SDK for apps, backend routes, Next.js API routes, hosted workers, and custom UIs.
- `zilmate/cli`: terminal-oriented entry behavior.
- `zilmate/edge`: future direction for Deno/Supabase-style HTTP-safe adapters.

Keep browser/client guidance server-safe: browser UIs should call an app-owned API route that imports `zilmate/server`; do not put secrets or private runtime code in client components.

## What Makes It Powerful

ZilMate combines these layers:

- **Realtime voice:** Deepgram Flux-style listening plus spoken replies, with shared text/voice session behavior when launched from chat.
- **Long-term memory:** User-owned facts, preferences, and useful working context.
- **Background jobs:** Local worker, scheduled tasks, logs/status APIs, and optional hosted scheduling through QStash/webhooks.
- **Composio connectors:** Connected-app actions and trigger-to-workflow handlers for apps such as Gmail, Calendar, Slack, Notion, GitHub, Linear, Discord, Supabase, Stripe, and other supported integrations.
- **Desktop tools:** Clipboard, screenshots, screenshot analysis, camera/photo capture, file/app launching, keyboard automation, system info, and running app inspection.
- **File tools:** Search, read/write, move/copy/rename, create folders, metadata, summaries, duplicate/large-file checks, watch-style folder checks, and safe deletion with confirmation.
- **Shell tools:** Run shell/PowerShell commands, scripts, package installs, build/test commands, pipelines, and system checks when the user approves the working context.
- **Computer-use tools:** Screen reading, mouse/keyboard actions, window management, drag/drop, and UI interaction for local automation.
- **Image tools:** Generate new images or edit existing images using OpenAI or Gemini models. Accept local image paths, image URLs, and optional masks, then save outputs locally.
- **Research tools:** Docs and web research, with source-aware summaries when current information matters.
- **Specialist subagents:** Chat, research, post writing, image work, automation planning, personal assistance, developer help, coding, goal management, and security.

## Security Agent

ZilMate includes a permission-aware security subagent for authorized work only.

Capabilities include:

- OSINT investigation for usernames, emails, phones, domains, metadata, public records, and network intelligence.
- OSINT tool checking and setup through install/check helpers.
- Pentest workflows such as subdomain discovery, HTTP probing, port scanning, template-based vulnerability checks, fuzzing, and SQL injection testing.
- Output capture under `outputs/osint/` and `outputs/pentest/`.

Rules for using or describing security features:

- Always require user authorization for active scanning, exploitation-style testing, or testing third-party targets.
- Prefer passive OSINT when permission is unclear.
- Ask for explicit target scope before running active tools.
- Mention that sensitive actions use confirmation prompts and should be run only on systems the user owns or is allowed to test.
- Do not present ZilMate as a stealth, evasion, or abuse tool.

## SDK Guidance

Use `zilmate/server` when the user wants:

- A custom web or mobile chat UI.
- A Next.js, Vercel, Railway, Express, or backend-hosted assistant route.
- Server-side control over sessions, auth, tools, memory, logs, and environment variables.
- Hosted workflows, webhooks, or app-triggered jobs.

Typical pattern:

```ts
import { createZilMate } from "zilmate/server";

export async function POST(request: Request) {
  const body = await request.json();
  const zilmate = createZilMate({ sessionId: body.sessionId });
  const result = await zilmate.chat(body.message);
  return Response.json(result);
}
```

For production UIs:

- Keep API keys in server environment variables.
- Let the frontend send messages, session IDs, selected mode, and attachments.
- Return structured assistant output, progress events, tool summaries, job IDs, and errors.
- For realtime voice in web apps, design a browser voice route separately; the local `zilmate voice live` command is terminal/desktop-oriented.

## CLI Guidance

Common commands:

```powershell
npm install -g zilmate
zilmate
zilmate menu
zilmate setup
zilmate doctor
zilmate talk
zilmate voice doctor
zilmate voice live
zilmate jobs
zilmate jobs worker
zilmate update
```

When users ask how updates work, explain that npm-installed users update through the package manager, while the CLI can offer a friendlier `zilmate update` flow that checks the latest npm version and runs the right install command.

When users ask whether it works on Windows, macOS, and Linux, answer by feature:

- Core CLI, SDK, jobs, memory, and app connectors should be cross-platform.
- Desktop, screenshot, clipboard, camera, audio, shell, and computer-use features depend on OS tools and setup.
- The setup wizard and doctor should detect missing dependencies and guide the user instead of failing silently.

## Voice Guidance

Voice mode should be described as a realtime assistant experience, not a record-then-transcribe flow.

Expected behavior:

- `zilmate voice live` starts listening from the terminal and speaks back.
- `/voice` inside `zilmate talk` starts voice mode from the current chat session.
- `/voice -q` stops voice mode and returns to typed chat.
- `/talk` inside standalone voice mode can switch into typed chat where supported.
- Voice answers should know they are in voice mode, avoid markdown-heavy output, and speak concise responses.
- Voice should share useful session context with text chat when launched from the same talk session.

## Jobs And Automation

ZilMate jobs are for persistent automation:

- `zilmate jobs create "<task>"`
- `zilmate jobs list`
- `zilmate jobs status <id>`
- `zilmate jobs logs <id>`
- `zilmate jobs run <id>`
- `zilmate jobs worker`
- `zilmate jobs cancel <id>`

Clarify the runtime model:

- Local jobs keep running after chat closes while the machine is awake and online.
- Local jobs do not keep running if the laptop sleeps, shuts down, or loses internet.
- Hosted always-on behavior needs a deployed worker plus webhook/QStash delivery.
- QStash gives durable callbacks only when a public endpoint is running.

## Setup Guidance

The setup experience should be guided and skippable:

- Explain what keys or services the user may need before setup starts.
- Let users say yes/no to optional features such as Composio, QStash, voice, camera, desktop tools, and security tooling.
- Mask secret input.
- Write local configuration into ZilMate's workspace/config files rather than requiring manual `.env` edits.
- Run a doctor check after setup and give specific next commands.

Never ask users to paste secrets into normal chat. Send them through setup or documented environment configuration.

## Answer Style

When answering ZilMate questions:

- Be direct and product-minded.
- Benefits first, implementation second.
- Recommend CLI plus SDK for a serious assistant product.
- Distinguish local desktop features from hosted server features.
- For security features, emphasize authorization and scope.
- For app integration, keep secrets server-side.
- When asked to build, make the code changes and verify with build/tests.

## Useful One-Liner

ZilMate is a personal AI assistant runtime with CLI, SDK, realtime voice, memory, jobs, app connectors, local desktop tools, image generation/editing, and specialist subagents for getting real work done.
