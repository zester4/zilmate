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

ZilMate ${tag} — Cross-platform premium desktop control suite, native system alerts, audio recording diagnostics, and a warm, personal-partner conversational interface.

## Install

\`\`\`powershell
npm install -g zilmate@${version}
zilmate setup
zilmate doctor
zilmate menu
\`\`\`

## Highlights

- **5 Premium Cross-Platform Desktop Tools** — Added powerful, high-fidelity native system tools including \`simulateMouse\` (click, move, drag, scroll), \`displaySystemNotification\` (native OS notifications), \`recordAudioSnippet\` (high-fidelity WAV recording via ffmpeg), \`getActiveWindowContext\` (tracking foreground process, title, and PID), and \`controlSystemVolume\` (volume controls, mute, and media playback keys).
- **Warm, Supportive Friendly Persona** — Re-aligned the core manager instructions to prioritize a personal partnership, warmth, and reliable trust over sterile, corporate roles, recognizing ZilMate acts as the CEO of his own digital corporation.
- **Strict TypeScript 6.0 Type-Safety** — Successfully integrated all changes and types to guarantee robust compiling checks and seamless edge-case resolution (such as undefined window contexts).

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
