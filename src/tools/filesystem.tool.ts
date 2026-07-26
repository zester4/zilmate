import { tool } from 'ai';
import { z } from 'zod';
import { copyFile, mkdir, readdir, readFile, rename, stat, unlink, writeFile, chmod, symlink, readlink, access, cp, rm } from 'node:fs/promises';
import { existsSync, constants as fsConstants } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { emitProgress } from '../runtime/progress.js';
import { requestConfirmation } from '../runtime/confirm.js';
import { readJson, writeJson } from '../memory/local-store.js';

const execFileAsync = promisify(execFile);

type FileSnapshot = Record<string, { size: number; modifiedAt: number; type: 'file' | 'directory' }>;

const watchFile = 'filesystem-watch.json';
const defaultMaxReadBytes = 180_000;
const ignoredDirectoryNames = new Set(['.git', 'node_modules', 'dist', '.next', '.npm-cache', '.zilo-manager']);
const sensitiveNamePattern = /(^\\.env(?:\\..*)?$|\\.pem$|\\.key$|\\.p12$|\\.pfx$|id_rsa|id_dsa|credentials|secrets?|token)/i;

function allowedRoots() {
  const configured = (process.env.ZILMATE_FILE_ROOTS || '')
    .split(path.delimiter)
    .map((item) => item.trim())
    .filter(Boolean);
  return [process.cwd(), ...configured].map((root) => path.resolve(root));
}

function insideRoot(resolved: string, root: string) {
  return resolved === root || resolved.startsWith(`${root}${path.sep}`);
}

function assertSafePath(inputPath: string, options: { allowSensitive?: boolean } = {}) {
  const resolved = path.resolve(inputPath);
  const roots = allowedRoots();
  if (!roots.some((root) => insideRoot(resolved, root))) {
    throw new Error(`Path is outside allowed ZilMate file roots: ${resolved}`);
  }

  const parts = resolved.split(/[\\/]/);
  if (parts.some((part) => ignoredDirectoryNames.has(part))) {
    throw new Error(`Path is inside an ignored directory: ${resolved}`);
  }

  if (!options.allowSensitive && parts.some((part) => sensitiveNamePattern.test(part))) {
    throw new Error(`Path looks sensitive and cannot be accessed by file tools: ${resolved}`);
  }

  return resolved;
}

function relativeDisplay(resolved: string) {
  const root = allowedRoots().find((item) => insideRoot(resolved, item));
  return root ? path.relative(root, resolved) || '.' : resolved;
}

async function walk(rootPath: string, options: { maxDepth?: number; maxEntries?: number } = {}) {
  const maxDepth = options.maxDepth ?? 4;
  const maxEntries = options.maxEntries ?? 200;
  const results: Array<{ path: string; absolutePath: string; type: 'file' | 'directory'; size: number; modifiedAt: string }> = [];

  async function visit(current: string, depth: number) {
    if (results.length >= maxEntries) return;
    const info = await stat(current);
    const type = info.isDirectory() ? 'directory' : 'file';
    results.push({
      path: relativeDisplay(current),
      absolutePath: current,
      type,
      size: info.size,
      modifiedAt: info.mtime.toISOString(),
    });

    if (!info.isDirectory() || depth >= maxDepth) return;
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (results.length >= maxEntries) return;
      if (ignoredDirectoryNames.has(entry.name) || sensitiveNamePattern.test(entry.name)) continue;
      await visit(path.join(current, entry.name), depth + 1);
    }
  }

  await visit(rootPath, 0);
  return results;
}

async function snapshot(rootPath: string, maxDepth = 4) {
  const entries = await walk(rootPath, { maxDepth, maxEntries: 1000 });
  return Object.fromEntries(entries.map((entry) => [
    entry.path,
    {
      size: entry.size,
      modifiedAt: new Date(entry.modifiedAt).getTime(),
      type: entry.type,
    },
  ])) as FileSnapshot;
}

function summarizeText(content: string) {
  const cleaned = content.replace(/\s+/g, ' ').trim();
  const sentences = cleaned.match(/[^.!?\n]+[.!?]?/g) ?? [];
  const preview = sentences.slice(0, 8).join(' ').slice(0, 2400);
  const words = cleaned ? cleaned.split(/\s+/).length : 0;
  return {
    characters: content.length,
    words,
    summary: preview || cleaned.slice(0, 1200),
  };
}

