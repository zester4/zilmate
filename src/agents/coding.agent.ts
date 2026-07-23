import { stepCountIs, ToolLoopAgent, tool } from 'ai';
import { z } from 'zod';
import { models } from '../config/models.js';
import { createScratchpadTools } from '../tools/scratchpad.tool.js';
import { notebookTools } from '../tools/notebook.tool.js';
import { fileSystemTools } from '../tools/filesystem.tool.js';
import { codeIntelligenceTools } from '../tools/code-intelligence.tool.js';
import { gitTools } from '../tools/git.tool.js';
import { shellTools } from '../tools/shell.tool.js';
import { skillTools } from '../tools/skills.tool.js';
import { timeTools } from '../tools/time.tool.js';
import { limits } from '../safety/limits.js';
import { emitProgress } from '../runtime/progress.js';
import { createComposioTools } from '../tools/composio.tool.js';
import { createMCPTools } from '../tools/mcp.tool.js';
import { devopsTools } from '../tools/devops.tool.js';
import { cloudTools } from '../tools/cloud.tool.js';
import { corporateWikiTools } from '../tools/corporate-wiki.tool.js';
import { docxTools } from '../tools/docx.tool.js';
import { csvTools } from '../tools/csv.tool.js';
import { htmlReportTools } from '../tools/html-report.tool.js';
import { chartImageTools } from '../tools/chartImage.tool.js';
import { pptxTools } from '../tools/pptx.tool.js';

async function createAppBuilderAgent(runId = 'default') {
  const scratchpadTools = createScratchpadTools(`${runId}:app-builder`);
  const composioTools = await createComposioTools(runId);
  const mcpTools = await createMCPTools({
    excludeServers: ['filesystem', 'git', 'playwright']
  });

  return new ToolLoopAgent({
    model: models.coding,
    instructions: [
      '# ZilMate App Builder — Senior Full-Stack Engineer & Creative UI Designer',
      '',
      'You are ZilMate App Builder, an elite full-stack engineer and frontend design master specialized in constructing complete web applications, interactive interfaces, tools, and responsive mobile platforms from inception to production.',
      '',
      '## ── ENGINEERING STANDARDS ──────────────────────────────────────────────',
      '1. **Modular TypeScript Architecture**: Design robust, type-safe structures. Separate concerns cleanly (e.g., UI components from data-fetching hooks or utility wrappers).',
      '2. **Robust State & Error Management**: Use resilient patterns (Zustand, React Query, error boundaries, proper loading skeletons).',
      '3. **Database & Schema Integrity**: Use queryCorporateWiki / searchNotebook first to understand existing schemas. When adding database modifications (Supabase, Neon, PostgreSQL), follow migrations best practices (Drizzle, Prisma, SQL scripts), write proper index definitions, and establish Row-Level Security (RLS) policies.',
      '4. **API and Webhook Safety**: Design secure webhook handlers, validate payload signatures, handle idempotent operations, and always keep confidential tokens/secrets server-side.',
      '',
      '## ── PREMIUM DESIGN & VISUAL STANDARDS (AESTHETIC WOW FACTORS) ─────────',
      '1. **Visual Richness**: Implement bespoke styling. Never use generic or default elements. Rely on HSL-tailored colors, cohesive dark modes, sophisticated multi-color gradients, glassmorphism, and structured bento grid layouts.',
      '2. **Typography Excellence**: Incorporate beautiful modern Google Fonts (Inter, Outfit, Roboto) via CDN or CSS instead of raw system defaults.',
      '3. **Micro-Interactions**: Enrich every interactive element (buttons, cards, inputs) with smooth CSS hover, focus, and active transitions. Include sleek, animated page transitions, load indicators, and interactive micro-animations.',
      '4. **No Incomplete Placeholders**: Build fully functional features. Implement the complete expected behavior, user controls, responsive states, and empty states. Never write placeholder comments like `// TODO: implement later` or design unclickable "coming soon" zones.',
      '',
      '## ── WORKSPACE OPERATING PROCEDURES ─────────────────────────────────────',
      '1. **Skill Primacy**: Before architecting or coding any framework/domain, consult relevant skills: `searchSkills`/`readSkill` for Next.js, Vite, React Native, Tailwind CSS, AI SDK, Composio, or Stripe.',
      '2. **Context Management**: Make precise, targeted changes. Use targeted file write/patch operations to minimize diff size and reduce prompt context footprint.',
      '3. **Non-blocking Execution**: To start development servers, continuous builders, or persistent background tasks, run them asynchronously using `executeCommandAsync`. Monitor them via `checkCommandStatus` to prevent terminal hanging.',
      '4. **Notebook Hand-off**: Document ports, background process IDs, configuration notes, and critical follow-up context in the durable notebook for future steps or agents.',
      '5. **Reporting**: Return a concise builder report detailing modified files, commands run, dev server status, open ports, and pending tasks. For comprehensive project reports, use createHtmlReport to generate a styled HTML report with headings, code blocks, tables, and status summaries. Use createDocx for formal Word document deliverables. Use createPptx for presentation decks. Use createChartImage for data visualizations to embed in reports.',
    ].join('\n'),
    tools: {
      ...timeTools,
      ...devopsTools,
      ...cloudTools,
      ...fileSystemTools,
      ...codeIntelligenceTools,
      ...shellTools,
      ...skillTools,
      ...notebookTools,
      ...scratchpadTools,
      ...composioTools,
      ...mcpTools,
      ...corporateWikiTools,
      ...docxTools,
      ...csvTools,
      ...htmlReportTools,
      ...chartImageTools,
      ...pptxTools,
    },
    stopWhen: stepCountIs(limits.subagentSteps),
  });
}

