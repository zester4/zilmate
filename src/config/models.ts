import { gateway } from 'ai';
import { env, type ImageProvider } from './env.js';

export type ModelRegistry = {
  manager: string;
  help: string;
  post: string;
  chat: string;
  research: string;
  coding: string;
  imageDefaultProvider: ImageProvider;
  imageOpenai: string;
  imageGemini: string;
  image: string;
  screenshotVision: string;
};

const cheapModelCandidates = [
  'openai/gpt-5.4-mini',
  'google/gemini-3-flash',
  'xai/grok-4.1-fast',
  'mistral/mistral-small-latest',
];

function pick(defaultValue: string, envKey: string, fallback?: string) {
  return process.env[envKey] || defaultValue || fallback || cheapModelCandidates[0]!;
}

export const models: ModelRegistry = {
  get manager() { return pick(env.managerModel, 'ZILO_MANAGER_MODEL'); },
  get help() { return pick(env.helpModel || cheapModelCandidates[0]!, 'ZILO_HELP_MODEL'); },
  get post() { return pick(env.postModel || cheapModelCandidates[0]!, 'ZILO_POST_MODEL'); },
  get chat() { return pick(env.helpModel || env.managerModel, 'ZILO_HELP_MODEL', env.managerModel); },
  get research() { return pick(env.managerModel, 'ZILO_MANAGER_MODEL'); },
  get coding() { return pick(env.codingModel || env.managerModel, 'ZILO_CODING_MODEL', env.managerModel); },
  get imageDefaultProvider() { return env.imageDefaultProvider; },
  get imageOpenai() { return pick(env.imageOpenaiModel, 'ZILO_IMAGE_OPENAI_MODEL'); },
  get imageGemini() { return pick(env.imageGeminiModel, 'ZILO_IMAGE_GEMINI_MODEL'); },
  get image() { return env.imageDefaultProvider === 'gemini' ? models.imageGemini : models.imageOpenai; },
  get screenshotVision() { return pick(env.screenshotVisionModel, 'ZILMATE_SCREENSHOT_MODEL'); },
};

export type ModelAvailability = {
  selected: ModelRegistry;
  availableIds: string[];
  missing: string[];
  warnings: string[];
};

export async function getModelAvailability(): Promise<ModelAvailability> {
  const result = await gateway.getAvailableModels();
  const rawModels = Array.isArray(result) ? result : ((result as { models?: unknown[] }).models || []);
  const availableIds = rawModels
    .map((model) => typeof model === 'string' ? model : (model as { id?: string }).id)
    .filter((id): id is string => Boolean(id));

  const selected = Object.entries(models)
    .filter(([key]) => key !== 'imageDefaultProvider')
    .map(([, value]) => value);
  const missing = selected.filter((id, index) => selected.indexOf(id) === index && !availableIds.includes(id));
  const warnings = missing.map((id) => `Configured model not reported by Gateway: ${id}`);

  return { selected: models, availableIds, missing, warnings };
}

export function pickAvailableTextModel(availableIds: string[], preferred?: string) {
  if (preferred && availableIds.includes(preferred)) return preferred;
  return cheapModelCandidates.find((id) => availableIds.includes(id)) || preferred || models.help;
}
