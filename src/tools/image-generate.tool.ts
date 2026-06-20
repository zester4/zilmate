import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { generateImage, generateText, tool, type DataContent } from 'ai';
import { z } from 'zod';
import { models } from '../config/models.js';
import { getOutputDir } from '../workspace/output-paths.js';
import { requireGatewayAuth, type ImageProvider } from '../config/env.js';
import { redactSensitiveText } from '../safety/redaction.js';
import { emitProgress } from '../runtime/progress.js';

export type ImageProviderInput = ImageProvider | 'chatgpt' | 'google' | 'default';
export type ImageSize = `${number}x${number}`;
type ImagePromptInput = DataContent;

export type ImageGenerationOptions = {
  provider?: ImageProviderInput | undefined;
  size?: ImageSize | undefined;
  outputDir?: string | undefined;
  imagePaths?: string[] | undefined;
  imageUrls?: string[] | undefined;
  maskPath?: string | undefined;
  maskUrl?: string | undefined;
};

export type ImageGenerationResult = {
  text?: string;
  files: string[];
  model: string;
  provider: ImageProvider;
  operation: 'generate' | 'edit';
  inputImages?: string[];
};

type LoadedImageInputs = {
  images: ImagePromptInput[];
  sources: string[];
  mask?: ImagePromptInput;
};

export function isImageSize(value: string | undefined): value is ImageSize {
  return /^\d+x\d+$/.test(value || '');
}

function normalizeProvider(provider: ImageProviderInput | undefined): ImageProvider {
  const value = (provider || models.imageDefaultProvider || 'openai').toLowerCase().trim();
  if (value === 'default') return models.imageDefaultProvider;
  if (value === 'chatgpt' || value === 'openai') return 'openai';
  if (value === 'google' || value === 'gemini') return 'gemini';
  throw new Error(`Unsupported image provider: ${provider}. Use openai, chatgpt, or gemini.`);
}

function extensionFromMediaType(mediaType: string | undefined) {
  const value = mediaType?.split('/')[1]?.split(';')[0];
  if (!value) return 'png';
  if (value === 'jpeg') return 'jpg';
  return value;
}

function toBuffer(data: Uint8Array | ArrayBuffer | Buffer | string) {
  if (typeof data === 'string') return Buffer.from(data, 'base64');
  if (data instanceof ArrayBuffer) return Buffer.from(new Uint8Array(data));
  return Buffer.from(data);
}

async function saveImageBytes(data: Uint8Array | ArrayBuffer | Buffer | string, mediaType: string | undefined, outputDir: string, index: number) {
  const extension = extensionFromMediaType(mediaType);
  const filename = `zilo-image-${Date.now()}-${index}.${extension}`;
  const target = path.join(outputDir, filename);
  await writeFile(target, toBuffer(data));
  return target;
}