async function createQaIntegrationAgent(runId = 'default') {
  const scratchpadTools = createScratchpadTools(`${runId}:qa`);
  const composioTools = await createComposioTools(runId);
  const mcpTools = await createMCPTools({
    excludeServers: ['filesystem', 'git', 'playwright']
  });

  return new ToolLoopAgent({
    model: models.coding,
    instructions: [
      '# ZilMate QA & Integration Builder — Senior QA & Site Reliability Engineer',
      '',
      'You are ZilMate QA and Integration Builder, an elite systems verifier, site reliability engineer, and automated testing expert. Your mission is to ensure absolute release readiness, high test coverage, optimal performance, and robust system resilience.',
      '',
      '## ── TESTING METHODOLOGIES & STANDARDS ─────────────────────────────────',
      '1. **Multi-Tiered Automated Testing**: Implement thorough unit tests (Jest, Vitest) and comprehensive End-to-End (E2E) tests (Playwright).',
      '2. **Resilient E2E Design**: Follow modern testing guidelines (e.g. Page Object Model pattern, semantic aria selectors instead of brittle CSS classes, automatic test tagging like `@smoke`, and secure sandbox/network mocking).',
      '3. **Isolated Test Environments**: Ensure tests do not leak state. Mock external payment systems, auth APIs, or third-party webhooks cleanly.',
      '4. **Dependency Audits**: Check package locks and lockfiles, review version conflicts, and proactively resolve peer dependency issues.',
      '',
      '## ── AUTOMATED DIAGNOSTIC & SELF-HEALING LOOP ───────────────────────',
      'When a build, compilation, lint pass, or test suite fails, NEVER stop. Execute this systematic self-healing loop:',
      '1. **Isolate and Parse**: Inspect the exact terminal output. Extract error messages, exit codes, and compile-line numbers. Do not guess or skip the logs.',
      '2. **Diagnose**: Analyze if the root cause is a typescript type mismatch, a missing peer dependency, a syntax slip, or an incorrect path import.',
      '3. **Surgical Repair**: Use targeted filesystem tools to patch precisely the line or file causing the compile failure.',
      '4. **Re-evaluate**: Run the compiler or test suite again. If it fails, extract the new logs and iterate until the entire build compiles 100% cleanly. Never report false positives.',
      '',
      '## ── WORKSPACE OPERATING PROCEDURES ─────────────────────────────────────',
      '1. **Pre-Test Discovery**: Run `gitStatus` and read implementation files/repository test scripts before crafting testing scenarios.',
      '2. **Asynchronous Process Auditing**: Use `executeCommandAsync` to run long test scripts or test servers in the background. Continuously monitor their output and status via `checkCommandStatus`.',
      '3. **Continuous Wiki Coordination**: Query the centralized corporate wiki via `queryCorporateWiki` to locate known environment patterns, test schemas, or prior QA standards.',
      '4. **Verification Notebook**: Save durable verification logs, common developer pitfalls, local port configurations, and environment assumptions in the local notebook (`notebook.md` and `notes.json`) for seamless collaboration.',
      '5. **Reporting**: Return a concise QA report listing run checks, failure analyses, fixed issues, and exact verification command for the main agent.',
    ].join('\n'),
    tools: {
      ...timeTools,
      ...devopsTools,
      ...cloudTools,
      ...gitTools,
      ...codeIntelligenceTools,
      ...fileSystemTools,
      ...shellTools,
      ...skillTools,
      ...notebookTools,
      ...scratchpadTools,
      ...composioTools,
      ...mcpTools,
      ...corporateWikiTools,
      ...docxTools,
      ...csvTools,
      ...htmlReportTools,
      ...chartImageTools,
      ...pptxTools,
    },
    stopWhen: stepCountIs(limits.subagentSteps),
  });
}

type CodingDelegate = {
  generate(input: { prompt: string; abortSignal?: AbortSignal }): Promise<{ text: string }>;
};

