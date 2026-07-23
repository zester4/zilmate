// src/tools/lib/image-utils.ts
// Shared utility for resolving image inputs across docx, pptx, html-report tools.
// Supports local file paths, remote URLs, and AI-generated images via generateImageAsset.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { getOutputDir } from '../../workspace/output-paths.js';
import { generateImageAsset } from '../image-generate.tool.js';
import { ToolInputError } from './outputPaths.js';

export type ImageInput = {
  path?: string | undefined;
  url?: string | undefined;
  generate?: string | undefined;
  provider?: 'openai' | 'chatgpt' | 'gemini' | 'google' | 'default' | undefined;
  size?: string | undefined;
};

export type ResolvedImage = {
  buffer: Buffer;
  extension: string;
  mimeType: string;
  sourcePath?: string;
  width?: number;
  height?: number;
};

function getMimeType(ext: string): string {
  const map: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
  };
  return map[ext.toLowerCase()] ?? 'image/png';
}

/**
 * Given an ImageInput (path, url, or generate), resolves it to a buffer,
 * extension, and mime type. Handles reading local files, fetching remote URLs,
 * and calling the AI image generation pipeline.
 */
export async function resolveImage(input: ImageInput, label = 'image'): Promise<ResolvedImage> {
  // 1. AI-generated image
  if (input.generate) {
    const provider = input.provider ?? 'default';
    const result = await generateImageAsset(input.generate, {
      provider: provider as any,
      ...(input.size ? { size: input.size as any } : {}),
      outputDir: getOutputDir('images'),
    });
    if (result.files.length === 0) {
      throw new ToolInputError(`AI image generation returned no files for ${label}.`);
    }
    const filePath = result.files[0]!;
    const ext = path.extname(filePath).replace('.', '') || 'png';
    const buffer = await readFile(filePath);
    return {
      buffer,
      extension: ext,
      mimeType: getMimeType(ext),
      sourcePath: filePath,
    };
  }

  // 2. Remote URL
  if (input.url) {
    const response = await fetch(input.url);
    if (!response.ok) {
      throw new ToolInputError(`Failed to fetch image URL "${input.url}": ${response.status} ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const contentType = response.headers.get('content-type') ?? 'image/png';
    const ext = contentType.split('/')[1]?.split(';')[0] ?? 'png';
    return { buffer, extension: ext, mimeType: contentType };
  }

  // 3. Local file path (existing behaviour)
  if (input.path) {
    const buffer = await readFile(path.resolve(input.path));
    const ext = path.extname(input.path).replace('.', '') || 'png';
    return {
      buffer,
      extension: ext,
      mimeType: getMimeType(ext),
      sourcePath: input.path,
    };
  }

  throw new ToolInputError(`No image source provided for ${label}. Provide path, url, or generate.`);
}

/**
 * Returns a base64 data URI string for embedding directly in HTML.
 */
export function imageToBase64(buffer: Buffer, mimeType: string): string {
  return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

/**
 * Escapes special HTML characters in a string.
 */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&', '<': '<', '>': '>', '"': '"', "'": '&#39;' })[c]!,
  );
}

/**
 * Slugify a string for use as an HTML anchor id.
 */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}