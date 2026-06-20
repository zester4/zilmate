// src/tools/code-intelligence.tool.ts
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { tool } from 'ai';
import { z } from 'zod';
import { generateText } from 'ai';
import { models } from '../config/models.js';
import { emitProgress } from '../runtime/progress.js';

async function runGit(cwd: string, args: string[], timeoutMs = 60_000) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn('git', args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      shell: process.platform === 'win32',
    });
    let out = '';
    child.stdout?.on('data', (c) => { out += String(c); });
    child.stderr?.on('data', (c) => { out += String(c); });
    child.on('error', reject);
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('git timed out')); }, timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 || out.trim()) resolve(out);
      else reject(new Error(out.trim() || `git exited ${code}`));
    });
  });
}

async function runRipgrep(root: string, pattern: string, glob?: string, limit = 40) {
  const args = ['--line-number', '--no-heading', '--color=never', '-m', String(limit), pattern, root];
  if (glob) args.unshift('--glob', glob);
  return new Promise<string>((resolve, reject) => {
    const child = spawn('rg', args, { windowsHide: true, shell: process.platform === 'win32' });
    let out = '';
    child.stdout?.on('data', (chunk) => { out += String(chunk); });
    child.stderr?.on('data', (chunk) => { out += String(chunk); });
    child.on('error', () => reject(new Error('ripgrep (rg) not found. Install ripgrep or use searchFiles.')));
    child.on('close', () => resolve(out.trim() || '(no matches)'));
  });
}

async function readPackageScripts(root: string) {
  const pkgPath = path.join(root, 'package.json');
  if (!existsSync(pkgPath)) return {};
  try {
    const pkg = JSON.parse(await readFile(pkgPath, 'utf8')) as { scripts?: Record<string, string> };
    return pkg.scripts ?? {};
  } catch {
    return {};
  }
}

export const codeIntelligenceTools = {
  grepCodebase: tool({
    description: 'Fast regex search across the repository (ripgrep). Use before editing unfamiliar code.',
    inputSchema: z.object({
      pattern: z.string().min(1),
      cwd: z.string().optional(),
      glob: z.string().optional(),
      limit: z.number().int().min(1).max(100).optional(),
    }),
    execute: async ({ pattern, cwd, glob, limit }) => {
      const root = cwd ? path.resolve(cwd) : process.cwd();
      emitProgress({ type: 'search:start', label: 'Searching codebase', detail: pattern });
      try {
        const output = await runRipgrep(root, pattern, glob, limit ?? 40);
        emitProgress({ type: 'search:end', label: 'Search complete' });
        return { root, pattern, output: output.slice(0, 12_000) };
      } catch (error) {
        return { root, pattern, error: error instanceof Error ? error.message : String(error) };
      }
    },
  }),

  reviewWorkingTree: tool({
    description: 'Review current git changes and return a structured code review with risks, suggestions, and test recommendations.',
    inputSchema: z.object({
      cwd: z.string().optional(),
      focus: z.string().optional(),
    }),
    execute: async ({ cwd, focus }) => {
      const root = cwd ? path.resolve(cwd) : process.cwd();
      emitProgress({ type: 'fetch:start', label: 'Reviewing working tree' });
      const status = await runGit(root, ['status', '-sb']);
      const diff = await runGit(root, ['diff'], 120_000).catch(() => '');
      const staged = await runGit(root, ['diff', '--cached'], 120_000).catch(() => '');
      const result = await generateText({
        model: models.coding,
        prompt: `Senior code review. Return markdown: Summary, Risks, Suggestions, Tests to run.\nFocus: ${focus || 'quality'}\nStatus:\n${status}\nDiff:\n${diff.slice(0, 8000)}\nStaged:\n${staged.slice(0, 4000)}`,
      });
      emitProgress({ type: 'fetch:end', label: 'Review complete' });
      return { root, review: result.text };
    },
  }),

  explainSymbol: tool({
    description: 'Find where a symbol is defined/used and explain it in this repo.',
    inputSchema: z.object({ symbol: z.string().min(1), cwd: z.string().optional() }),
    execute: async ({ symbol, cwd }) => {
      const root = cwd ? path.resolve(cwd) : process.cwd();
      let hits = '(search unavailable)';
      try {
        hits = await runRipgrep(root, symbol, '*.{ts,tsx,js,jsx,py,go,rs}', 30);
      } catch {
        // ignore
      }
      const result = await generateText({
        model: models.coding,
        prompt: `Explain symbol "${symbol}" from these hits:\n${hits}`,
      });
      return { symbol, root, explanation: result.text, hits: hits.slice(0, 6000) };
    },
  }),

  scaffoldFiles: tool({
    description: 'Create new files with provided content (focused scaffolds, not giant dumps).',
    inputSchema: z.object({
      files: z.array(z.object({
        path: z.string().min(1),
        content: z.string().min(1),
        overwrite: z.boolean().optional(),
      })).min(1).max(10),
      cwd: z.string().optional(),
    }),
    execute: async ({ files, cwd }) => {
      const root = cwd ? path.resolve(cwd) : process.cwd();
      const created: string[] = [];
      for (const file of files) {
        const target = path.resolve(root, file.path);
        if (existsSync(target) && !file.overwrite) {
          throw new Error(`File exists (set overwrite=true): ${file.path}`);
        }
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, file.content, 'utf8');
        created.push(target);
      }
      return { created, count: created.length };
    },
  }),

  runProjectChecks: tool({
    description: 'Run lint/test/typecheck/build scripts detected in package.json.',
    inputSchema: z.object({
      cwd: z.string().optional(),
      scripts: z.array(z.string()).optional(),
    }),
    execute: async ({ cwd, scripts }) => {
      const root = cwd ? path.resolve(cwd) : process.cwd();
      const available = await readPackageScripts(root);
      const chosen = scripts?.length
        ? scripts.filter((name) => available[name])
        : ['test', 'lint', 'typecheck', 'check', 'build'].filter((name) => available[name]);
      if (chosen.length === 0) return { root, ran: [], note: 'No scripts found', available };
      const results: Array<{ script: string; output: string; ok: boolean }> = [];
      for (const script of chosen.slice(0, 4)) {
        emitProgress({ type: 'tool:start', label: `npm run ${script}` });
        const output = await new Promise<string>((resolve, reject) => {
          const child = spawn('npm', ['run', script], { cwd: root, shell: true, windowsHide: true });
          let out = '';
          child.stdout?.on('data', (c) => { out += String(c); });
          child.stderr?.on('data', (c) => { out += String(c); });
          child.on('close', (code) => resolve(`${out}\nexit:${code ?? 1}`));
          child.on('error', reject);
        });
        results.push({ script, output: output.slice(-4000), ok: /exit:0\s*$/.test(output) });
        emitProgress({ type: 'tool:end', label: `npm run ${script} finished` });
      }
      return { root, results, allPassed: results.every((item) => item.ok) };
    },
  }),
};