function isHttpUrl(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

async function loadRemoteImage(url: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not load image URL ${url}: ${response.status} ${response.statusText}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

async function loadImageReference(reference: string): Promise<ImagePromptInput> {
  if (isHttpUrl(reference)) return loadRemoteImage(reference);
  return readFile(path.resolve(reference));
}

async function loadEditInputs(options: ImageGenerationOptions): Promise<LoadedImageInputs | undefined> {
  const imageSources = [...(options.imagePaths || []), ...(options.imageUrls || [])].filter(Boolean);
  const maskSource = options.maskPath || options.maskUrl;
  if (imageSources.length === 0 && !maskSource) return undefined;
  if (imageSources.length === 0) {
    throw new Error('Image editing needs at least one input image. Provide imagePaths or imageUrls.');
  }

  emitProgress({ type: 'tool:start', label: 'Loading input image references', detail: `${imageSources.length} image${imageSources.length === 1 ? '' : 's'}` });
  const loaded: LoadedImageInputs = { images: [], sources: [...imageSources] };
  for (const source of imageSources) {
    loaded.images.push(await loadImageReference(source));
  }
  if (maskSource) {
    loaded.mask = await loadImageReference(maskSource);
    loaded.sources.push(`mask:${maskSource}`);
  }

  emitProgress({ type: 'tool:end', label: 'Input images loaded', detail: `${loaded.images.length} image${loaded.images.length === 1 ? '' : 's'}` });
  return loaded;
}

function buildImagePrompt(prompt: string, inputs?: LoadedImageInputs): string | { images: DataContent[]; text?: string; mask?: DataContent } {
  const text = redactSensitiveText(prompt);
  if (!inputs) return text;
  return {
    text,
    images: inputs.images,
    ...(inputs.mask ? { mask: inputs.mask } : {}),
  };
}

async function saveGeneratedImages(result: Awaited<ReturnType<typeof generateImage>>, outputDir: string) {
  const saved: string[] = [];
  for (const [index, image] of result.images.entries()) {
    const value = image as unknown as { uint8Array?: Uint8Array; data?: Uint8Array | ArrayBuffer | string; base64?: string; mediaType?: string };
    const data = value.uint8Array || value.data || value.base64;
    if (!data) continue;
    saved.push(await saveImageBytes(data, value.mediaType || image.mediaType, outputDir, index));
  }
  return saved;
}

async function generateOpenAiImage(prompt: string, outputDir: string, size?: ImageSize, inputs?: LoadedImageInputs): Promise<ImageGenerationResult> {
  const model = models.imageOpenai;
  const operation = inputs ? 'edit' : 'generate';
  emitProgress({ type: 'tool:start', label: `${operation === 'edit' ? 'Editing' : 'Generating'} OpenAI image`, detail: model });
  const result = await generateImage({
    model,
    prompt: buildImagePrompt(prompt, inputs),
    ...(size ? { size } : {}),
    providerOptions: {
      gateway: {
        tags: ['zilo-manager', `feature:image-${operation}`, 'model:openai'],
      },
    },
  });

  const saved = await saveGeneratedImages(result, outputDir);
  emitProgress({ type: 'tool:end', label: `OpenAI image ${operation} complete`, detail: `${saved.length} file${saved.length === 1 ? '' : 's'}` });
  return {
    files: saved,
    model,
    provider: 'openai',
    operation,
    ...(inputs?.sources.length ? { inputImages: inputs.sources } : {}),
  };
}

async function generateGeminiImage(prompt: string, outputDir: string, size?: ImageSize, inputs?: LoadedImageInputs): Promise<ImageGenerationResult> {
  const model = models.imageGemini;
  if (inputs) {
    emitProgress({ type: 'tool:start', label: 'Editing Gemini image', detail: model });
    const result = await generateImage({
      model,
      prompt: buildImagePrompt(prompt, inputs),
      ...(size ? { size } : {}),
      providerOptions: {
        gateway: {
          tags: ['zilo-manager', 'feature:image-edit', 'model:gemini'],
        },
      },
    });

    const saved = await saveGeneratedImages(result, outputDir);
    emitProgress({ type: 'tool:end', label: 'Gemini image edit complete', detail: `${saved.length} file${saved.length === 1 ? '' : 's'}` });
    return {
      files: saved,
      model,
      provider: 'gemini',
      operation: 'edit',
      inputImages: inputs.sources,
    };
  }

  emitProgress({ type: 'tool:start', label: 'Generating Gemini image', detail: model });
  const result = await generateText({
    model,
    prompt: redactSensitiveText(prompt),
    providerOptions: {
      gateway: {
        tags: ['zilo-manager', 'feature:image-generate', 'model:gemini'],
      },
    },
  });

  const files = (result.files || []).filter((file) => file.mediaType?.startsWith('image/'));
  const saved: string[] = [];
  for (const [index, file] of files.entries()) {
    const value = file as unknown as { uint8Array?: Uint8Array; data?: Uint8Array | ArrayBuffer | string; base64?: string; mediaType?: string };
    const data = value.uint8Array || value.data || value.base64;
    if (!data) continue;
    saved.push(await saveImageBytes(data, value.mediaType || file.mediaType, outputDir, index));
  }

  emitProgress({ type: 'tool:end', label: 'Gemini image generation complete', detail: `${saved.length} file${saved.length === 1 ? '' : 's'}` });
  return { text: result.text, files: saved, model, provider: 'gemini', operation: 'generate' };
}

export async function generateImageAsset(prompt: string, options: ImageGenerationOptions = {}): Promise<ImageGenerationResult> {
  requireGatewayAuth();
  const outputDir = options.outputDir || getOutputDir('images');
  await mkdir(outputDir, { recursive: true });
  const provider = normalizeProvider(options.provider);
  const inputs = await loadEditInputs(options);
  if (provider === 'gemini') return generateGeminiImage(prompt, outputDir, options.size, inputs);
  return generateOpenAiImage(prompt, outputDir, options.size, inputs);
}

export const imageGenerateTool = tool({
  description: 'Generate or edit high-quality images with OpenAI GPT Image 2 or Gemini image models. Accepts local image paths, image URLs, and optional masks, then saves outputs locally.',
  inputSchema: z.object({
    prompt: z.string().min(5),
    provider: z.enum(['openai', 'chatgpt', 'gemini', 'google', 'default']).optional(),
    size: z.string().regex(/^\d+x\d+$/).optional(),
    imagePaths: z.array(z.string().min(1)).optional().describe('Local image file paths to edit or use as visual references.'),
    imageUrls: z.array(z.string().url()).optional().describe('Remote image URLs to edit or use as visual references.'),
    maskPath: z.string().min(1).optional().describe('Optional local mask image path for masked edits. Requires at least one input image.'),
    maskUrl: z.string().url().optional().describe('Optional mask image URL for masked edits. Requires at least one input image.'),
  }),
  execute: async ({ prompt, provider, size, imagePaths, imageUrls, maskPath, maskUrl }) => generateImageAsset(prompt, {
    ...(provider ? { provider } : {}),
    ...(isImageSize(size) ? { size } : {}),
    ...(imagePaths?.length ? { imagePaths } : {}),
    ...(imageUrls?.length ? { imageUrls } : {}),
    ...(maskPath ? { maskPath } : {}),
    ...(maskUrl ? { maskUrl } : {}),
  }),
});
