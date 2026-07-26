import './pre-init.js';
import { randomUUID } from 'node:crypto';
import { requireGatewayAuth } from './config/env.js';
import { applyStoredModelSelections } from './config/model-store.js';
import type { ConfirmationHandler, ConfirmationRequest } from './runtime/confirm.js';
import { clearSessionApprovals } from './runtime/confirm.js';
import type { ProgressEvent } from './runtime/progress.js';
import type { CreateJobInput, JobLog, JobStatus, ListJobsOptions, ZilMateJob } from './jobs/types.js';
import type { ZilMateVoiceConfig, ZilMateVoiceSessionOptions, ZilMateVoiceSessionResult } from './voice/types.js';
import type { ImageGenerationOptions, ImageGenerationResult } from './tools/image-generate.tool.js';
import type { LongTermMemory } from './memory/long-term.js';

async function loadAgentModules() {
  const [{ createChatAgent }, { createCodingAgent }, { createImageAgent }, { createGoalManagerAgent }, { createDocsResearchAgent }, { createPostAgent }, { createQuickHelpAgent }, { createAutomationPlannerAgent }, { createPersonalAssistantAgent }, { createDeveloperHelperAgent }, { createSecurityAgent }, { createFinanceAgent }, { runManager }] = await Promise.all([
    import('./agents/chat.agent.js'),
    import('./agents/coding.agent.js'),
    import('./agents/image.agent.js'),
    import('./agents/goal-manager.agent.js'),
    import('./agents/docs-research.agent.js'),
    import('./agents/post.agent.js'),
    import('./agents/quick-help.agent.js'),
    import('./agents/automation-planner.agent.js'),
    import('./agents/personal-assistant.agent.js'),
    import('./agents/developer-helper.agent.js'),
    import('./agents/security.agent.js'),
    import('./agents/finance.agent.js'),
    import('./agents/manager.js'),
  ]);
  return { createChatAgent, createCodingAgent, createImageAgent, createGoalManagerAgent, createDocsResearchAgent, createPostAgent, createQuickHelpAgent, createAutomationPlannerAgent, createPersonalAssistantAgent, createDeveloperHelperAgent, createSecurityAgent, createFinanceAgent, runManager };
}

async function loadGenerateImageModule() {
  const { generateImageAsset } = await import('./tools/image-generate.tool.js');
  return generateImageAsset;
}

async function loadMemoryModules() {
  const [{ clearMemories, forget, listMemories, recall, remember }, { buildSituationBrief }] = await Promise.all([
    import('./memory/long-term.js'),
    import('./tools/situational-awareness.tool.js'),
  ]);
  return { clearMemories, forget, listMemories, recall, remember, buildSituationBrief };
}

async function loadJobModules() {
  const [{ createJob, getJob, getJobLogs, listJobs }, { cancelJob, handleJobWebhook, runDueJobs, runJob }, { registerQStashSchedule }] = await Promise.all([
    import('./jobs/store.js'),
    import('./jobs/runner.js'),
    import('./jobs/qstash.js'),
  ]);
  return { createJob, getJob, getJobLogs, listJobs, cancelJob, handleJobWebhook, runDueJobs, runJob, registerQStashSchedule };
}

async function loadVoiceModules() {
  const [{ getVoiceConfig, startDeepgramVoiceAgentSession }] = await Promise.all([
    import('./voice/deepgram.js'),
  ]);
  return { getVoiceConfig, startDeepgramVoiceAgentSession };
}

export type { ConfirmationHandler, ConfirmationRequest, ProgressEvent };
export { clearSessionApprovals, applyStoredModelSelections };
export type { ZilMateVoiceConfig, ZilMateVoiceSessionOptions, ZilMateVoiceSessionResult };
export type { ImageGenerationOptions, ImageGenerationResult };
export type { LongTermMemory };
export type { CreateJobInput, JobLog, JobStatus, ListJobsOptions, ZilMateJob };

export type ZilMateAuditEvent = {
  requestId: string;
  sessionId: string;
  action: string;
  phase: 'start' | 'success' | 'error';
  status: 'ok' | 'error';
  timestamp: string;
  detail?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
};