function buildTreeLines(entries: Array<{ path: string; type: string }>, prefix = ''): string[] {
  // Group by top-level segment only
  const byParent = new Map<string, typeof entries>();
  for (const e of entries) {
    const parts = e.path.split(/[\\/]/);
    const parent = parts.slice(0, -1).join('/') || '';
    if (!byParent.has(parent)) byParent.set(parent, []);
    byParent.get(parent)!.push(e);
  }

  const lines: string[] = [];
  function render(parentPath: string, indent: string) {
    const children = byParent.get(parentPath) ?? [];
    children.forEach((child, i) => {
      const isLast = i === children.length - 1;
      const connector = isLast ? '└── ' : '├── ';
      const name = child.path.split(/[\\/]/).pop()!;
      const suffix = child.type === 'directory' ? '/' : '';
      lines.push(`${indent}${connector}${name}${suffix}`);
      if (child.type === 'directory') {
        render(child.path, indent + (isLast ? '    ' : '│   '));
      }
    });
  }
  render('', prefix);
  return lines;
}

export const fileSystemTools = {
  // ─── Navigation ────────────────────────────────────────────────────────────
  searchFiles: tool({
    description: 'Search file and folder names, and optionally text content, inside allowed ZilMate file roots. Skips sensitive files, node_modules, .git, dist, and caches.',
    inputSchema: z.object({
      query: z.string().min(1),
      root: z.string().optional().describe('Folder to search. Defaults to the current working directory.'),
      includeContent: z.boolean().optional(),
      maxDepth: z.number().int().min(0).max(8).optional(),
      maxResults: z.number().int().min(1).max(200).optional(),
    }),
    execute: async ({ query, root, includeContent, maxDepth, maxResults }) => {
      const searchRoot = assertSafePath(root || process.cwd());
      emitProgress({ type: 'search:start', label: 'Searching files', detail: query });
      const entries = await walk(searchRoot, { maxDepth: maxDepth ?? 5, maxEntries: 1000 });
      const normalized = query.toLowerCase();
      const matches: any[] = [];
      for (const entry of entries) {
        if (matches.length >= (maxResults ?? 50)) break;
        const nameMatch = entry.path.toLowerCase().includes(normalized);
        let contentMatch = false;
        let excerpt = '';
        if (!nameMatch && includeContent && entry.type === 'file' && entry.size <= defaultMaxReadBytes) {
          try {
            const content = await readFile(entry.absolutePath, 'utf8');
            const index = content.toLowerCase().indexOf(normalized);
            contentMatch = index >= 0;
            if (contentMatch) excerpt = content.slice(Math.max(0, index - 120), index + query.length + 220);
          } catch {
            contentMatch = false;
          }
        }
        if (nameMatch || contentMatch) matches.push({ ...entry, match: nameMatch ? 'name' : 'content', excerpt });
      }
      emitProgress({ type: 'search:end', label: 'File search complete', detail: `${matches.length} result${matches.length === 1 ? '' : 's'}` });
      return matches;
    },
  }),

  listDirectory: tool({
    description: 'List files and folders in a directory with details (name, type, size, modified date). Supports filtering and sorting.',
    inputSchema: z.object({
      path: z.string().min(1).describe('Directory path to list'),
      filter: z.string().optional().describe('Filter by name (partial match, case-insensitive)'),
      includeHidden: z.boolean().optional().describe('Include dot-files/hidden files (default: false)'),
      maxDepth: z.number().int().min(1).max(5).optional().describe('How many levels deep to list (default: 1 = current level only)'),
      limit: z.number().int().min(1).max(500).optional().describe('Max entries to return (default: 100)'),
      sortBy: z.enum(['name', 'size', 'modified']).optional().describe('Sort order (default: name)'),
    }),
    execute: async ({ path: dirPath, filter, includeHidden, maxDepth, limit, sortBy }) => {
      const resolved = assertSafePath(dirPath);
      const info = await stat(resolved);
      if (!info.isDirectory()) throw new Error('Path is not a directory.');

      const entries = await walk(resolved, {
        maxDepth: maxDepth ?? 1,
        maxEntries: limit ?? 100
      });

      let filtered = entries;
      if (!includeHidden) {
        filtered = filtered.filter(e => !e.path.split(/[\\/]/).some(p => p.startsWith('.')));
      }
      if (filter) {
        const lowerFilter = filter.toLowerCase();
        filtered = filtered.filter(e => e.path.toLowerCase().includes(lowerFilter));
      }
      if (sortBy === 'size') filtered = filtered.sort((a, b) => b.size - a.size);
      else if (sortBy === 'modified') filtered = filtered.sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime());
      else filtered = filtered.sort((a, b) => a.path.localeCompare(b.path));

      emitProgress({ type: 'fetch:end', label: 'Directory listed', detail: relativeDisplay(resolved) });

      return {
        directory: relativeDisplay(resolved),
        absolutePath: resolved,
        entries: filtered.slice(0, limit ?? 100),
        count: filtered.length,
        filtered: !!filter,
      };
    },
  }),

  treeView: tool({
    description: 'Display a directory tree in a visual ASCII tree format, like the "tree" command. Great for understanding project structure.',
    inputSchema: z.object({
      path: z.string().optional().describe('Root directory to display (default: cwd)'),
      maxDepth: z.number().int().min(1).max(6).optional().describe('Max depth (default: 3)'),
      includeHidden: z.boolean().optional(),
      foldersOnly: z.boolean().optional().describe('Only show directories, not files'),
    }),
    execute: async ({ path: dirPath, maxDepth, includeHidden, foldersOnly }) => {
      const resolved = assertSafePath(dirPath || process.cwd());
      const entries = await walk(resolved, { maxDepth: maxDepth ?? 3, maxEntries: 500 });
      let filtered = entries.slice(1); // skip root itself
      if (!includeHidden) filtered = filtered.filter(e => !e.path.split(/[\\/]/).some(p => p.startsWith('.')));
      if (foldersOnly) filtered = filtered.filter(e => e.type === 'directory');

      const rootName = path.basename(resolved) + '/';
      const treeLines = buildTreeLines(filtered);
      const tree = [rootName, ...treeLines].join('\n');
      const dirs = filtered.filter(e => e.type === 'directory').length;
      const files = filtered.filter(e => e.type === 'file').length;

      emitProgress({ type: 'fetch:end', label: 'Tree view generated', detail: relativeDisplay(resolved) });
      return { tree, directories: dirs, files, root: relativeDisplay(resolved) };
    },
  }),

  // ─── Read / Write ──────────────────────────────────────────────────────────
  readFile: tool({
    description: 'Read a text file inside allowed ZilMate file roots. Sensitive files such as .env, keys, credentials, and tokens are blocked.',
    inputSchema: z.object({
      path: z.string().min(1),
      maxBytes: z.number().int().min(1000).max(500_000).optional(),
      startLine: z.number().int().min(1).optional().describe('Read from line N (1-indexed)'),
      endLine: z.number().int().min(1).optional().describe('Read to line N inclusive'),
    }),
    execute: async ({ path: filePath, maxBytes, startLine, endLine }) => {
      const resolved = assertSafePath(filePath);
      const info = await stat(resolved);
      if (!info.isFile()) throw new Error('Path is not a file.');
      const limit = maxBytes ?? defaultMaxReadBytes;
      let content = await readFile(resolved, 'utf8');

      if (startLine || endLine) {
        const lines = content.split('\n');
        const from = (startLine ?? 1) - 1;
        const to = endLine ?? lines.length;
        content = lines.slice(from, to).join('\n');
      }

      const truncated = Buffer.byteLength(content, 'utf8') > limit;
      emitProgress({ type: 'fetch:end', label: 'File read', detail: relativeDisplay(resolved) });
      return {
        path: relativeDisplay(resolved),
        size: info.size,
        modifiedAt: info.mtime.toISOString(),
        truncated,
        content: truncated ? content.slice(0, limit) : content,
        lineCount: content.split('\n').length,
      };
    },
  }),

  writeFile: tool({
    description: 'Write or append text to a file inside allowed ZilMate file roots. Creates parent directories automatically.',
    inputSchema: z.object({
      path: z.string().min(1),
      content: z.string(),
      mode: z.enum(['overwrite', 'append']).optional(),
      createDirs: z.boolean().optional().describe('Auto-create parent directories (default: true)'),
    }),
    execute: async ({ path: filePath, content, mode, createDirs }) => {
      const resolved = assertSafePath(filePath);
      if (createDirs !== false) await mkdir(path.dirname(resolved), { recursive: true });
      await writeFile(resolved, content, { encoding: 'utf8', flag: mode === 'append' ? 'a' : 'w' });
      emitProgress({ type: 'tool:end', label: 'File written', detail: relativeDisplay(resolved) });
      return { path: relativeDisplay(resolved), bytes: Buffer.byteLength(content, 'utf8'), mode: mode ?? 'overwrite' };
    },
  }),

  patchFile: tool({
    description: 'Replace a specific string or line range inside a file without rewriting the whole thing. Precise in-place editing.',
    inputSchema: z.object({
      path: z.string().min(1),
      find: z.string().optional().describe('Exact text to find and replace'),
      replace: z.string().optional().describe('Replacement text'),
      startLine: z.number().int().min(1).optional().describe('Start line to replace (1-indexed)'),
      endLine: z.number().int().min(1).optional().describe('End line to replace (inclusive)'),
      newContent: z.string().optional().describe('Replacement content for the line range'),
      replaceAll: z.boolean().optional().describe('Replace all occurrences (default: first only)'),
    }),
    execute: async ({ path: filePath, find, replace, startLine, endLine, newContent, replaceAll }) => {
      const resolved = assertSafePath(filePath);
      let content = await readFile(resolved, 'utf8');
      let patched = content;

      if (find !== undefined && replace !== undefined) {
        if (replaceAll) {
          patched = content.split(find).join(replace);
        } else {
          const idx = content.indexOf(find);
          if (idx === -1) throw new Error(`Text not found: ${JSON.stringify(find)}`);
          patched = content.slice(0, idx) + replace + content.slice(idx + find.length);
        }
      } else if (startLine !== undefined && endLine !== undefined && newContent !== undefined) {
        const lines = content.split('\n');
        lines.splice(startLine - 1, endLine - startLine + 1, ...newContent.split('\n'));
        patched = lines.join('\n');
      } else {
        throw new Error('Provide either (find + replace) or (startLine + endLine + newContent).');
      }

      await writeFile(resolved, patched, 'utf8');
      emitProgress({ type: 'tool:end', label: 'File patched', detail: relativeDisplay(resolved) });
      return { path: relativeDisplay(resolved), changed: patched !== content, bytesBefore: Buffer.byteLength(content), bytesAfter: Buffer.byteLength(patched) };
    },
  }),

  grepFiles: tool({
    description: 'Search for a regex or text pattern inside file contents across a directory. Like "grep -rn". Returns matching lines with context.',
    inputSchema: z.object({
      pattern: z.string().min(1).describe('Text or regex pattern to search for'),
      root: z.string().optional().describe('Directory to search (default: cwd)'),
      filePattern: z.string().optional().describe('Glob-like filter, e.g. "*.ts" or "*.md"'),
      isRegex: z.boolean().optional().describe('Treat pattern as regex (default: false = literal text)'),
      caseSensitive: z.boolean().optional().describe('Case-sensitive match (default: false)'),
      maxResults: z.number().int().min(1).max(500).optional(),
      contextLines: z.number().int().min(0).max(10).optional().describe('Lines of context around each match (default: 1)'),
      maxDepth: z.number().int().min(0).max(8).optional(),
    }),
    execute: async ({ pattern, root, filePattern, isRegex, caseSensitive, maxResults, contextLines, maxDepth }) => {
      const searchRoot = assertSafePath(root || process.cwd());
      const entries = (await walk(searchRoot, { maxDepth: maxDepth ?? 5, maxEntries: 2000 }))
        .filter(e => e.type === 'file');

      const ext = filePattern?.startsWith('*.') ? filePattern.slice(1) : null;
      const relevant = ext ? entries.filter(e => e.absolutePath.endsWith(ext)) : entries;

      const flags = caseSensitive ? 'g' : 'gi';
      const re = isRegex ? new RegExp(pattern, flags) : new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);

      const matches: Array<{ file: string; lineNumber: number; line: string; context: string[] }> = [];
      const ctx = contextLines ?? 1;

      for (const entry of relevant) {
        if (matches.length >= (maxResults ?? 100)) break;
        if (entry.size > 500_000) continue;
        try {
          const content = await readFile(entry.absolutePath, 'utf8');
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (matches.length >= (maxResults ?? 100)) break;
            if (re.test(lines[i]!)) {
              re.lastIndex = 0;
              matches.push({
                file: relativeDisplay(entry.absolutePath),
                lineNumber: i + 1,
                line: lines[i]!.trim(),
                context: lines.slice(Math.max(0, i - ctx), Math.min(lines.length, i + ctx + 1)).map((l, j) => `${Math.max(0, i - ctx) + j + 1}: ${l}`),
              });
            }
            re.lastIndex = 0;
          }
        } catch { /* skip unreadable */ }
      }

      emitProgress({ type: 'search:end', label: 'Grep complete', detail: `${matches.length} match${matches.length === 1 ? '' : 'es'}` });
      return { pattern, matches, total: matches.length };
    },
  }),

  // ─── Move / Copy / Rename / Delete ─────────────────────────────────────────
  createFolder: tool({
    description: 'Create a folder (and all parent folders) inside allowed ZilMate file roots.',
    inputSchema: z.object({ path: z.string().min(1) }),
    execute: async ({ path: folderPath }) => {
      const resolved = assertSafePath(folderPath);
      await mkdir(resolved, { recursive: true });
      emitProgress({ type: 'tool:end', label: 'Folder created', detail: relativeDisplay(resolved) });
      return { path: relativeDisplay(resolved), created: true };
    },
  }),

  moveCopyRename: tool({
    description: 'Move, copy, or rename a file/folder inside allowed ZilMate file roots. Can bulk-copy into a directory.',
    inputSchema: z.object({
      operation: z.enum(['move', 'copy', 'rename']),
      from: z.string().min(1).describe('Source path'),
      to: z.string().min(1).describe('Destination path or directory'),
      overwrite: z.boolean().optional(),
    }),
    execute: async ({ operation, from, to, overwrite }) => {
      const source = assertSafePath(from);
      let target = assertSafePath(to);
      if (!existsSync(source)) throw new Error('Source path does not exist.');

      // If "to" is an existing directory, place item inside it
      try {
        const toStat = await stat(target);
        if (toStat.isDirectory()) {
          target = path.join(target, path.basename(source));
        }
      } catch { /* target doesn't exist yet */ }

      if (existsSync(target) && !overwrite) throw new Error('Target already exists. Set overwrite=true if the user explicitly approves replacing it.');
      await mkdir(path.dirname(target), { recursive: true });
      if (existsSync(target) && overwrite) {
        const targetStat = await stat(target);
        if (targetStat.isDirectory()) {
          await rm(target, { recursive: true, force: true });
        } else {
          await unlink(target);
        }
      }
      if (operation === 'copy') {
        await cp(source, target, { recursive: true, force: true });
      } else {
        try {
          await rename(source, target);
        } catch (err: any) {
          if (err.code === 'EXDEV') {
            await cp(source, target, { recursive: true, force: true });
            const sourceStat = await stat(source);
            if (sourceStat.isDirectory()) {
              await rm(source, { recursive: true, force: true });
            } else {
              await unlink(source);
            }
          } else {
            throw err;
          }
        }
      }
      emitProgress({ type: 'tool:end', label: `File ${operation} complete`, detail: relativeDisplay(target) });
      return { operation, from: relativeDisplay(source), to: relativeDisplay(target) };
    },
  }),

  bulkMove: tool({
    description: 'Move or copy multiple files to a destination directory in one call.',
    inputSchema: z.object({
      paths: z.array(z.string().min(1)).min(1).max(50).describe('Source file paths'),
      to: z.string().min(1).describe('Destination directory'),
      operation: z.enum(['move', 'copy']).default('move'),
      overwrite: z.boolean().optional(),
    }),
    execute: async ({ paths, to, operation, overwrite }) => {
      const destDir = assertSafePath(to);
      await mkdir(destDir, { recursive: true });

      const results: Array<{ from: string; to: string; status: 'ok' | 'error'; error?: string }> = [];
      for (const filePath of paths) {
        try {
          const source = assertSafePath(filePath);
          const target = path.join(destDir, path.basename(source));
          if (existsSync(target) && !overwrite) throw new Error('Target already exists. Set overwrite=true to replace it.');
          if (existsSync(target) && overwrite) {
            const targetStat = await stat(target);
            if (targetStat.isDirectory()) {
              await rm(target, { recursive: true, force: true });
            } else {
              await unlink(target);
            }
          }
          if (operation === 'copy') {
            await cp(source, target, { recursive: true, force: true });
          } else {
            try {
              await rename(source, target);
            } catch (err: any) {
              if (err.code === 'EXDEV') {
                await cp(source, target, { recursive: true, force: true });
                const sourceStat = await stat(source);
                if (sourceStat.isDirectory()) {
                  await rm(source, { recursive: true, force: true });
                } else {
                  await unlink(source);
                }
              } else {
                throw err;
              }
            }
          }
          results.push({ from: relativeDisplay(source), to: relativeDisplay(target), status: 'ok' });
        } catch (e) {
          results.push({ from: filePath, to: to, status: 'error', error: e instanceof Error ? e.message : String(e) });
        }
      }

      emitProgress({ type: 'tool:end', label: `Bulk ${operation} complete`, detail: `${results.filter(r => r.status === 'ok').length}/${paths.length} succeeded` });
      return { operation, destination: relativeDisplay(destDir), results };
    },
  }),

  deleteFile: tool({
    description: 'Delete a single file inside allowed ZilMate file roots. Requires explicit file path (not glob). Cannot be undone.',
    inputSchema: z.object({
      path: z.string().min(1).describe('Exact file path to delete'),
    }),
    execute: async ({ path: filePath }) => {
      const resolved = assertSafePath(filePath);
      const info = await stat(resolved);
      if (!info.isFile()) throw new Error('Path is not a file.');
      const approved = await requestConfirmation({
        toolkitSlug: 'local',
        toolSlug: 'deleteFile',
        action: `Delete file: ${relativeDisplay(resolved)}`,
        access: 'Write',
        summary: `Permanently delete ${relativeDisplay(resolved)} (${info.size} bytes). This cannot be undone.`,
      });
      if (!approved) throw new Error(`Deletion of ${relativeDisplay(resolved)} was not approved.`);
      await unlink(resolved);
      emitProgress({ type: 'tool:end', label: 'File deleted', detail: relativeDisplay(resolved) });
      return { deleted: true, path: relativeDisplay(resolved), size: info.size };
    },
  }),

  deleteFolder: tool({
    description: 'Delete a folder and all its contents inside allowed ZilMate file roots. Requires explicit folder path. Cannot be undone.',
    inputSchema: z.object({
      path: z.string().min(1).describe('Exact folder path to delete'),
    }),
    execute: async ({ path: folderPath }) => {
      const resolved = assertSafePath(folderPath);
      const info = await stat(resolved);
      if (!info.isDirectory()) throw new Error('Path is not a directory.');
      const approved = await requestConfirmation({
        toolkitSlug: 'local',
        toolSlug: 'deleteFolder',
        action: `Delete folder: ${relativeDisplay(resolved)}`,
        access: 'Write',
        summary: `Permanently delete folder ${relativeDisplay(resolved)} and ALL its contents. This cannot be undone.`,
      });
      if (!approved) throw new Error(`Deletion of ${relativeDisplay(resolved)} was not approved.`);
      await rm(resolved, { recursive: true, force: true });
      emitProgress({ type: 'tool:end', label: 'Folder deleted', detail: relativeDisplay(resolved) });
      return { deleted: true, path: relativeDisplay(resolved) };
    },
  }),

  // ─── Analysis & Metadata ───────────────────────────────────────────────────
  getFileInfo: tool({
    description: 'Get detailed metadata about a file or folder: size, dates, type, permissions, line count, etc.',
    inputSchema: z.object({
      path: z.string().min(1).describe('File or folder path'),
    }),
    execute: async ({ path: filePath }) => {
      const resolved = assertSafePath(filePath);
      const info = await stat(resolved);
      const { size, atimeMs, mtimeMs, birthtimeMs, mode } = info;

      let lineCount: number | undefined;
      let extension: string | undefined;
      if (info.isFile()) {
        extension = path.extname(resolved).slice(1) || undefined;
        try {
          const content = await readFile(resolved, 'utf8');
          lineCount = content.split('\n').length;
        } catch { /* binary file */ }
      }

      return {
        path: relativeDisplay(resolved),
        absolutePath: resolved,
        type: info.isDirectory() ? 'directory' : 'file',
        extension,
        size,
        sizeKB: (size / 1024).toFixed(2),
        sizeMB: (size / (1024 ** 2)).toFixed(2),
        created: new Date(birthtimeMs).toISOString(),
        modified: new Date(mtimeMs).toISOString(),
        accessed: new Date(atimeMs).toISOString(),
        isFile: info.isFile(),
        isDirectory: info.isDirectory(),
        isSymlink: info.isSymbolicLink(),
        mode: mode?.toString(8),
        lineCount,
      };
    },
  }),

  summarizeDocument: tool({
    description: 'Read and summarize a text-like document inside allowed ZilMate file roots. Supports plain text, markdown, JSON, CSV, and code files.',
    inputSchema: z.object({
      path: z.string().min(1),
      maxBytes: z.number().int().min(1000).max(500_000).optional(),
    }),
    execute: async ({ path: filePath, maxBytes }) => {
      const resolved = assertSafePath(filePath);
      const content = await readFile(resolved, 'utf8');
      const limit = maxBytes ?? 300_000;
      const sliced = content.length > limit ? content.slice(0, limit) : content;
      const summary = summarizeText(sliced);
      emitProgress({ type: 'fetch:end', label: 'Document summarized', detail: relativeDisplay(resolved) });
      return { path: relativeDisplay(resolved), truncated: content.length > limit, ...summary };
    },
  }),

  diffFiles: tool({
    description: 'Show the line-by-line diff between two text files. Useful for comparing versions.',
    inputSchema: z.object({
      fileA: z.string().min(1).describe('First file path'),
      fileB: z.string().min(1).describe('Second file path'),
      contextLines: z.number().int().min(0).max(20).optional().describe('Lines of context around changes (default: 3)'),
    }),
    execute: async ({ fileA, fileB, contextLines }) => {
      const a = assertSafePath(fileA);
      const b = assertSafePath(fileB);
      const [contentA, contentB] = await Promise.all([readFile(a, 'utf8'), readFile(b, 'utf8')]);
      const linesA = contentA.split('\n');
      const linesB = contentB.split('\n');
      const ctx = contextLines ?? 3;

      // Simple line-by-line diff
      const hunks: string[] = [];
      let i = 0, j = 0;
      const changes: Array<{ type: '+' | '-' | ' '; line: string; lineA?: number; lineB?: number }> = [];

      while (i < linesA.length || j < linesB.length) {
        if (i < linesA.length && j < linesB.length && linesA[i] === linesB[j]) {
          changes.push({ type: ' ', line: linesA[i]!, lineA: i + 1, lineB: j + 1 });
          i++; j++;
        } else if (j < linesB.length && (i >= linesA.length || linesA[i] !== linesB[j])) {
          changes.push({ type: '+', line: linesB[j]!, lineB: j + 1 });
          j++;
        } else {
          changes.push({ type: '-', line: linesA[i]!, lineA: i + 1 });
          i++;
        }
      }

      const diff = changes.map(c => `${c.type} ${c.line}`).join('\n');
      const added = changes.filter(c => c.type === '+').length;
      const removed = changes.filter(c => c.type === '-').length;

      emitProgress({ type: 'fetch:end', label: 'Files diffed', detail: `+${added} -${removed}` });
      return {
        fileA: relativeDisplay(a),
        fileB: relativeDisplay(b),
        added,
        removed,
        unchanged: changes.filter(c => c.type === ' ').length,
        diff: diff.slice(0, 50_000),
        identical: added === 0 && removed === 0,
      };
    },
  }),

  diskUsage: tool({
    description: 'Show disk usage of a directory — total size, largest subdirs, top files by size. Like "du -sh".',
    inputSchema: z.object({
      path: z.string().optional().describe('Directory to analyze (default: cwd)'),
      maxDepth: z.number().int().min(1).max(6).optional(),
      topN: z.number().int().min(1).max(50).optional().describe('Number of top items to show (default: 10)'),
    }),
    execute: async ({ path: dirPath, maxDepth, topN }) => {
      const resolved = assertSafePath(dirPath || process.cwd());
      const entries = await walk(resolved, { maxDepth: maxDepth ?? 4, maxEntries: 5000 });

      const totalBytes = entries.filter(e => e.type === 'file').reduce((sum, e) => sum + e.size, 0);
      const topFiles = entries
        .filter(e => e.type === 'file')
        .sort((a, b) => b.size - a.size)
        .slice(0, topN ?? 10)
        .map(e => ({ path: e.path, size: e.size, sizeKB: (e.size / 1024).toFixed(1) }));

      // Compute directory sizes
      const dirSizes = new Map<string, number>();
      for (const entry of entries.filter(e => e.type === 'file')) {
        const parts = entry.path.split(/[\\/]/);
        for (let d = 1; d <= parts.length - 1; d++) {
          const dir = parts.slice(0, d).join('/');
          dirSizes.set(dir, (dirSizes.get(dir) ?? 0) + entry.size);
        }
      }
      const topDirs = [...dirSizes.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, topN ?? 10)
        .map(([dir, size]) => ({ dir, size, sizeKB: (size / 1024).toFixed(1), sizeMB: (size / (1024 ** 2)).toFixed(2) }));

      emitProgress({ type: 'fetch:end', label: 'Disk usage analyzed', detail: relativeDisplay(resolved) });
      return {
        root: relativeDisplay(resolved),
        totalBytes,
        totalKB: (totalBytes / 1024).toFixed(1),
        totalMB: (totalBytes / (1024 ** 2)).toFixed(2),
        fileCount: entries.filter(e => e.type === 'file').length,
        dirCount: entries.filter(e => e.type === 'directory').length,
        topFiles,
        topDirs,
      };
    },
  }),

  findDuplicateLargeFiles: tool({
    description: 'Find large files and likely duplicate files by size inside allowed ZilMate file roots. Skips sensitive files and dependency/build folders.',
    inputSchema: z.object({
      root: z.string().optional(),
      minSizeBytes: z.number().int().min(1).optional(),
      maxDepth: z.number().int().min(0).max(8).optional(),
      maxResults: z.number().int().min(1).max(200).optional(),
    }),
    execute: async ({ root, minSizeBytes, maxDepth, maxResults }) => {
      const searchRoot = assertSafePath(root || process.cwd());
      const entries = (await walk(searchRoot, { maxDepth: maxDepth ?? 6, maxEntries: 2000 })).filter((entry) => entry.type === 'file');
      const minSize = minSizeBytes ?? 1_000_000;
      const large = entries
        .filter((entry) => entry.size >= minSize)
        .sort((a, b) => b.size - a.size)
        .slice(0, maxResults ?? 50);
      const bySize = new Map<number, typeof entries>();
      for (const entry of entries) bySize.set(entry.size, [...(bySize.get(entry.size) ?? []), entry]);
      const duplicates = [...bySize.entries()]
        .filter(([, items]) => items.length > 1)
        .map(([size, items]) => ({ size, files: items.map((item) => item.path) }))
        .slice(0, maxResults ?? 50);
      return { large, duplicateSizeGroups: duplicates };
    },
  }),

  watchFolderChanges: tool({
    description: 'Snapshot a folder and report changes since the previous snapshot. This is a local compare-watch, not a background daemon.',
    inputSchema: z.object({
      path: z.string().optional(),
      watchName: z.string().min(1).max(80).optional(),
      reset: z.boolean().optional(),
      maxDepth: z.number().int().min(0).max(8).optional(),
    }),
    execute: async ({ path: folderPath, watchName, reset, maxDepth }) => {
      const root = assertSafePath(folderPath || process.cwd());
      const key = watchName || relativeDisplay(root) || 'default';
      const store = await readJson<Record<string, FileSnapshot>>(watchFile, {});
      const current = await snapshot(root, maxDepth ?? 4);
      const previous = reset ? undefined : store[key];
      store[key] = current;
      await writeJson(watchFile, store);

      if (!previous) return { watchName: key, baselineSaved: true, added: [], changed: [], removed: [] };

      const added = Object.keys(current).filter((item) => !previous[item]);
      const removed = Object.keys(previous).filter((item) => !current[item]);
      const changed = Object.keys(current).filter((item) => previous[item] && (previous[item].size !== current[item]!.size || previous[item].modifiedAt !== current[item]!.modifiedAt));
      return { watchName: key, baselineSaved: true, added, changed, removed };
    },
  }),

  // ─── Advanced ─────────────────────────────────────────────────────────────
  touchFile: tool({
    description: 'Create an empty file or update a file\'s last-modified timestamp without changing its content.',
    inputSchema: z.object({
      path: z.string().min(1).describe('File path to touch'),
    }),
    execute: async ({ path: filePath }) => {
      const resolved = assertSafePath(filePath);
      await mkdir(path.dirname(resolved), { recursive: true });
      if (existsSync(resolved)) {
        const now = new Date();
        await import('node:fs/promises').then(fs => fs.utimes(resolved, now, now));
      } else {
        await writeFile(resolved, '', 'utf8');
      }
      emitProgress({ type: 'tool:end', label: 'File touched', detail: relativeDisplay(resolved) });
      return { path: relativeDisplay(resolved), created: !existsSync(resolved) };
    },
  }),

  createSymlink: tool({
    description: 'Create a symbolic link pointing to a target path.',
    inputSchema: z.object({
      target: z.string().min(1).describe('The real path the symlink points to'),
      link: z.string().min(1).describe('Where to create the symlink'),
    }),
    execute: async ({ target, link }) => {
      const resolvedLink = assertSafePath(link);
      await mkdir(path.dirname(resolvedLink), { recursive: true });
      await symlink(target, resolvedLink);
      emitProgress({ type: 'tool:end', label: 'Symlink created', detail: relativeDisplay(resolvedLink) });
      return { link: relativeDisplay(resolvedLink), target };
    },
  }),

  readSymlink: tool({
    description: 'Read the target of a symbolic link.',
    inputSchema: z.object({ path: z.string().min(1) }),
    execute: async ({ path: linkPath }) => {
      const resolved = assertSafePath(linkPath);
      const target = await readlink(resolved);
      return { link: relativeDisplay(resolved), target };
    },
  }),

  checkFileExists: tool({
    description: 'Check if a file or directory exists and what type it is. Safe and fast.',
    inputSchema: z.object({
      path: z.string().min(1),
    }),
    execute: async ({ path: filePath }) => {
      const resolved = assertSafePath(filePath);
      if (!existsSync(resolved)) return { exists: false, path: relativeDisplay(resolved) };
      const info = await stat(resolved);
      return {
        exists: true,
        path: relativeDisplay(resolved),
        type: info.isDirectory() ? 'directory' : info.isSymbolicLink() ? 'symlink' : 'file',
        size: info.size,
        modified: info.mtime.toISOString(),
      };
    },
  }),

  chmodFile: tool({
    description: 'Change file permissions (Unix-style octal mode). E.g. 755 for executables, 644 for read-only. Only works on non-Windows systems.',
    inputSchema: z.object({
      path: z.string().min(1),
      mode: z.string().regex(/^[0-7]{3,4}$/).describe('Octal permission mode, e.g. "755", "644"'),
    }),
    execute: async ({ path: filePath, mode }) => {
      if (process.platform === 'win32') throw new Error('chmod is not supported on Windows.');
      const resolved = assertSafePath(filePath);
      const octal = parseInt(mode, 8);
      await chmod(resolved, octal);
      emitProgress({ type: 'tool:end', label: 'Permissions changed', detail: `${relativeDisplay(resolved)} → ${mode}` });
      return { path: relativeDisplay(resolved), mode };
    },
  }),
};
