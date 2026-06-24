#!/usr/bin/env node
import { Command } from 'commander';
import { generateText } from 'ai';
import { requireGatewayAuth } from './config/env.js';
import { models } from './config/models.js';
import { runManager } from './agents/manager.js';
import { createQuickHelpAgent } from './agents/quick-help.agent.js';
import { createChatAgent } from './agents/chat.agent.js';
import { createPostAgent } from './agents/post.agent.js';
import { createDocsResearchAgent } from './agents/docs-research.agent.js';
import { generateImageAsset, isImageSize } from './tools/image-generate.tool.js';
import { startInteractiveChat } from './cli/interactive.js';
import { runSetup, runVoiceSetup, runChatSetup, setVoiceEnabled } from './cli/setup.js';
import { printError, printJson, printMarkdown, printProgress } from './cli/format.js';
import { createTerminalConfirmation } from './cli/confirm.js';
import { getComposioStatus } from './tools/composio.tool.js';
import { getResolvedConfigSummary, runDoctor } from './cli/doctor.js';
import { clearMemories, forget, listMemories, recall, remember } from './memory/long-term.js';
import { createTrigger, listenToTriggers, listTriggers, listTriggerTypes, showTriggerType } from './cli/triggers.js';
import { cancelCliJob, createCliJob, listCliJobs, runCliJob, showCliJob, showCliJobLogs, startCliJobListener, startCliJobWorker } from './cli/jobs.js';
import { initWorkspace } from './workspace/init.js';
import { workspaceLayout } from './workspace/paths.js';
import { runHeal } from './memory/heal.js';
import { runSwarmCli } from './cli/swarm.js';
import { printWelcomeScreen } from './cli/welcome.js';
import { startDefaultLauncher, startMainMenu } from './cli/menu.js';
import { printDoctorChecks } from './cli/health.js';
import { printAppsStatus } from './cli/apps.js';
import { printMemoryTable } from './cli/memory.js';
import { listVoiceDevices, printVoiceConfig, runTerminalVoiceLive, runVoiceAgentProbe, runVoiceDoctor, runVoiceSpeakTest, runVoiceTurn } from './cli/voice.js';
import { printVersionStatus, runSelfUpdate } from './cli/update.js';
import { captureCameraCli, listCameraDevicesCli, runCameraDoctorCli } from './cli/camera.js';
import { printModelBrowser } from './cli/models.js';
import { startChatListener } from './cli/chat.js';

type TextAgentFactory = () => { generate: (input: { prompt: string }) => Promise<{ text: string }> };

async function printResult(value: string | unknown) {
  if (typeof value === 'string') {
    printMarkdown(value);
  } else {
    printJson(value);
  }
}

async function runAgentText(agentFactory: TextAgentFactory, prompt: string) {
  requireGatewayAuth();
  const result = await agentFactory().generate({ prompt });
  await printResult(result.text);
}

function friendlyError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/AI_GATEWAY_API_KEY|VERCEL_OIDC_TOKEN|TAVILY_API_KEY|COMPOSIO_API_KEY|ZILMATE_USER_ID/.test(message)) return message;
  return `ZilMate failed: ${message}`;
}

const program = new Command();
program
  .name('zilmate')
  .description('ZilMate Agent')
  .version('1.7.5');

// -- Global Commands --

program.command('welcome').description('Show ZilMate dashboard').action(async () => {
  try { await printWelcomeScreen(); } catch (e) { printError(friendlyError(e)); process.exitCode = 1; }
});

program.command('version').description('Show version').action(async () => {
  try { await printVersionStatus(program.version() || 'unknown'); } catch (e) { printError(friendlyError(e)); process.exitCode = 1; }
});

program.command('update').option('--tag <tag>', 'npm tag', 'latest').option('--dry-run', 'dry run').description('Update ZilMate').action(async (o) => {
  try { await runSelfUpdate(o); } catch (e) { printError(friendlyError(e)); process.exitCode = 1; }
});

program.command('menu').description('Main menu').action(async () => {
  try { await startMainMenu(); } catch (e) { printError(friendlyError(e)); process.exitCode = 1; }
});