export type ZilMateAuditHandler = (event: ZilMateAuditEvent) => void;

export type ZilMateOptions = {
  sessionId?: string;
  onProgress?: (event: ProgressEvent) => void;
  confirm?: ConfirmationHandler;
  onAudit?: ZilMateAuditHandler;
};

export type ZilMateTextInput = {
  message: string;
};

export type ZilMatePromptInput = {
  prompt: string;
};

export type ZilMateQuestionInput = {
  question: string;
};

export type ZilMateResearchInput = {
  query: string;
};

export type ZilMateMemoryInput = {
  text: string;
  tags?: string[];
};

export type ZilMateRecallInput = {
  query?: string;
  limit?: number;
};

export type ZilMateTextResult = {
  text: string;
};

export type ZilMateSubagentName = 'quickHelp' | 'chat' | 'post' | 'image' | 'research' | 'automationPlanner' | 'personalAssistant' | 'developerHelper' | 'security' | 'coding' | 'goalManager' | 'finance' | 'digitalCorporation' | (string & {});

export type ZilMateSubagentInput = {
  subagent: ZilMateSubagentName;
  prompt: string;
};

type TextAgentFactory = () => { generate: (input: { prompt: string; abortSignal?: AbortSignal }) => Promise<{ text: string }> } | Promise<{ generate: (input: { prompt: string; abortSignal?: AbortSignal }) => Promise<{ text: string }> }>;

async function runTextAgent(agentFactory: TextAgentFactory, prompt: string): Promise<ZilMateTextResult> {
  requireGatewayAuth();
  await applyStoredModelSelections();
  const result = await (await (agentFactory() as any)).generate({ prompt });
  return { text: result.text };
}

function createAuditEvent(sessionId: string, action: string, phase: ZilMateAuditEvent['phase'], status: ZilMateAuditEvent['status'], detail?: string | undefined, metadata?: Record<string, unknown> | undefined): ZilMateAuditEvent {
  return {
    requestId: randomUUID(),
    sessionId,
    action,
    phase,
    status,
    timestamp: new Date().toISOString(),
    ...(detail !== undefined ? { detail } : {}),
    ...(metadata !== undefined ? { metadata } : {}),
  };
}

async function runWithAudit<T>(sessionId: string, action: string, onAudit: ZilMateAuditHandler | undefined, run: () => Promise<T>, metadata?: Record<string, unknown>): Promise<T> {
  const requestId = randomUUID();
  const emit = (phase: ZilMateAuditEvent['phase'], status: ZilMateAuditEvent['status'], detail?: string) => {
    onAudit?.({
      requestId,
      sessionId,
      action,
      phase,
      status,
      timestamp: new Date().toISOString(),
      detail,
      metadata,
    });
  };

  emit('start', 'ok');
  try {
    const result = await run();
    emit('success', 'ok');
    return result;
  } catch (error) {
    emit('error', 'error', error instanceof Error ? error.message : String(error));
    throw error;
  }
}

export function resolveSubagentRoute(subagent: ZilMateSubagentName): 'specialist' | 'swarm' | 'manager' {
  if (subagent === 'digitalCorporation') return 'manager';
  if (subagent === 'chat' || subagent === 'coding' || subagent === 'image' || subagent === 'goalManager' || subagent === 'research' || subagent === 'post' || subagent === 'quickHelp' || subagent === 'automationPlanner' || subagent === 'personalAssistant' || subagent === 'developerHelper' || subagent === 'security' || subagent === 'finance') {
    return 'specialist';
  }
  return 'swarm';
}

