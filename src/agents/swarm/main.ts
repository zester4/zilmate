import { type Tool, ToolLoopAgent, stepCountIs, tool } from 'ai';
import { z } from 'zod';
import { SwarmOrchestrator } from '../../runtime/swarm.js';
import { models } from '../../config/models.js';
import { limits } from '../../safety/limits.js';
import { createSwarmSpecialist } from './registry.js';
import { emitProgress } from '../../runtime/progress.js';
import { crossAppLedgerTools } from '../../tools/cross-app-ledger.tool.js';
import { swarmMemoryTools } from '../../tools/swarm-memory.tool.js';

export async function createDigitalCorporationMain(runId: string = 'default') {
  const orchestrator = SwarmOrchestrator.getInstance();

  return new ToolLoopAgent({
    model: models.manager,
    instructions: [
      'You are the Digital Corporation Main Agent, the Chief Operating Officer of the ZilMate Swarm.',
      'You manage a 3-tier hierarchy: CEO -> YOU (COO) -> 7 Department Heads -> 30 Specialists.',
      'Your core responsibility is to orchestrate the 7 Departmental Heads to run a real-world online business.',

      'MANAGEMENT PHILOSOPHY:',
      '1. MANAGE HEADS: Your primary interaction should be with Departmental Heads (e.g., CTO, CMO, CRO). Assign departmental goals to them.',
      '2. DELEGATE, DON’T DO: Do not micromanage specialists. Let the Heads handle their teams.',
      '3. INFORMATION SYNTHESIS: specialists have "Departmental Isolation." You act as the bridge. If the CTO needs data from the CMO, you fetch it and pass it across.',
      '4. GLOBAL MEMORY: Maintain the "Global Corporate Notebook" (sessionId: "default"). Promote only critical facts from departments.',
      '5. SUPER TOOLS: Use "visualBrowserAudit" for UI verification, "autonomousMarketResearch" for competitor deep-dives, and "executeAndSelfHeal" for engineering builds.',

      'DEPARTMENTAL DOMAINS & HEADS:',
      '- Strategy: Strategy Head (productManager, marketAnalyst, uxResearcher).',
      '- Engineering: CTO (architect, fullStackCoder, qaEngineer, devopsSre, creativeDirector).',
      '- Growth: CMO (growthHacker, seoExpert, contentWriter, socialMediaManager, adsManager).',
      '- Revenue: CRO (enterpriseSales, channelManager, affiliateManager, contractAnalyst, revOps).',
      '- Operations: Ops Head (financeAnalyst, customerSuccess, legalCounsel, logisticsLead, hrRecruiter).',
      '- Security: CISO (redTeam, blueTeam, complianceOfficer, iamArchitect, incidentResponse).',
      '- Data: CDO (dataScientist, biReporter).',

      'You have full authority to manage cross-departmental handoffs and ensure all Heads are aligned with business KPIs.',
    ].join('\n'),
    tools: {
      ...crossAppLedgerTools,
      ...swarmMemoryTools,
      delegateToSpecialist: tool({
        description: 'Delegate a business task to a specialized swarm agent or Departmental Head in the corporation.',
        inputSchema: z.object({
          task: z.string().min(10).describe('Detailed description of the task.'),
          agentKey: z.string().describe('The key of the specialist or Head to use (e.g., ctoEngineering, fullStackCoder, cmoGrowth).'),
        }),
        execute: async ({ task, agentKey }) => {
          emitProgress({ type: 'thinking', label: `COO delegating to ${agentKey}` });

          const specialist = createSwarmSpecialist(agentKey);
          const config = (specialist as any).config;
          const deptSessionId = `${runId}:${config.department.toLowerCase()}`;

          const result = await specialist.run(task, undefined, deptSessionId);

          return { agent: agentKey, department: config.department, scope: deptSessionId, report: result };
        },
      }),
      classifyAndDelegate: tool({
        description: 'Analyze a complex business objective and automatically route it to the best Department Head or specialist.',
        inputSchema: z.object({
          task: z.string().min(10).describe('The business objective (e.g., "Analyze why churn is increasing").'),
        }),
        execute: async ({ task }) => {
          emitProgress({ type: 'thinking', label: 'COO classifying objective' });
          const classification = await orchestrator.classifyTask(task);

          emitProgress({ type: 'step', label: `Objective routed to ${classification.subagent}`, detail: classification.reasoning });

          const specialist = createSwarmSpecialist(classification.subagent);
          const config = (specialist as any).config;
          const deptSessionId = `${runId}:${config.department.toLowerCase()}`;

          const result = await specialist.run(task, undefined, deptSessionId);

          return { agent: classification.subagent, department: classification.department, scope: deptSessionId, report: result };
        },
      }),
    },
    stopWhen: stepCountIs(limits.managerSteps),
  });
}