program.command('doctor').option('--live', 'live checks').option('-s, --session <id>', 'session', 'default').description('Diagnostics').action(async (o) => {
  try { printDoctorChecks(await runDoctor(o)); } catch (e) { printError(friendlyError(e)); process.exitCode = 1; }
});

program.command('config').description('Show config').action(async () => {
  try { printJson(await getResolvedConfigSummary()); } catch (e) { printError(friendlyError(e)); process.exitCode = 1; }
});

program.command('ping').description('Verify auth').action(async () => {
  try { requireGatewayAuth(); const r = await generateText({ model: models.help, prompt: 'Reply with exactly: ZilMate online' }); await printResult(r.text); } catch (e) { printError(friendlyError(e)); process.exitCode = 1; }
});

program.command('heal').description('Self-heal codebase').action(async () => {
  try { requireGatewayAuth(); await runHeal(); } catch (e) { printError(friendlyError(e)); process.exitCode = 1; }
});

// -- Setup Group --

const setup = program.command('setup').description('Configuration wizards');

setup.command('wizard').alias('run')
  .option('-p, --path <file>', 'env file', '.env').option('-f, --force', 'force').option('-y, --yes', 'yes')
  .description('Main setup wizard').action(async (o) => {
    try { await runSetup(o); } catch (e) { printError(friendlyError(e)); process.exitCode = 1; }
  });

setup.command('voice')
  .option('-p, --path <file>', 'env file', '.env').option('-f, --force', 'force')
  .description('Voice setup wizard').action(async (o) => {
    try { await runVoiceSetup(o); } catch (e) { printError(friendlyError(e)); process.exitCode = 1; }
  });

setup.command('chat')
  .option('-p, --path <file>', 'env file', '.env').option('-f, --force', 'force')
  .description('Chat setup wizard').action(async (o) => {
    try { await runChatSetup(o); } catch (e) { printError(friendlyError(e)); process.exitCode = 1; }
  });

// -- Agent Commands --

program.command('talk').option('-s, --session <id>', 'session', 'default').description('Interactive chat').action(async (o) => {
  try { await startInteractiveChat(o.session); } catch (e) { printError(friendlyError(e)); process.exitCode = 1; }
});

program.command('help').argument('<question...>', 'question').description('Quick help').action(async (q) => {
  try { await runAgentText(createQuickHelpAgent, q.join(' ')); } catch (e) { printError(friendlyError(e)); process.exitCode = 1; }
});

program.command('post').argument('<prompt...>', 'prompt').description('Copywriter').action(async (p) => {
  try { await runAgentText(createPostAgent, p.join(' ')); } catch (e) { printError(friendlyError(e)); process.exitCode = 1; }
});

program.command('research').argument('<query...>', 'query').description('Research').action(async (q) => {
  try { await runAgentText(createDocsResearchAgent, q.join(' ')); } catch (e) { printError(friendlyError(e)); process.exitCode = 1; }
});

program.command('image').argument('<prompt...>', 'prompt').option('-m, --model <model>', 'model', 'openai').option('--size <size>', 'size').description('Generate image').action(async (p, o) => {
  try { const r = await generateImageAsset(p.join(' '), { provider: o.model, ...(isImageSize(o.size) ? { size: o.size } : {}) }); await printResult(r); } catch (e) { printError(friendlyError(e)); process.exitCode = 1; }
});

program.command('swarm').argument('<task...>', 'task').option('-s, --session <id>', 'session', 'default').description('Swarm').action(async (t, o) => {
  try { requireGatewayAuth(); await runSwarmCli(t.join(' '), o); } catch (e) { printError(friendlyError(e)); process.exitCode = 1; }
});

program.command('manager').argument('<prompt...>', 'prompt').option('-s, --session <id>', 'session', 'default').description('Manager').action(async (p, o) => {
  try { requireGatewayAuth(); await printResult(await runManager(p.join(' '), { progress: printProgress, sessionId: o.session, confirm: createTerminalConfirmation() })); } catch (e) { printError(friendlyError(e)); process.exitCode = 1; }
});

// -- Voice Group --

const voice = program.command('voice').description('Voice features');

