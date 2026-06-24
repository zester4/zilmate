import { getModelAvailability, models } from '../config/models.js';
import { saveModelSelection, roleLabels, type ModelRole } from '../config/model-store.js';
import { printPanel, printTable } from './format.js';
import { selectOne } from './prompt.js';
import { theme } from './theme.js';

export type ModelListOptions = {
  provider?: string;
  limit?: string | number;
  page?: string | number;
};

function parsePositiveInt(value: string | number | undefined, fallback: number) {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function providerOf(modelId: string) {
  return modelId.includes('/') ? modelId.split('/')[0]! : 'unknown';
}

function modelFamily(modelId: string) {
  const [, name = modelId] = modelId.split('/', 2);
  if (/gemini/i.test(modelId)) return 'Gemini';
  if (/gpt|o\d|chatgpt/i.test(modelId)) return 'OpenAI';
  if (/claude/i.test(modelId)) return 'Claude';
  if (/grok/i.test(modelId)) return 'Grok';
  if (/mistral|mixtral/i.test(modelId)) return 'Mistral';
  if (/qwen/i.test(modelId)) return 'Qwen';
  return name.split('-')[0]?.toUpperCase() || 'Model';
}

function roleForModel(modelId: string) {
  const selected = Object.entries(models)
    .filter(([key, value]) => !['imageDefaultProvider', 'image'].includes(key) && value === modelId)
    .map(([key]) => key);
  return selected.length ? selected.join(', ') : '-';
}

function filterModels(ids: string[], query?: string) {
  const q = query?.toLowerCase().trim();
  if (!q) return ids;
  return ids.filter((id) => id.toLowerCase().includes(q) || providerOf(id).toLowerCase() === q);
}

function currentModelForRole(role: ModelRole): string {
  const val = models[role as keyof typeof models];
  return typeof val === 'string' ? val : 'unknown';
}

export async function printModelBrowser(options: ModelListOptions = {}) {
  const availability = await getModelAvailability();
  const limit = parsePositiveInt(options.limit, 20);
  const page = parsePositiveInt(options.page, 1);
  const filtered = filterModels(availability.availableIds, options.provider);
  const start = (page - 1) * limit;
  const items = filtered.slice(start, start + limit);
  const totalPages = Math.max(1, Math.ceil(filtered.length / limit));

  printPanel('AI Gateway Models', [
    ['Filter', options.provider || 'all'],
    ['Showing', `${items.length} of ${filtered.length}`],
    ['Page', `${Math.min(page, totalPages)} / ${totalPages}`],
    ['Manager', models.manager],
    ['Coding', models.coding],
    ['Image', models.image],
  ]);

  printTable(
    ['#', 'Provider', 'Family', 'Model', 'Used For'],
    items.map((id, index) => [
      String(start + index + 1),
      providerOf(id),
      modelFamily(id),
      id,
      roleForModel(id),
    ]),
  );

  console.log(theme.muted('Use /model pick for interactive role assignment.'));
  if (totalPages > page) {
    console.log(theme.muted(`Next: /model next or /model ${options.provider || ''}`.trim()));
  }
  if (availability.warnings.length) {
    printTable(['Warning'], availability.warnings.map((warning) => [warning]));
  }

  return { page, limit, total: filtered.length, totalPages, provider: options.provider || 'all' };
}

export async function runModelPicker(query?: string) {
  const availability = await getModelAvailability();

  // 1. Filter models if a query (provider name) was provided
  const availableIds = filterModels(availability.availableIds, query);

  if (availableIds.length === 0) {
    console.log(theme.error(`No models found matching "${query}"`));
    return null;
  }

  // 2. Choose Role
  const roleChoice = await selectOne('Choose which agent role to configure', roleLabels().map((item) => ({
    id: item.role,
    label: item.label,
    description: `Current: ${currentModelForRole(item.role)}`,
  })), 0);

  if (!roleChoice) {
    console.log(theme.muted('Model selection cancelled.'));
    return null;
  }

  // 3. Choose Model (with pagination support automatically from prompt.ts)
  const modelChoice = await selectOne(
    `Choose a model for ${roleChoice.label}${query ? ` (Filtered by ${query})` : ''}`,
    availableIds.map((id) => ({
      id,
      label: id,
      description: modelFamily(id),
    })),
    Math.max(0, availableIds.findIndex((id) => id === currentModelForRole(roleChoice.id as ModelRole))),
    15 // Page size
  );

  if (!modelChoice) {
    console.log(theme.muted('Model selection cancelled.'));
    return null;
  }

  await saveModelSelection(roleChoice.id as ModelRole, modelChoice.id);

  printPanel('Model updated', [
    ['Role', roleChoice.label],
    ['Model', modelChoice.id],
    ['Tip', 'Selection saved to workspace config and applied for this session'],
  ]);

  return { role: roleChoice.id, model: modelChoice.id };
}
