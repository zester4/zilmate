import { exec, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import { printPanel, padAnsiLine } from './format.js';
import { workspaceLayout } from '../workspace/paths.js';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);
const packageName = 'zilmate';

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

export function buildNpmInstallArgs(spec: string, options: { platform?: NodeJS.Platform } = {}) {
  const platform = options.platform ?? process.platform;
  const args = ['install', '-g', spec, '--no-audit', '--no-fund'];
  if (platform === 'win32') {
    args.push('--force');
  }
  return args;
}

export function shouldRetryWithoutScripts(detail: string) {
  const normalized = detail.toLowerCase();
  return (
    normalized.includes('eperm') ||
    normalized.includes('access is denied') ||
    normalized.includes('operation not permitted') ||
    normalized.includes('postinstall') ||
    normalized.includes('permission denied') ||
    normalized.includes('running scripts')
  );
}

function parseVersion(version: string) {
  return version
    .trim()
    .replace(/^v/, '')
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0);
}

export function compareVersions(left: string, right: string) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export async function latestNpmVersion() {
  const { stdout } = process.platform === 'win32'
    ? await execAsync(`${npmCommand()} view ${packageName} version`, { windowsHide: true, timeout: 30_000 })
    : await execFileAsync(npmCommand(), ['view', packageName, 'version'], { windowsHide: true, timeout: 30_000 });
  return stdout.trim();
}

export async function printVersionStatus(currentVersion: string) {
  try {
    const latest = await latestNpmVersion();
    const comparison = compareVersions(currentVersion, latest);
    printPanel('ZilMate version', [
      ['Current', currentVersion],
      ['Latest', latest],
      ['Status', comparison < 0 ? 'update available' : 'up to date'],
      ['Update', comparison < 0 ? 'zilmate update' : '-'],
    ]);
  } catch (error) {
    printPanel('ZilMate version', [
      ['Current', currentVersion],
      ['Latest', 'could not check npm'],
      ['Status', error instanceof Error ? error.message : String(error)],
      ['Manual', 'npm install -g zilmate@latest'],
    ]);
  }
}

export async function runSelfUpdate(options: { tag?: string; dryRun?: boolean } = {}) {
  const tag = options.tag || 'latest';
  if (!/^[A-Za-z0-9._-]+$/.test(tag)) {
    throw new Error('Update tag can only contain letters, numbers, dot, underscore, or dash.');
  }
  const spec = `${packageName}@${tag}`;
  const args = buildNpmInstallArgs(spec);
  if (options.dryRun) {
    printPanel('Update dry run', [
      ['Command', `${npmCommand()} ${args.join(' ')}`],
      ['Run', 'zilmate update'],
    ]);
    return;
  }

  printPanel('Updating ZilMate', [
    ['Package', spec],
    ['Command', `${npmCommand()} ${args.join(' ')}`],
  ]);

  try {
    const result = process.platform === 'win32'
      ? await execAsync(`${npmCommand()} ${args.join(' ')}`, { windowsHide: true, timeout: 120_000 })
      : await execFileAsync(npmCommand(), args, { windowsHide: true, timeout: 120_000 });
    const { stdout, stderr } = result;
    if (stdout.trim()) console.log(stdout.trim());
    if (stderr.trim()) console.error(stderr.trim());
    printPanel('Update complete', [
      ['Verify', 'zilmate --version'],
      ['Health', 'zilmate doctor'],
    ]);
  } catch (error: any) {
    let detail = error?.message || String(error);
    const stderr = error?.stderr || '';

    // If there is stderr, it usually contains the real reason (e.g. EPERM, EBUSY)
    if (stderr.trim()) {
      detail = `${detail}\n${stderr.trim()}`;
    }

    if (shouldRetryWithoutScripts(detail) && !args.includes('--ignore-scripts')) {
      try {
        const retryArgs = [...args, '--ignore-scripts'];
        const retryResult = process.platform === 'win32'
          ? await execAsync(`${npmCommand()} ${retryArgs.join(' ')}`, { windowsHide: true, timeout: 120_000 })
          : await execFileAsync(npmCommand(), retryArgs, { windowsHide: true, timeout: 120_000 });
        const { stdout, stderr: retryStderr } = retryResult;
        if (stdout.trim()) console.log(stdout.trim());
        if (retryStderr.trim()) console.error(retryStderr.trim());
        printPanel('Update complete', [
          ['Verify', 'zilmate --version'],
          ['Health', 'zilmate doctor'],
          ['Note', 'Installed without lifecycle scripts due to a common npm permission issue'],
        ]);
        return;
      } catch {
        // Fall through to the original error messaging below.
      }
    }

    // Clean up common messy npm error output
    if (detail.includes('npm warn deprecated')) {
      const parts = detail.split('\n');
      const filtered = parts.filter((p: string) => !p.includes('npm warn deprecated'));
      if (filtered.length > 0) {
        detail = filtered.join('\n').trim();
      }
    }

    const tips: [string, string][] = [
      ['Reason', detail.slice(0, 500) + (detail.length > 500 ? '...' : '')],
      ['Try', `${npmCommand()} install -g ${spec}`],
    ];

    if (process.platform === 'win32') {
      if (detail.includes('EPERM') || detail.includes('EBUSY') || detail.includes('Access is denied')) {
        tips.push(['Note', 'Files might be locked. Close all ZilMate windows and try again in a new terminal.']);
        tips.push(['Admin', 'Try running your terminal as Administrator']);
      }
      tips.push(['Windows fix', 'If npm still fails, run: npm install -g zilmate@latest --no-audit --no-fund --force --ignore-scripts']);
    } else if (detail.includes('EACCES')) {
      tips.push(['Note', 'Try running with sudo']);
    }

    printPanel('Update failed', tips);
    throw error;
  }
}