voice.command('enable').option('-p, --path <file>', 'env', '.env').action(async (o) => {
  try { await setVoiceEnabled(true, o); } catch (e) { printError(friendlyError(e)); process.exitCode = 1; }
});

voice.command('disable').option('-p, --path <file>', 'env', '.env').action(async (o) => {
  try { await setVoiceEnabled(false, o); } catch (e) { printError(friendlyError(e)); process.exitCode = 1; }
});

voice.command('turn').argument('<transcript...>', 'context').option('-s, --session <id>', 'session', 'default').action(async (t, o) => {
  try { await runVoiceTurn(t, o.session); } catch (e) { printError(friendlyError(e)); process.exitCode = 1; }
});

voice.command('devices').action(async () => {
  try { await listVoiceDevices(); } catch (e) { printError(friendlyError(e)); process.exitCode = 1; }
});

voice.command('live').option('-s, --session <id>', 'session', 'default').action(async (o) => {
  try { await runTerminalVoiceLive(o.session); } catch (e) { printError(friendlyError(e)); process.exitCode = 1; }
});

voice.command('speak-test').argument('<text...>', 'text').action(async (t) => {
  try { await runVoiceSpeakTest(t.join(' ')); } catch (e) { printError(friendlyError(e)); process.exitCode = 1; }
});

voice.command('agent-probe').action(async () => {
  try { await runVoiceAgentProbe(); } catch (e) { printError(friendlyError(e)); process.exitCode = 1; }
});

voice.command('doctor').action(async () => {
  try { await runVoiceDoctor(); } catch (e) { printError(friendlyError(e)); process.exitCode = 1; }
});

voice.command('config').action(async () => {
  try { printVoiceConfig(); } catch (e) { printError(friendlyError(e)); process.exitCode = 1; }
});

// -- Chat Group --

const chat = program.command('chat').description('Chat integrations');

chat.command('listen').description('Start listener').action(async () => {
  try { await startChatListener(); } catch (e) { printError(friendlyError(e)); process.exitCode = 1; }
});

chat.command('msg').argument('<message...>', 'message').description('Chat guide').action(async (m) => {
  try { await runAgentText(createChatAgent, m.join(' ')); } catch (e) { printError(friendlyError(e)); process.exitCode = 1; }
});

// -- Jobs Group --

const jobs = program.command('jobs').description('Background jobs');

jobs.command('worker').action(async () => {
  try { await startCliJobWorker(); } catch (e) { printError(friendlyError(e)); process.exitCode = 1; }
});

jobs.command('listen').option('-t, --tunnel', 'tunnel').option('-p, --port <number>', 'port', '8787').action(async (o) => {
  try { await startCliJobListener(o); } catch (e) { printError(friendlyError(e)); process.exitCode = 1; }
});

jobs.command('create').argument('<task...>', 'task').option('-s, --schedule <cron>', 'schedule').option('-a, --at <iso>', 'runAt').action(async (t, o) => {
  try { await createCliJob(t.join(' '), o); } catch (e) { printError(friendlyError(e)); process.exitCode = 1; }
});

jobs.command('list').option('-s, --status <status>', 'status').option('-l, --limit <number>', 'limit', '20').action(async (o) => {
  try { await listCliJobs(o); } catch (e) { printError(friendlyError(e)); process.exitCode = 1; }
});

jobs.command('status').argument('<id>', 'id').action(async (id) => {
  try { await showCliJob(id); } catch (e) { printError(friendlyError(e)); process.exitCode = 1; }
});

jobs.command('logs').argument('<id>', 'id').action(async (id) => {
  try { await showCliJobLogs(id); } catch (e) { printError(friendlyError(e)); process.exitCode = 1; }
});

jobs.command('run').argument('<id>', 'id').action(async (id) => {
  try { await runCliJob(id); } catch (e) { printError(friendlyError(e)); process.exitCode = 1; }
});

jobs.command('cancel').argument('<id>', 'id').action(async (id) => {
  try { await cancelCliJob(id); } catch (e) { printError(friendlyError(e)); process.exitCode = 1; }
});

// -- Memory Group --