async function runSubagentText(subagent: ZilMateSubagentName, prompt: string, sessionId: string): Promise<ZilMateTextResult> {
  requireGatewayAuth();
  await applyStoredModelSelections();
  const route = resolveSubagentRoute(subagent);

  if (route === 'swarm') {
    const { createSwarmSpecialist } = await import('./agents/swarm/registry.js');
    const specialist = createSwarmSpecialist(subagent);
    const result = await specialist.run(prompt);
    return { text: result };
  }

  const { createChatAgent, createCodingAgent, createImageAgent, createGoalManagerAgent, createDocsResearchAgent, createPostAgent, createQuickHelpAgent, createAutomationPlannerAgent, createPersonalAssistantAgent, createDeveloperHelperAgent, createSecurityAgent, createFinanceAgent } = await loadAgentModules();

  const factory = (() => {
    switch (subagent) {
      case 'chat': return createChatAgent();
      case 'coding': return createCodingAgent(sessionId);
      case 'image': return createImageAgent();
      case 'goalManager': return createGoalManagerAgent();
      case 'research': return createDocsResearchAgent(sessionId);
      case 'post': return createPostAgent();
      case 'quickHelp': return createQuickHelpAgent();
      case 'automationPlanner': return createAutomationPlannerAgent();
      case 'personalAssistant': return createPersonalAssistantAgent();
      case 'developerHelper': return createDeveloperHelperAgent(sessionId);
      case 'security': return createSecurityAgent(sessionId);
      case 'finance': return createFinanceAgent(sessionId);
      case 'digitalCorporation': return Promise.resolve({ generate: async ({ prompt }: { prompt: string }) => ({ text: `The digitalCorporation subagent is not exposed directly through this SDK entrypoint. Use the manager endpoint for swarm-based delegation. Prompt: ${prompt}` }) });
      default: return createChatAgent();
    }
  })();

  const result = await (await factory as any).generate({ prompt });
  return { text: result.text };
}

function managerOptions(sessionId: string, options: ZilMateOptions) {
  return {
    sessionId,
    ...(options.onProgress ? { progress: options.onProgress } : {}),
    ...(options.confirm ? { confirm: options.confirm } : {}),
  };
}

function getPrompt(input: ZilMateTextInput | ZilMatePromptInput | ZilMateQuestionInput | ZilMateResearchInput) {
  if ('message' in input) return input.message;
  if ('prompt' in input) return input.prompt;
  if ('question' in input) return input.question;
  return input.query;
}

