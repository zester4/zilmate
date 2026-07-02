# 🌌 ZilMate SDK Master Portal

Welcome to the **ZilMate SDK**—the production-grade agentic engineering middleware. Expose autonomous AI software engineers, parallel decentralized swarms, semantic blackboard systems, durable background schedulers, and sandboxed host utilities inside your Node.js, Next.js, and backend server runtimes.

```
                    ┌──────────────────────────────────────┐
                    │       ZilMate Master Core SDK        │
                    └──────────────────┬───────────────────┘
                                       │
         ┌─────────────────────────────┼─────────────────────────────┐
         ▼                             ▼                             ▼
┌──────────────────┐          ┌──────────────────┐          ┌──────────────────┐
│   Introduction   │          │  Quickstart & UI │          │    The Swarm     │
│ [introduction]   │          │   [quickstart]   │          │     [swarm]      │
└────────┬─────────┘          └────────┬─────────┘          └────────┬─────────┘
         │                             │                             │
         ├─────────────────────────────┼─────────────────────────────┤
         ▼                             ▼                             ▼
┌──────────────────┐          ┌──────────────────┐          ┌──────────────────┐
│  Orchestration   │          │   Coding Suite   │          │  Semantic Wiki   │
│  [orchestrator]  │          │  [coding-agent]  │          │  [wiki-memory]   │
└────────┬─────────┘          └────────┬─────────┘          └────────┬─────────┘
         │                             │                             │
         └─────────────────────────────┼─────────────────────────────┘
                                       ▼
                            ┌──────────────────┐          ┌──────────────────┐
                            │  Host Utilities  │          │   Cron Schedulers│
                            │ [host-utilities] │          │[jobs-scheduling] │
                            └──────────────────┘          └──────────────────┘
```

---

## 📚 Complete SDK Documentation

The SDK documentation is split into specialized, deep-dive chapters. Explore each module to see copy-pasteable TypeScript code, design directives, and execution telemetry.

1. **[🌌 1. Architectural Introduction](file:///c:/Users/mseyy/Downloads/zilo-manager/sdk/introduction.md)**
   - High-level multi-agent flow, system dependencies, core engines, and complete `.env` variables reference table.
2. **[⚡ 2. 3-Minute Quickstart & React UI](file:///c:/Users/mseyy/Downloads/zilo-manager/sdk/quickstart.md)**
   - Package install instructions, server initialization, typed Next.js App Router streaming endpoints (SSE/NDJSON), and glassmorphic Chat UI.
3. **[🎯 3. Manager Orchestrator & Safety Approvals](file:///c:/Users/mseyy/Downloads/zilo-manager/sdk/orchestrator.md)**
   - Manager `.manager()` vs `.chat()`, situational awareness diagnostics, session handoffs, and intercepting restricted tools with asynchronous human-in-the-loop approvals.
4. **[🛠️ 4. Autonomous Engineering & Coding Loops](file:///c:/Users/mseyy/Downloads/zilo-manager/sdk/coding-agent.md)**
   - Programmatic repo refactoring via `.coding()`, App Builder styling directives (HSL palettes, bento layouts), and QA's self-healing compilation loops.
5. **[🐝 5. Decentralized Swarms & Joint War Rooms](file:///c:/Users/mseyy/Downloads/zilo-manager/sdk/swarm.md)**
   - Running 30+ specialists in parallel, Joint War Room Horizontal Collaboration (`collaborateWithPeer`), and exporting glassmorphic trace dashboards.
6. **[💾 6. Semantic Wiki & Long-Term Memory](file:///c:/Users/mseyy/Downloads/zilo-manager/sdk/wiki-memory.md)**
   - Long-term episodic memory (`remember`/`recall`), the Shared Blackboard Wiki pattern, and configuring SuperMemory, Upstash, or Local JSON vector stores.
7. **[⚙️ 7. Sandboxed Host Utilities](file:///c:/Users/mseyy/Downloads/zilo-manager/sdk/host-utilities.md)**
   - Safety sandbox system calls: DevOps Docker container logs, SysOps networking pings/ports, tiered AWS S3/GCS/Vercel Cloud Storage, and FFmpeg transcoder engines.
8. **[📅 8. Durable Jobs & Background Scheduling](file:///c:/Users/mseyy/Downloads/zilo-manager/sdk/jobs-scheduling.md)**
   - Registering recurring background jobs, enqueuing delayed tasks, setting up serverless QStash webhook endpoints, and running local developer tunnels.
9. **[💸 9. Swarm Capability Expansions](file:///c:/Users/mseyy/Downloads/zilo-manager/sdk/expansions.md)**
   - Swarm Virtual Treasury budget controls, proactive incoming webhooks listener routing, and automated trace-driven prompt self-learning (RLAIH).

---

## 📦 Core Server Exports Reference

Initialize the SDK by importing the server layer. The primary export is `createZilMate`.

```typescript
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

### Options Object (`ZilMateOptions`)

When calling `createZilMate(options)`, pass the following parameters:

```typescript
export type ZilMateOptions = {
  sessionId?: string;                     // Isolates conversational threads, memories, and job tracking
  onProgress?: (event: ProgressEvent) => void; // Captures thinking states and tool calls in real-time
  confirm?: ConfirmationHandler;          // Attaches a custom interceptor for restricted system tools
};
```

---

## 🔄 CLI Parity Reference

The SDK exposes programmatic parity for every core CLI feature, enabling developers to easily migrate CLI routines to server routes:

| CLI Command | SDK Equivalent Call | Primary Focus |
|:---|:---|:---|
| `zilmate talk` | `createZilMate().manager({ message })` | General planning and open-ended tool loops |
| `zilmate coding "..."` | `createZilMate().coding({ prompt })` | Full-stack implementation and self-healing builds |
| `zilmate jobs worker` | `createZilMate().runDueJobs()` | Triggers background cron tasks |
| `zilmate optimize` | `runPostSessionOptimization()` | Executes trace-guided prompt self-tuning and harvesting |
| `/model pick` | `saveModelSelection(agent, model)` | Persists custom LLM routing settings |
| `zilmate doctor` | (Diagnostics built-in to `situation()`) | Validates environment, folders, and networks |
| `zilmate setup` | (Automatic on `createZilMate()` initialization) | Bootstraps configuration files and path trees |

---

## 🛡️ Production Security Checklist

When deploying ZilMate in highly-available, production-facing systems, ensure you adhere to the following best practices:

> [!CAUTION]
> **Keep Credentials Safe**: Never import or invoke the server-level ZilMate SDK inside client-side components (React/Next.js client code). Always route requests through secure Next.js API Routes, Express nodes, or serverless functions to avoid exposing your model gateway keys or system tokens to the browser console.

1. **Verify Environment Sandbox**: Ensure that commands executed by agents are run inside sandboxed containers or restricted-user environments to avoid shell injections.
2. **Leverage Persistent Redis**: For stateless, horizontally-scaled environments (like AWS Lambda or Vercel Serverless), configure `UPSTASH_REDIS_REST_URL` to handle distributed lock states, scheduler crons, and thread histories.
3. **Register Custom Confirmation Interceptors**: Always attach a `confirm` handler when exposing system-level Docker, file modification, or shell tools to end-users.
4. **Setup Secure Tunneling**: During local webhook testing (with QStash), run `npx zilmate jobs listen --tunnel` to securely proxy requests through Cloudflare tunnels instead of exposing raw router ports.