export function showUpdateBanner(current: string, latest: string) {
  const width = 60;
  const innerWidth = width - 4; // 56
  
  const title = `🚀 Update available: ${chalk.red(current)} → ${chalk.green(latest)}`;
  const cmd = chalk.cyan('zilmate update');
  const tip = `Run ${cmd} to get the latest features!`;

  const top = chalk.yellow(`╭${'─'.repeat(width - 2)}╮`);
  const line1 = chalk.yellow('│ ') + padAnsiLine(title, innerWidth) + chalk.yellow(' │');
  const divider = chalk.yellow(`├${'─'.repeat(width - 2)}┤`);
  const line2 = chalk.yellow('│ ') + padAnsiLine(tip, innerWidth) + chalk.yellow(' │');
  const bottom = chalk.yellow(`╰${'─'.repeat(width - 2)}╯`);

  console.log('');
  console.log(top);
  console.log(line1);
  console.log(divider);
  console.log(line2);
  console.log(bottom);
  console.log('');
}

export async function checkForUpdateOnce(currentVersion: string) {
  // 1. Skip if explicit update or version command is run
  const argv = process.argv;
  if (
    argv.includes('update') ||
    argv.includes('version') ||
    argv.includes('--version') ||
    argv.includes('-V') ||
    argv.includes('-v')
  ) {
    return;
  }

  try {
    const layout = workspaceLayout();
    const cacheDir = layout.config;
    const cachePath = path.join(cacheDir, 'update-check.json');

    // Ensure cache folder exists
    if (!existsSync(cacheDir)) {
      mkdirSync(cacheDir, { recursive: true });
    }

    let cache: {
      lastCheck?: number;
      latestVersion?: string;
      notifiedVersion?: string;
    } = {};

    if (existsSync(cachePath)) {
      try {
        cache = JSON.parse(readFileSync(cachePath, 'utf8'));
      } catch {
        // Corrupted JSON, start fresh
      }
    }

    const now = Date.now();
    const twentyFourHours = 24 * 60 * 60 * 1000;

    let latest = cache.latestVersion;

    // Check if we need to query npm (either no cached time, or > 24 hours has passed)
    if (!cache.lastCheck || now - cache.lastCheck > twentyFourHours) {
      try {
        // Query npm with a 1.5 second timeout to keep startup instant and prevent offline hangs
        const fetchPromise = latestNpmVersion();
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), 1500)
        );

        // Wait for npm or timeout
        const fetchedVersion = await Promise.race([fetchPromise, timeoutPromise]);
        
        if (fetchedVersion) {
          latest = fetchedVersion;
          cache.latestVersion = latest;
          cache.lastCheck = now;
          writeFileSync(cachePath, JSON.stringify(cache, null, 2), 'utf8');
        }
      } catch {
        // If npm query fails or times out, we fallback to cached version
        // but don't update lastCheck so we can try again on the next run
      }
    }

    if (!latest) {
      return;
    }

    // Compare versions: if latest > current and we haven't notified for this latest version
    if (compareVersions(currentVersion, latest) < 0 && cache.notifiedVersion !== latest) {
      showUpdateBanner(currentVersion, latest);
      // Mark as notified so they only see it ONCE
      cache.notifiedVersion = latest;
      writeFileSync(cachePath, JSON.stringify(cache, null, 2), 'utf8');
    }
  } catch {
    // Completely silent catch-all so update checking never crashes the main CLI
  }
}