export function createZilMate(options: ZilMateOptions = {}) {
  const sessionId = options.sessionId || 'default';
  const onAudit = options.onAudit;

  return {
    chat: async (input: ZilMateTextInput): Promise<ZilMateTextResult> => {
      return runWithAudit(sessionId, 'chat', onAudit, async () => {
        const { runManager } = await loadAgentModules();
        return { text: await runManager(input.message, managerOptions(sessionId, options)) };
      }, { input: 'message' });
    },

    manager: async (input: ZilMateTextInput | ZilMatePromptInput): Promise<ZilMateTextResult> => {
      return runWithAudit(sessionId, 'manager', onAudit, async () => {
        const { runManager } = await loadAgentModules();
        return { text: await runManager(getPrompt(input), managerOptions(sessionId, options)) };
      }, { input: 'prompt' });
    },

    help: async (input: ZilMateQuestionInput | ZilMateTextInput): Promise<ZilMateTextResult> => {
      return runWithAudit(sessionId, 'help', onAudit, async () => {
        const { createQuickHelpAgent } = await loadAgentModules();
        return runTextAgent(createQuickHelpAgent, getPrompt(input));
      }, { input: 'question' });
    },

    guide: async (input: ZilMateTextInput): Promise<ZilMateTextResult> => {
      return runWithAudit(sessionId, 'guide', onAudit, async () => {
        const { createChatAgent } = await loadAgentModules();
        return runTextAgent(createChatAgent, input.message);
      }, { input: 'message' });
    },

    post: async (input: ZilMatePromptInput): Promise<ZilMateTextResult> => {
      return runWithAudit(sessionId, 'post', onAudit, async () => {
        const { createPostAgent } = await loadAgentModules();
        return runTextAgent(createPostAgent, input.prompt);
      }, { input: 'prompt' });
    },

    research: async (input: ZilMateResearchInput | ZilMateTextInput): Promise<ZilMateTextResult> => {
      return runWithAudit(sessionId, 'research', onAudit, async () => {
        const { createDocsResearchAgent } = await loadAgentModules();
        return runTextAgent(createDocsResearchAgent, getPrompt(input));
      }, { input: 'query' });
    },

    coding: async (input: ZilMatePromptInput): Promise<ZilMateTextResult> => {
      return runWithAudit(sessionId, 'coding', onAudit, async () => {
        const { createCodingAgent } = await loadAgentModules();
        return runTextAgent(() => createCodingAgent(sessionId), input.prompt);
      }, { input: 'prompt' });
    },

    imageAgent: async (input: ZilMatePromptInput): Promise<ZilMateTextResult> => {
      return runWithAudit(sessionId, 'imageAgent', onAudit, async () => {
        const { createImageAgent } = await loadAgentModules();
        return runTextAgent(createImageAgent, input.prompt);
      }, { input: 'prompt' });
    },

    goalManager: async (input: ZilMatePromptInput): Promise<ZilMateTextResult> => {
      return runWithAudit(sessionId, 'goalManager', onAudit, async () => {
        const { createGoalManagerAgent } = await loadAgentModules();
        return runTextAgent(createGoalManagerAgent, input.prompt);
      }, { input: 'prompt' });
    },

    situation: async (input: { sessionId?: string } = {}) => {
      return runWithAudit(sessionId, 'situation', onAudit, async () => {
        const { buildSituationBrief } = await loadMemoryModules();
        return buildSituationBrief(input.sessionId || sessionId);
      }, { targetSessionId: input.sessionId || sessionId });
    },

    handoff: async (input: { sessionId?: string } = {}) => {
      return runWithAudit(sessionId, 'handoff', onAudit, async () => {
        const { loadSessionHandoff } = await import('./tools/session-continuity.tool.js');
        return loadSessionHandoff(input.sessionId || sessionId);
      }, { targetSessionId: input.sessionId || sessionId });
    },

    image: async (input: ZilMatePromptInput & ImageGenerationOptions): Promise<ImageGenerationResult> => {
      return runWithAudit(sessionId, 'image', onAudit, async () => {
        const { prompt, provider, size, outputDir } = input;
        const generateImageAsset = await loadGenerateImageModule();
        return generateImageAsset(prompt, { provider, size, outputDir });
      }, { provider: input.provider, size: input.size, outputDir: input.outputDir });
    },

    remember: async (input: ZilMateMemoryInput): Promise<LongTermMemory> => {
      return runWithAudit(sessionId, 'remember', onAudit, async () => {
        const { remember: rememberMemory } = await loadMemoryModules();
        return rememberMemory(input.text, input.tags ?? []);
      }, { tags: input.tags ?? [] });
    },

    recall: async (input: ZilMateRecallInput = {}): Promise<LongTermMemory[]> => {
      return runWithAudit(sessionId, 'recall', onAudit, async () => {
        const { recall: recallMemory } = await loadMemoryModules();
        return recallMemory(input.query ?? '', input.limit ?? 8);
      }, { query: input.query ?? '', limit: input.limit ?? 8 });
    },

    listMemories: async () => {
      return runWithAudit(sessionId, 'listMemories', onAudit, async () => {
        const { listMemories: list } = await loadMemoryModules();
        return list();
      });
    },
    forget: async (input: string | string[]) => {
      return runWithAudit(sessionId, 'forget', onAudit, async () => {
        const { forget: forgetMemory } = await loadMemoryModules();
        const id = Array.isArray(input) ? input[0] : input;
        return forgetMemory(id ?? '');
      }, { id: Array.isArray(input) ? input[0] : input });
    },
    clearMemories: async () => {
      return runWithAudit(sessionId, 'clearMemories', onAudit, async () => {
        const { clearMemories: clear } = await loadMemoryModules();
        return clear();
      });
    },

    createJob: async (input: CreateJobInput): Promise<ZilMateJob> => {
      return runWithAudit(sessionId, 'createJob', onAudit, async () => {
        const { createJob: createStoredJob, registerQStashSchedule } = await loadJobModules();
        return registerQStashSchedule(await createStoredJob(input));
      }, { jobTask: input.task });
    },

    listJobs: async (input: ListJobsOptions = {}): Promise<ZilMateJob[]> => {
      return runWithAudit(sessionId, 'listJobs', onAudit, async () => {
        const { listJobs: list } = await loadJobModules();
        return list(input);
      }, { status: input.status });
    },

    getJob: async (id: string): Promise<ZilMateJob | null> => {
      return runWithAudit(sessionId, 'getJob', onAudit, async () => {
        const { getJob: getStoredJob } = await loadJobModules();
        return getStoredJob(id);
      }, { jobId: id });
    },

    getJobLogs: async (id: string): Promise<JobLog[]> => {
      return runWithAudit(sessionId, 'getJobLogs', onAudit, async () => {
        const { getJobLogs: getLogs } = await loadJobModules();
        return getLogs(id);
      }, { jobId: id });
    },

    runJob: async (id: string): Promise<ZilMateJob> => {
      return runWithAudit(sessionId, 'runJob', onAudit, async () => {
        const { runJob: runStoredJob } = await loadJobModules();
        return runStoredJob(id);
      }, { jobId: id });
    },

    runDueJobs: async (): Promise<number> => {
      return runWithAudit(sessionId, 'runDueJobs', onAudit, async () => {
        const { runDueJobs: runJobsDue } = await loadJobModules();
        return runJobsDue();
      });
    },

    handleJobWebhook: async (input: { jobId: string; secret?: string }, expectedSecret?: string): Promise<ZilMateJob> => {
      return runWithAudit(sessionId, 'handleJobWebhook', onAudit, async () => {
        const { handleJobWebhook: handleWebhook } = await loadJobModules();
        return handleWebhook(input, expectedSecret);
      }, { jobId: input.jobId });
    },

    cancelJob: async (id: string): Promise<ZilMateJob | null> => {
      return runWithAudit(sessionId, 'cancelJob', onAudit, async () => {
        const { cancelJob: cancelStoredJob } = await loadJobModules();
        return cancelStoredJob(id);
      }, { jobId: id });
    },

    getVoiceConfig: async (): Promise<ZilMateVoiceConfig> => {
      return runWithAudit(sessionId, 'getVoiceConfig', onAudit, async () => {
        const { getVoiceConfig } = await loadVoiceModules();
        return getVoiceConfig();
      });
    },

    startVoiceSession: async (input: ZilMateVoiceSessionOptions = {}): Promise<ZilMateVoiceSessionResult> => {
      return runWithAudit(sessionId, 'startVoiceSession', onAudit, async () => {
        const { startDeepgramVoiceAgentSession } = await loadVoiceModules();
        const voiceOptions: ZilMateVoiceSessionOptions = {
          ...input,
          sessionId: input.sessionId || sessionId,
        };
        const onProgress = input.onProgress || options.onProgress;
        if (onProgress) voiceOptions.onProgress = onProgress;
        return startDeepgramVoiceAgentSession(voiceOptions);
      }, { sessionId: input.sessionId || sessionId });
    },

    callSubagent: async (input: ZilMateSubagentInput): Promise<ZilMateTextResult> => {
      return runWithAudit(sessionId, 'callSubagent', onAudit, async () => {
        return runSubagentText(input.subagent, input.prompt, sessionId);
      }, { subagent: input.subagent });
    },
  };
}

export async function chat(input: ZilMateTextInput, options: ZilMateOptions = {}) {
  return createZilMate(options).chat(input);
}

export async function help(input: ZilMateQuestionInput | ZilMateTextInput, options: ZilMateOptions = {}) {
  return createZilMate(options).help(input);
}

export async function post(input: ZilMatePromptInput, options: ZilMateOptions = {}) {
  return createZilMate(options).post(input);
}

export async function research(input: ZilMateResearchInput | ZilMateTextInput, options: ZilMateOptions = {}) {
  return createZilMate(options).research(input);
}

export async function image(input: ZilMatePromptInput & ImageGenerationOptions) {
  return createZilMate().image(input);
}

export async function callSubagent(input: ZilMateSubagentInput, options: ZilMateOptions = {}) {
  return createZilMate(options).callSubagent(input);
}
