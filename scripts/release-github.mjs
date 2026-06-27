import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const version = pkg.version;
const tag = `v${version}`;
const title = `ZilMate ${tag}`;

const notes = `# ${title}

ZilMate ${tag} — Critical hotfix for Vercel AI Gateway custom fetch client to resolve connection pool leaks, socket exhaustion, and SSL handshake errors that resulted in raw 'Gateway request failed' responses.

## Install

\`\`\`powershell
npm install -g zilmate@${version}
zilmate setup
zilmate doctor
zilmate menu
\`\`\`

## Highlights

- **CRITICAL HOTFIX: Connection Pool & Socket Leak** — Fixed an architectural issue in our Vercel AI SDK gateway fetch wrapper that created a \`new Agent\` (separate connection pool) for every single HTTP request. We now instantiate a single, reused global Undici \`Agent\` dispatcher, completely resolving socket exhaustion, TCP reset drops, and SSL handshake failures (which previously caused intermittent raw \`Gateway request failed\` errors).
- **TypeScript Type-Safety Compliance** — Adjusted the gateway setup options to spread the \`apiKey\` conditionally only when defined, fully satisfying strict compilation checks under \`exactOptionalPropertyTypes: true\`.
- **SDK Upgrade: Composio Core & Vercel Integration** — Upgraded \`@composio/core\` to \`0.13.1\` and \`@composio/vercel\` to \`0.11.0\` globally to resolve CLI deprecation warnings and inherit upstream performance and tool registry fixes.
- **Cloudflare Tunnel Auto-Setup** — Automated downloader and manager for \`cloudflared\` binary blobs across Windows, macOS, and Linux to power \`zilmate jobs listen --tunnel\` with zero manual setup.
- **Interactive Safety Checklists** — Elegant terminal TUI using checkboxes and keyboard selection to toggle approval on specific multi-specialist tool parameters during execution prompts.
- **Persistent Thinking Status Card** — Smooth rotating status card widget pinned to the bottom of the chat terminal during model inference to display elapsed time and keyboard shortcuts.

## Quick Checks

\`\`\`powershell
zilmate setup
zilmate doctor
zilmate menu
\`\`\`

## npm

Published package: \`zilmate@${version}\`
`;

const run = (command, commandArgs, options = {}) => {
  return execFileSync(command, commandArgs, {
    encoding: 'utf8',
    stdio: options.stdio ?? 'pipe',
    ...options,
  });
};

if (dryRun) {
  console.log(`Tag: ${tag}`);
  console.log(`Title: ${title}`);
  console.log('');
  console.log(notes);
  process.exit(0);
}

try {
  run('gh', ['auth', 'status'], { stdio: 'pipe' });
} catch {
  console.error('GitHub CLI is not authenticated. Run: gh auth login -h github.com');
  process.exit(1);
}

const notesPath = join(tmpdir(), `zilmate-${version}-github-release.md`);
writeFileSync(notesPath, notes);

run(
  'gh',
  [
    'release',
    'create',
    tag,
    '--repo',
    'zester4/zilo-manager',
    '--title',
    title,
    '--notes-file',
    notesPath,
    '--latest',
  ],
  { stdio: 'inherit' },
);
