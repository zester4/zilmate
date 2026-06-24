import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { workspaceLayout } from '../workspace/paths.js';

export type ModelRole =
  | 'manager'
  | 'coding'
  | 'help'
  | 'post'
  | 'research'
  | 'chat'
  | 'imageOpenai'
  | 'imageGemini'
  | 'screenshotVision'
  | 'deptStrategy'
  | 'deptEngineering'
  | 'deptGrowth'
  | 'deptOperations'
  | 'deptData'
  | 'deptSecurity'
  | 'deptRevenue';

export type ModelSelectionStore = {
  roles: Partial<Record<ModelRole, string>>;
  updatedAt: string;
};

const roleEnvMap: Record<ModelRole, string> = {
  manager: 'ZILO_MANAGER_MODEL',
  coding: 'ZILO_CODING_MODEL',
  help: 'ZILO_HELP_MODEL',
  post: 'ZILO_POST_MODEL',
  research: 'ZILO_MANAGER_MODEL',
  chat: 'ZILO_HELP_MODEL',
  imageOpenai: 'ZILO_IMAGE_OPENAI_MODEL',
  imageGemini: 'ZILO_IMAGE_GEMINI_MODEL',
  screenshotVision: 'ZILMATE_SCREENSHOT_MODEL',
  deptStrategy: 'ZILMATE_DEPT_STRATEGY_MODEL',
  deptEngineering: 'ZILMATE_DEPT_ENGINEERING_MODEL',
  deptGrowth: 'ZILMATE_DEPT_GROWTH_MODEL',
  deptOperations: 'ZILMATE_DEPT_OPERATIONS_MODEL',
  deptData: 'ZILMATE_DEPT_DATA_MODEL',
  deptSecurity: 'ZILMATE_DEPT_SECURITY_MODEL',
  deptRevenue: 'ZILMATE_DEPT_REVENUE_MODEL',
};

function storePath() {
  return path.join(workspaceLayout().config, 'models.json');
}

export async function loadModelSelections(): Promise<ModelSelectionStore> {
  const file = storePath();
  if (!existsSync(file)) return { roles: {}, updatedAt: new Date().toISOString() };
  try {
    return JSON.parse(await readFile(file, 'utf8')) as ModelSelectionStore;
  } catch {
    return { roles: {}, updatedAt: new Date().toISOString() };
  }
}

export async function saveModelSelection(role: ModelRole, modelId: string) {
  const current = await loadModelSelections();
  current.roles[role] = modelId;
  current.updatedAt = new Date().toISOString();
  await mkdir(path.dirname(storePath()), { recursive: true });
  await writeFile(storePath(), JSON.stringify(current, null, 2), 'utf8');
  process.env[roleEnvMap[role]] = modelId;
  return current;
}

export async function applyStoredModelSelections() {
  const store = await loadModelSelections();
  for (const [role, modelId] of Object.entries(store.roles)) {
    if (!modelId) continue;
    process.env[roleEnvMap[role as ModelRole]] = modelId;
  }
  return store;
}

export function roleLabels(): Array<{ role: ModelRole; label: string; envKey: string }> {
  return [
    { role: 'manager', label: 'Main manager agent', envKey: roleEnvMap.manager },
    { role: 'coding', label: 'Coding agent + sub-coders', envKey: roleEnvMap.coding },
    { role: 'help', label: 'Quick help / chat', envKey: roleEnvMap.help },
    { role: 'research', label: 'Research agent', envKey: roleEnvMap.research },
    { role: 'imageOpenai', label: 'OpenAI image model', envKey: roleEnvMap.imageOpenai },
    { role: 'imageGemini', label: 'Gemini image model', envKey: roleEnvMap.imageGemini },
    { role: 'screenshotVision', label: 'Screenshot / vision', envKey: roleEnvMap.screenshotVision },
    { role: 'deptStrategy', label: 'Strategy Department', envKey: roleEnvMap.deptStrategy },
    { role: 'deptEngineering', label: 'Engineering Department', envKey: roleEnvMap.deptEngineering },
    { role: 'deptGrowth', label: 'Growth Department', envKey: roleEnvMap.deptGrowth },
    { role: 'deptOperations', label: 'Operations Department', envKey: roleEnvMap.deptOperations },
    { role: 'deptData', label: 'Data Department', envKey: roleEnvMap.deptData },
    { role: 'deptSecurity', label: 'Security Department', envKey: roleEnvMap.deptSecurity },
    { role: 'deptRevenue', label: 'Revenue Department', envKey: roleEnvMap.deptRevenue },
  ];
}
