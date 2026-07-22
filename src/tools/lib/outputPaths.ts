// src/tools/lib/outputPaths.ts
import { mkdir, rename, unlink, access, stat } from 'node:fs/promises';
import { writeFile as fsWriteFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export class ToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolInputError';
  }
}

/**
 * All generated deliverables land under a single root so the archive tool,
 * cleanup jobs, and any "list my outputs" tool can find them consistently.
 * Override with OUTPUT_ROOT env var if you already have a convention.
 */
export const OUTPUT_ROOT = process.env.OUTPUT_ROOT ?? path.resolve(process.cwd(), 'workspace', 'outputs');

function sanitizeFilename(name: string): string {
  return name
    .trim()
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, '_')
    .slice(0, 150);
}

function timestampSuffix(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/**
 * Resolves a safe absolute path under OUTPUT_ROOT for a given logical
 * filename, creating the directory if needed. If `unique` is true (default),
 * appends a timestamp to avoid clobbering prior runs.
 */
export async function resolveOutputPath(
  filename: string,
  opts: { subdir?: string; unique?: boolean } = {},
): Promise<{ absPath: string; relPath: string }> {
  const { subdir, unique = true } = opts;
  const dir = subdir ? path.join(OUTPUT_ROOT, subdir) : OUTPUT_ROOT;
  await mkdir(dir, { recursive: true });

  const ext = path.extname(filename);
  const base = sanitizeFilename(path.basename(filename, ext));
  const finalName = unique ? `${base}_${timestampSuffix()}${ext}` : `${base}${ext}`;

  const absPath = path.join(dir, finalName);
  const relPath = path.relative(process.cwd(), absPath);
  return { absPath, relPath };
}

/**
 * Writes to a temp file in the same directory then renames into place, so a
 * crash or concurrent read never observes a half-written deliverable.
 */
export async function atomicWriteFile(absPath: string, data: Buffer | string): Promise<void> {
  const tmpPath = path.join(path.dirname(absPath), `.tmp-${randomUUID()}-${path.basename(absPath)}`);
  try {
    await fsWriteFile(tmpPath, data);
    await rename(tmpPath, absPath);
  } catch (err) {
    await unlink(tmpPath).catch(() => {});
    throw err;
  }
}

const MAX_INPUT_FILE_BYTES = 50 * 1024 * 1024; // 50MB guard against runaway reads

/**
 * Validates an input file exists, is a regular file, and isn't absurdly
 * large, before any tool tries to parse/embed it. Throws ToolInputError with
 * a message safe to surface back to the model/user.
 */
export async function assertReadableFile(filePath: string, opts: { maxBytes?: number; label?: string } = {}): Promise<number> {
  const { maxBytes = MAX_INPUT_FILE_BYTES, label = 'file' } = opts;
  try {
    await access(filePath);
  } catch {
    throw new ToolInputError(`Could not find ${label} at path: ${filePath}`);
  }
  const st = await stat(filePath);
  if (!st.isFile()) {
    throw new ToolInputError(`Path is not a regular file: ${filePath}`);
  }
  if (st.size === 0) {
    throw new ToolInputError(`${label} at ${filePath} is empty`);
  }
  if (st.size > maxBytes) {
    throw new ToolInputError(
      `${label} at ${filePath} is ${(st.size / 1024 / 1024).toFixed(1)}MB, exceeding the ${(maxBytes / 1024 / 1024).toFixed(0)}MB limit`,
    );
  }
  return st.size;
}

/** Wraps a tool's execute body so failures return a structured, model-readable result instead of an opaque throw/crash. */
export async function safeExecute<T>(fn: () => Promise<T>): Promise<{ success: true } & T | { success: false; error: string }> {
  try {
    const result = await fn();
    return { success: true, ...result };
  } catch (err) {
    const message = err instanceof ToolInputError ? err.message : err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}