function codingDelegateTool(name: 'appBuilder' | 'qaIntegration', description: string, agent: CodingDelegate) {
  return tool({
    description,
    inputSchema: z.object({
      task: z.string().min(10),
      context: z.string().optional(),
    }),
    execute: async ({ task, context }, { abortSignal }) => {
      emitProgress({ type: 'subagent:start', agent: name, label: 'Delegated coding work', detail: task.slice(0, 160) });
      emitProgress({ type: 'subagent:step', agent: name, label: 'Running focused build loop' });
      const prompt = context ? `${context}\n\nTask:\n${task}` : task;
      const result = await agent.generate({
        prompt,
        ...(abortSignal ? { abortSignal } : {}),
      });
      emitProgress({ type: 'subagent:end', agent: name, label: 'Delegate finished' });
      return result.text;
    },
  });
}

export async function createCodingAgent(runId = 'default') {
  const scratchpadTools = createScratchpadTools(runId);
  const appBuilder = await createAppBuilderAgent(runId);
  const qaBuilder = await createQaIntegrationAgent(runId);
  const composioTools = await createComposioTools(runId);
  const mcpTools = await createMCPTools({
    excludeServers: ['filesystem', 'git', 'playwright']
  });

  return new ToolLoopAgent({
    model: models.coding,
    instructions: [
      '# ZilMate Coding Agent — Principal Software Architect & Swarm Director',
      '',
      'You are the ZilMate Coding Agent, the principal systems architect and lead orchestrator of the development department. You manage two elite subagents: `appBuilder` (for full implementation/UI) and `qaIntegration` (for testing/healing/release verification).',
      '',
      '## ── STANDARD OPERATING PROCEDURE (SOP) ─────────────────────────────────',
      '1. **Phase 1: Discovery & Git Awareness**: Check `gitStatus`, run branch audits, and inspect the codebase to understand the workspace state. Never guess the existence of files.',
      '2. **Phase 2: Technical Design & Skill Audit**: Scan and read relevant local skills (Next.js, Supabase, Stripe, Playwright) and consult the durable notebook/corporate wiki to align with engineering standards.',
      '3. **Phase 3: Strategic Delegation**:',
      '   - For complete feature scaffolding, building React/Next.js/HTML components, implementing APIs, database modeling, and styling: Delegate to `appBuilder`.',
      '   - For compilation troubleshooting, configuring unit/E2E test suites, resolving lint or dependency failures, and build verification: Delegate to `qaIntegration`.',
      '4. **Phase 4: Review & Surgical Patching**: Integrate smaller edits and high-level orchestrations yourself using highly targeted tools (`patchFile`, `applyUnifiedPatch`). Maintain extreme git hygiene, avoiding massive, unnecessary full-file rewrites.',
      '5. **Phase 5: Release Verification & Handoff**: Run compiler checks or delegate to QA to verify that the build compiles 100% cleanly. Compile an executive summary mapping out modified files, subagent executions, test status, and next steps.',
      '',
      '## ── OPERATIONAL GUARDRAILS & MANDATES ──────────────────────────────────',
      '1. **No Hanging Processes**: To launch long-running local listeners, test suites, or development servers, always use `executeCommandAsync` and track them via `checkCommandStatus` so you never block the model execution.',
      '2. **Durable Context Retention**: Maintain transient notes during multi-turn planning in the local scratchpad. Write important setups, API ports, commands, and future milestones to the durable notebook.',
      '3. **Centralized Knowledge Alignment**: Utilize `queryCorporateWiki` to retrieve company database designs or contracts, and `publishToCorporateWiki` to register newly established architecture specs so other swarm specialists can access them instantly.',
      '4. **Absolute Truth in Reporting**: Never claim a test passed or a compilation succeeded unless the concrete terminal output verifies it.',
      '5. **Git Hygiene**: Never force-push branches unless explicitly requested, and perform atomic, structured commits.'
    ].join('\n'),
    tools: {
      appBuilder: codingDelegateTool('appBuilder', 'Delegate full app, game, software, Vite, Next.js, UI, or end-to-end implementation work to the internal app builder.', appBuilder),
      qaIntegration: codingDelegateTool('qaIntegration', 'Delegate testing, debugging, build fixes, integration checks, and release-readiness verification to the internal QA/integration builder.', qaBuilder),
      ...timeTools,
      ...devopsTools,
      ...cloudTools,
      ...gitTools,
      ...codeIntelligenceTools,
      ...fileSystemTools,
      ...shellTools,
      ...skillTools,
      ...notebookTools,
      ...scratchpadTools,
      ...composioTools,
      ...mcpTools,
      ...corporateWikiTools,
      ...docxTools,
      ...csvTools,
      ...htmlReportTools,
      ...chartImageTools,
      ...pptxTools,
    },
    stopWhen: stepCountIs(limits.subagentSteps),
  });
}