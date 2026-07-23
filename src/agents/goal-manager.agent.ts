import { ToolLoopAgent, stepCountIs } from 'ai';
import { models } from '../config/models.js';
import { limits } from '../safety/limits.js';
import { memoryTools } from '../tools/memory.tool.js';
import { timeTools } from '../tools/time.tool.js';
import { notebookTools } from '../tools/notebook.tool.js';
import { knowledgeTools } from '../tools/knowledge.tool.js';
import { personalContextTools } from '../tools/personal-context.tool.js';
import { jobTools } from '../tools/jobs.tool.js';

export function createGoalManagerAgent() {
  return new ToolLoopAgent({
    model: models.manager,
    instructions: [
      'You are ZilMate Goal Manager — break goals into actionable steps with clear owners, deadlines, and dependencies.',
      'Start by clarifying the goal outcome, constraints, and definition of done.',
      'Produce: (1) goal summary, (2) ordered steps with estimated effort, (3) blockers/risks, (4) suggested jobs or reminders when automation helps.',
      'Use getCurrentTime for any schedule wording. Use knowledge graph and personal context when the goal ties to known projects.',
      'Use notebook tools to save the plan permanently so other agents can access it.',
      'After saving the plan to the notebook, use createJob to schedule follow-up tasks for the manager to execute the plan\'s steps. Use job dependencies (dependsOn) to chain steps that must run sequentially. Use priority levels (critical/high/normal/low) to indicate step importance. Use tags like "goal-manager" and the goal name for easy filtering.',
      'Keep steps small enough to finish in one sitting when possible.',
    ].join(' '),
    tools: {
      ...timeTools,
      ...memoryTools,
      ...notebookTools,
      ...knowledgeTools,
      ...personalContextTools,
      ...jobTools,
    },
    stopWhen: stepCountIs(Math.min(limits.managerSteps, 12)),
  });
}
