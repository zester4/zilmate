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

ZilMate ${tag} — Claude-inspired CLI, situational awareness, session handoffs, model picker, and SDK docs.

## Install

\`\`\`powershell
npm install -g zilmate@${version}
zilmate setup
zilmate doctor --live
zilmate talk
\`\`\`

## Highlights

- **Beautiful CLI** — welcome card, tips, boxed composer input, Claude-style tool progress (\`● tool\` / \`└ Done\`).
- **/model pick** — interactively choose manager, coding, image, and vision models; persisted to workspace \`config/models.json\`.
- **Situational awareness** — \`getSituationBrief\` snapshots cwd, git, workspace, jobs, memory, models, and capabilities.
- **Session continuity** — handoff save/load/generate so ZilMate resumes where you left off.
- **Coding intelligence** — five tools: grep, working-tree review, symbol explain, scaffold, project checks; appBuilder + qaIntegration sub-coders.
- **Image director** — \`enhanceImagePrompt\` + generation with art-direction presets.
- **Cloudflare setup** — dedicated tunnel section in \`zilmate setup\`; \`zilmate jobs listen --tunnel\`.
- **SDK.md** — Next.js App Router streaming route, subagents, jobs, voice, model selection.

## Quick Checks

\`\`\`powershell
zilmate talk
/model pick
zilmate jobs listen --tunnel
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