const memory = program.command('memory').description('Long-term memory');

memory.command('list').action(async () => {
  try { printMemoryTable(await listMemories()); } catch (e) { printError(friendlyError(e)); process.exitCode = 1; }
});

memory.command('forget').argument('[id]', 'id').option('--all', 'all').action(async (id, o) => {
  try { if (o.all) { await clearMemories(); printJson({ cleared: true }); return; } if (!id) throw new Error('ID needed'); printJson({ id, deleted: await forget(id) }); } catch (e) { printError(friendlyError(e)); process.exitCode = 1; }
});

// -- Apps Group --

const apps = program.command('apps').description('Composio apps');

apps.command('status').option('-s, --session <id>', 'session', 'default').action(async (o) => {
  try { printAppsStatus(await getComposioStatus(o.session)); } catch (e) { printError(friendlyError(e)); process.exitCode = 1; }
});

// -- Triggers Group --

const triggers = program.command('triggers').description('Composio triggers');

triggers.command('types').argument('[toolkit]').option('-l, --limit <n>', 'limit', '25').option('--json', 'json').action(async (t, o) => {
  try { await listTriggerTypes(t, o); } catch (e) { printError(friendlyError(e)); process.exitCode = 1; }
});

triggers.command('info').argument('<trigger>').option('--json', 'json').action(async (t, o) => {
  try { await showTriggerType(t, o); } catch (e) { printError(friendlyError(e)); process.exitCode = 1; }
});

triggers.command('list').option('-l, --limit <n>', 'limit', '25').option('--show-disabled', 'disabled').option('--json', 'json').action(async (o) => {
  try { await listTriggers(o); } catch (e) { printError(friendlyError(e)); process.exitCode = 1; }
});

triggers.command('create').argument('<trigger>').option('--connected-account <id>', 'account').option('--config <json>', 'config').option('--dry-run', 'dry run').allowUnknownOption(true).allowExcessArguments(true).action(async (t, o, c) => {
  try { const u = c.args.filter((a) => a !== t); await createTrigger(t, o, u); } catch (e) { printError(friendlyError(e)); process.exitCode = 1; }
});

triggers.command('listen').option('--trigger <id>', 'id').option('--trigger-slug <slug...>', 'slugs').option('--toolkit <slug...>', 'toolkits').option('--connected-account <id>', 'account').option('--trigger-data <v>', 'data').option('--user-id <id>', 'user').option('--json', 'json').option('--once', 'once').action(async (o) => {
  try { await listenToTriggers(o); } catch (e) { printError(friendlyError(e)); process.exitCode = 1; }
});

// -- Camera Group --

const camera = program.command('camera').description('Camera tools');

camera.command('doctor').action(async () => {
  try { await runCameraDoctorCli(); } catch (e) { printError(friendlyError(e)); process.exitCode = 1; }
});

camera.command('list').action(async () => {
  try { await listCameraDevicesCli(); } catch (e) { printError(friendlyError(e)); process.exitCode = 1; }
});

camera.command('capture').option('-d, --device <id>', 'device').action(async (o) => {
  try { await captureCameraCli(o.device); } catch (e) { printError(friendlyError(e)); process.exitCode = 1; }
});

// -- Workspace & Models --

program.command('workspace').command('init').description('Init workspace').action(async () => {
  try { await initWorkspace(); console.log(`Workspace ready at ${workspaceLayout().root}`); } catch (e) { printError(friendlyError(e)); process.exitCode = 1; }
});

program.command('models').option('-p, --provider <p>', 'provider').option('-l, --limit <n>', 'limit', '20').option('--page <n>', 'page', '1').description('Browse models').action(async (o) => {
  try { requireGatewayAuth(); await printModelBrowser(o); } catch (e) { printError(friendlyError(e)); process.exitCode = 1; }
});

// -- Entry Point --

if (process.argv.length <= 2) {
  await initWorkspace().catch(() => undefined);
  await startDefaultLauncher();
} else {
  await initWorkspace().catch(() => undefined);
  await program.parseAsync(process.argv).catch((error) => {
    printError(friendlyError(error));
    process.exitCode = 1;
  });
}
