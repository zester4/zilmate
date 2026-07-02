import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { runManager } from '../agents/manager.js';
import { theme } from '../cli/theme.js';
import { spawn } from 'node:child_process';
import { existsSync, writeFileSync, rmSync, openSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../config/env.js';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PORT = env.zilmateDaemonPort;
let sessionToken = '';

function escapeXml(unsafe: string): string {
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
      default: return c;
    }
  });
}

/**
 * Triggers native OS notification toasts
 */
export function sendOsNotification(title: string, message: string) {
  const safeTitle = escapeXml(title);
  const safeMessage = escapeXml(message);

  if (process.platform === 'win32') {
    // Windows PowerShell Toast
    const psCommand = `
      [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
      [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
      $xml = @"
<toast>
    <visual>
        <binding template="ToastGeneric">
            <text>${safeTitle}</text>
            <text>${safeMessage}</text>
        </binding>
    </visual>
</toast>
"@
      $xmlDoc = [Windows.Data.Xml.Dom.XmlDocument]::New()
      $xmlDoc.LoadXml($xml)
      $toast = [Windows.UI.Notifications.ToastNotification]::new($xmlDoc)
      $notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe')
      $notifier.Show($toast)
    `;
    spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', psCommand], { stdio: 'ignore' });
  } else if (process.platform === 'darwin') {
    // macOS Notification Center
    const safeMacTitle = title.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const safeMacMessage = message.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const appleScript = `display notification "${safeMacMessage}" with title "${safeMacTitle}"`;
    spawn('osascript', ['-e', appleScript], { stdio: 'ignore' });
  }
}

const installations = new Map<string, { status: 'running' | 'success' | 'failed', output: string, error?: string }>();

let activeVoiceSession: {
  running: boolean;
  sessionId: string;
  events: any[];
  stop?: () => void;
} | null = null;

function runBackgroundInstall(action: string) {
  if (installations.get(action)?.status === 'running') {
    return;
  }
  installations.set(action, { status: 'running', output: 'Starting installation...\n' });
  
  let cmd = '';
  let args: string[] = [];
  
  if (action === 'playwright') {
    if (process.platform === 'win32') {
      cmd = 'npx.cmd';
    } else {
      cmd = 'npx';
    }
    args = ['playwright', 'install'];
  } else if (action === 'rembg') {
    cmd = 'pip';
    args = ['install', 'rembg[cpu]'];
  } else {
    installations.set(action, { status: 'failed', output: `Unknown action: ${action}` });
    return;
  }
  
  try {
    const child = spawn(cmd, args, { shell: true });
    
    child.stdout?.on('data', (data) => {
      const current = installations.get(action);
      if (current) {
        current.output += data.toString();
      }
    });
    
    child.stderr?.on('data', (data) => {
      const current = installations.get(action);
      if (current) {
        current.output += data.toString();
      }
    });
    
    child.on('error', (err) => {
      const current = installations.get(action);
      if (current) {
        current.status = 'failed';
        current.output += `\nError spawning process: ${err.message}`;
        current.error = err.message;
      }
    });
    
    child.on('close', (code) => {
      const current = installations.get(action);
      if (current) {
        if (code === 0) {
          current.status = 'success';
          current.output += '\n\nInstallation completed successfully! 🟢';
        } else {
          current.status = 'failed';
          current.output += `\n\nInstallation failed with code ${code} 🔴`;
          current.error = `Exit code ${code}`;
        }
      }
    });
  } catch (err: any) {
    installations.set(action, { status: 'failed', output: `Failed to spawn process: ${err.message}`, error: err.message });
  }
}

/**
 * Strips the @zilmate prefix if present and extracts clean prompt instructions
 */
export function parseUbiquityPrompt(text: string): { prompt: string; isTriggered: boolean } {
  const trimmed = text.trim();
  const triggerRegex = /^@zilmate\s*(?:rewrite\s+professionally\s*:\s*|rewrite\s*:\s*|answer\s+this\s*:\s*|answer\s*:\s*|:)?\s*([\s\S]+)$/i;
  const match = trimmed.match(triggerRegex);

  if (match && match[1] !== undefined) {
    return { prompt: match[1].trim(), isTriggered: true };
  }

  // Fallback: If it starts with @zilmate but doesn't match the specific modifiers
  if (trimmed.toLowerCase().startsWith('@zilmate')) {
    return { prompt: trimmed.slice(8).trim(), isTriggered: true };
  }

  return { prompt: trimmed, isTriggered: false };
}

export async function handleProcessRequest(req: IncomingMessage, res: ServerResponse) {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
  });

  req.on('end', async () => {
    try {
      const data = JSON.parse(body);
      const text = data.text || '';
      if (!text.trim()) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Text cannot be empty' }));
        return;
      }

      console.log(theme.muted(`[Ubiquity] Received text length: ${text.length}`));
      const { prompt, isTriggered } = parseUbiquityPrompt(text);

      sendOsNotification('ZilMate Ubiquity', 'Thinking... 🧠');

      const response = await runManager(prompt, {
        sessionId: 'ubiquity',
      });

      sendOsNotification('ZilMate Ubiquity', 'Response ready! 🚀');

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ result: response }));
    } catch (error) {
      console.error(theme.error('[Ubiquity] Error processing text:'), error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  });
}

export function startDaemon() {
  // Generate secure single-use CSRF defense token
  sessionToken = randomBytes(24).toString('hex');
  const tokenPath = join(homedir(), '.zilmate-token');
  try {
    writeFileSync(tokenPath, sessionToken, { encoding: 'utf8', mode: 0o600 });
  } catch {
    // Fallback if writing to homedir has permission issues
    try { writeFileSync('.zilmate-token', sessionToken, 'utf8'); } catch {}
  }

  // Cleanup on process terminations
  const cleanup = () => {
    try { rmSync(tokenPath); } catch {}
    try { rmSync('.zilmate-token'); } catch {}
  };
  process.on('exit', cleanup);
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  const server = createServer(async (req, res) => {
    // Add simple CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    let pathname = url.pathname;

    // 1. Static file serving (no authentication needed for standard resources)
    if (pathname === '/') {
      pathname = '/index.html';
    }
    if (pathname === '/index.html' || pathname === '/styles.css' || pathname === '/script.js') {
      const filePath = join(__dirname, '../../webcli/html', pathname);
      try {
        const content = await readFile(filePath, 'utf8');
        const ext = pathname.slice(pathname.lastIndexOf('.'));
        const mimeTypes: Record<string, string> = {
          '.html': 'text/html',
          '.css': 'text/css',
          '.js': 'text/javascript',
        };
        res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
        res.end(content);
        return;
      } catch (err) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'File Not Found' }));
        return;
      }
    }

    // 2. Unauthenticated status ping (used to check if daemon is active)
    if (req.method === 'GET' && pathname === '/api/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', version: '3.5.0' }));
      return;
    }

    // CSRF & Cross-Origin Security: Require Authorization header matching local sessionToken or webhook secret
    const authHeader = req.headers['authorization'];
    const webhookSecret = env.zilmateJobWebhookSecret;
    const isWebhookAuth = webhookSecret && authHeader === `Bearer ${webhookSecret}`;
    const isSessionAuth = authHeader === `Bearer ${sessionToken}`;

    if (!authHeader || (!isSessionAuth && !isWebhookAuth)) {
      console.warn(theme.error('[Ubiquity] CSRF/Unauthorized request blocked from origin:'), req.headers['origin']);
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized: Local session token or webhook secret mismatch' }));
      return;
    }

    // 3. Authenticated process & API endpoints
    if (req.method === 'POST' && pathname === '/process') {
      await handleProcessRequest(req, res);
      return;
    }

    if (req.method === 'POST' && pathname === '/api/webhooks/listeners') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const data = JSON.parse(body || '{}');
          
          // Construct standard trigger payload complying with IncomingTriggerPayload
          const eventId = data.id || `evt_${randomBytes(8).toString('hex')}`;
          const eventUuid = data.uuid || eventId;
          const triggerSlug = data.triggerSlug || 'custom_webhook_event';
          const toolkitSlug = data.toolkitSlug || 'custom_webhook';
          const userId = data.userId || 'system';
          const payload = data.payload || data;

          const event = {
            id: eventId,
            uuid: eventUuid,
            triggerSlug,
            toolkitSlug,
            userId,
            payload,
            metadata: {
              id: eventId,
              uuid: eventUuid,
              triggerSlug,
              toolkitSlug,
              triggerConfig: data.triggerConfig || {},
              triggerData: data.triggerData || undefined,
              connectedAccount: data.connectedAccount || {
                status: 'ACTIVE',
                authConfigUUID: 'system-auth',
              },
            }
          };

          const { classifyTriggerWithContext, buildOrchestrationPlanWithRouting } = await import('../jobs/trigger-router.js');
          const { orchestrateComposioTrigger } = await import('../jobs/trigger-orchestrator.js');
          const { runJob } = await import('../jobs/runner.js');

          // Build dynamic routing plan
          const plan = await buildOrchestrationPlanWithRouting(event as any);
          
          // Queue jobs in DB
          const queuedJobs = await orchestrateComposioTrigger(event as any, { plan });

          // Execute immediate jobs in background
          for (const job of queuedJobs) {
            if (!job.schedule) {
              runJob(job.id, { rescheduleRecurring: true }).catch((err) => {
                console.error(`[Webhook Background Runner] Job ${job.id} failed:`, err);
              });
            }
          }

          res.writeHead(202, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            status: 'accepted',
            chainId: plan.chainId,
            priority: plan.priority,
            route: plan.route,
            category: plan.category,
            reasoning: plan.reasoning,
            queuedJobs: queuedJobs.map((j) => ({ id: j.id, task: j.task, status: j.status }))
          }));
        } catch (error) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
        }
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/chat/history') {
      try {
        const sessionId = url.searchParams.get('sessionId') || 'web-session';
        const { loadTurns } = await import('../memory/history.js');
        const turns = await loadTurns(sessionId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ turns }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(err) }));
      }
      return;
    }

    if (req.method === 'POST' && pathname === '/api/chat/clear') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const { sessionId = 'web-session' } = JSON.parse(body);
          const { saveTurns } = await import('../memory/history.js');
          await saveTurns(sessionId, []);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: String(err) }));
        }
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/chat') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const { message, sessionId = 'web-session' } = JSON.parse(body);
          if (!message || !message.trim()) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Message is required' }));
            return;
          }

          // Dynamically import history and memory tools to prevent circular dependencies
          const { loadTurns, saveTurns } = await import('../memory/history.js');
          const { recall } = await import('../memory/long-term.js');

          const turns = await loadTurns(sessionId);

          const transcriptText = turns.length === 0 ? '' : turns
            .slice(-10)
            .map((turn) => `${turn.role === 'user' ? 'User' : 'ZilMate'}: ${turn.content}`)
            .join('\n');

          const memories = await recall(message, 6).catch(() => []);
          const memoryText = memories.length === 0 ? '' : memories
            .map((m: any) => `- [${m.id}] ${m.text}${m.tags?.length ? ` (tags: ${m.tags.join(', ')})` : ''}`)
            .join('\n');

          const promptInstruction = 'Answer as ZilMate. Delegate to subagents when useful and return a concise final answer.';
          const prompt = transcriptText
            ? `Conversation so far:\n${transcriptText}\n\n${memoryText ? `Relevant long-term memory:\n${memoryText}\n\n` : ''}New user message:\n${message}\n\n${promptInstruction}`
            : `${memoryText ? `Relevant long-term memory:\n${memoryText}\n\n` : ''}${message}\n\n${promptInstruction}`;

          const response = await runManager(prompt, { sessionId });

          turns.push(
            { role: 'user', content: message, createdAt: new Date().toISOString() },
            { role: 'assistant', content: response, createdAt: new Date().toISOString() }
          );
          await saveTurns(sessionId, turns);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ result: response }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: String(err) }));
        }
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/swarm') {
      try {
        const { specialistRegistry } = await import('../agents/swarm/registry.js');
        const list = Object.entries(specialistRegistry).map(([key, config]) => ({
          key,
          name: config.name,
          department: config.department,
          composioToolkits: config.composioToolkits,
          tools: Object.keys(config.tools || {}),
        }));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ specialists: list }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(err) }));
      }
      return;
    }

    if (req.method === 'GET' && pathname === '/api/traces') {
      try {
        const { workspaceLayout } = await import('../workspace/paths.js');
        const file = join(workspaceLayout().logs, 'swarm-traces.jsonl');
        const spans: any[] = [];
        try {
          const content = await readFile(file, 'utf8');
          for (const line of content.split('\n')) {
            if (!line.trim()) continue;
            try { spans.push(JSON.parse(line)); } catch {}
          }
        } catch {}
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ traces: spans }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(err) }));
      }
      return;
    }

    if (req.method === 'GET' && pathname === '/api/apps') {
      try {
        const { getComposioStatus } = await import('../tools/composio.tool.js');
        const status = await getComposioStatus('default');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(status));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(err) }));
      }
      return;
    }

    if (req.method === 'GET' && pathname === '/api/mcp') {
      try {
        const { loadMCPConfig } = await import('../tools/mcp.tool.js');
        const mcpConfig = await loadMCPConfig();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(mcpConfig));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(err) }));
      }
      return;
    }

    if (req.method === 'GET' && pathname === '/api/skills') {
      try {
        const { discoverSkills } = await import('../skills/loader.js');
        const skills = await discoverSkills();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ skills }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(err) }));
      }
      return;
    }

    if (req.method === 'GET' && pathname === '/api/triggers') {
      try {
        const { getComposioTriggerClient } = await import('../cli/triggers.js');
        const client = getComposioTriggerClient();
        const response = await client.triggers.listActive({ limit: 25 });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ items: response.items }));
      } catch (err) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ items: [] }));
      }
      return;
    }

    if (req.method === 'GET' && pathname === '/api/jobs') {
      try {
        const { listJobs } = await import('../jobs/store.js');
        const jobs = await listJobs();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jobs }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(err) }));
      }
      return;
    }

    if (req.method === 'GET' && pathname === '/api/memory') {
      try {
        const { listMemories } = await import('../memory/long-term.js');
        const memories = await listMemories();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ memories }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(err) }));
      }
      return;
    }

    if (req.method === 'GET' && pathname === '/api/wiki') {
      try {
        const { queryWiki } = await import('../memory/corporate-wiki.js');
        const query = url.searchParams.get('q') || '';
        const facts = await queryWiki(query, 25);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ facts }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(err) }));
      }
      return;
    }

    if (req.method === 'GET' && pathname === '/api/camera') {
      try {
        const { listCameraDevices, runCameraDoctor } = await import('../tools/desktop.tool.js');
        const devices = await listCameraDevices();
        const checks = await runCameraDoctor();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ devices, checks }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(err) }));
      }
      return;
    }

    if (req.method === 'GET' && pathname === '/api/doctor') {
      try {
        const { runDoctor } = await import('../cli/doctor.js');
        const checks = await runDoctor({ live: false, sessionId: 'web-session' });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          checks, 
          installations: Object.fromEntries(installations.entries()) 
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(err) }));
      }
      return;
    }

    if (req.method === 'POST' && pathname === '/api/doctor/config') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const { key, value } = JSON.parse(body);
          if (!key) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'key is required' }));
            return;
          }
          
          const { resolveEnvPath, readEnvValues, writeEnvValues } = await import('../cli/setup.js');
          const envPath = resolveEnvPath();
          const values = await readEnvValues(envPath);
          values.set(key, value || '');
          await writeEnvValues(envPath, values, { merge: true, touchedKeys: new Set([key]) });
          
          // Dynamically update process.env and config properties
          process.env[key] = value || '';
          const { env: configEnv } = await import('../config/env.js');
          
          if (key === 'AI_GATEWAY_API_KEY') configEnv.aiGatewayApiKey = value;
          if (key === 'VERCEL_OIDC_TOKEN') configEnv.vercelOidcToken = value;
          if (key === 'TAVILY_API_KEY') configEnv.tavilyApiKey = value;
          if (key === 'COMPOSIO_API_KEY') configEnv.composioApiKey = value;
          if (key === 'ZILMATE_USER_ID') configEnv.zilmateUserId = value;
          if (key === 'UPSTASH_REDIS_REST_URL') configEnv.upstashRedisRestUrl = value;
          if (key === 'UPSTASH_REDIS_REST_TOKEN') configEnv.upstashRedisRestToken = value;
          if (key === 'ZILMATE_JOBS_ENABLED') configEnv.zilmateJobsEnabled = value === 'true';
          if (key === 'UPSTASH_QSTASH_TOKEN') configEnv.upstashQstashToken = value;
          if (key === 'ZILMATE_PUBLIC_JOB_WEBHOOK_URL') configEnv.zilmatePublicJobWebhookUrl = value;
          if (key === 'ZILMATE_JOB_WEBHOOK_SECRET') configEnv.zilmateJobWebhookSecret = value;
          if (key === 'ZILMATE_TRIGGER_WORKFLOWS_ENABLED') configEnv.zilmateTriggerWorkflowsEnabled = value === 'true';
          if (key === 'DEEPGRAM_API_KEY') configEnv.deepgramApiKey = value;
          if (key === 'ZILMATE_VOICE_ENABLED') configEnv.zilmateVoiceEnabled = value === 'true';
          if (key === 'SLACK_BOT_TOKEN') configEnv.slackBotToken = value;
          if (key === 'TELEGRAM_BOT_TOKEN') configEnv.telegramBotToken = value;
          if (key === 'CHAT_INTEGRATION_ENABLED') configEnv.chatIntegrationEnabled = value === 'true';
          if (key === 'SUPERMEMORY_API_KEY') configEnv.supermemoryApiKey = value;
          if (key === 'UPSTASH_VECTOR_REST_URL') configEnv.upstashVectorRestUrl = value;
          if (key === 'UPSTASH_VECTOR_REST_TOKEN') configEnv.upstashVectorRestToken = value;
          if (key === 'CORPORATE_WIKI_PROVIDER') configEnv.corporateWikiProvider = value;

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: String(err) }));
        }
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/doctor/fix') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const { action } = JSON.parse(body);
          if (!action || (action !== 'playwright' && action !== 'rembg')) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Valid action (playwright or rembg) is required' }));
            return;
          }
          
          runBackgroundInstall(action);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, status: installations.get(action)?.status }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: String(err) }));
        }
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/doctor/fix-status') {
      try {
        const action = url.searchParams.get('action') || '';
        if (!action) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'action parameter is required' }));
          return;
        }
        
        const status = installations.get(action) || { status: 'not_started', output: '' };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(status));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(err) }));
      }
      return;
    }

    if (req.method === 'GET' && pathname === '/api/voice/status') {
      try {
        const { getVoiceConfig, checkVoiceRuntime } = await import('../voice/deepgram.js');
        const { checkTerminalVoiceRuntime, listTerminalVoiceInputDevices } = await import('../voice/terminal.js');
        
        const config = getVoiceConfig();
        const voiceChecks = await checkVoiceRuntime();
        const termChecks = await checkTerminalVoiceRuntime();
        const checks = [...voiceChecks, ...termChecks];
        const devices = await listTerminalVoiceInputDevices().catch(() => []);
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          config,
          checks,
          devices,
          activeSession: activeVoiceSession ? {
            running: activeVoiceSession.running,
            sessionId: activeVoiceSession.sessionId,
            events: activeVoiceSession.events
          } : { running: false, sessionId: '', events: [] }
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(err) }));
      }
      return;
    }

    if (req.method === 'POST' && pathname === '/api/voice/config') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const { key, value } = JSON.parse(body);
          if (!key) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'key is required' }));
            return;
          }
          
          const { resolveEnvPath, readEnvValues, writeEnvValues } = await import('../cli/setup.js');
          const envPath = resolveEnvPath();
          const values = await readEnvValues(envPath);
          values.set(key, value || '');
          await writeEnvValues(envPath, values, { merge: true, touchedKeys: new Set([key]) });
          
          // Dynamically update process.env and config properties
          process.env[key] = value || '';
          const { env: configEnv } = await import('../config/env.js');
          
          if (key === 'DEEPGRAM_API_KEY') configEnv.deepgramApiKey = value;
          if (key === 'ZILMATE_VOICE_ENABLED') configEnv.zilmateVoiceEnabled = value === 'true';
          if (key === 'ZILMATE_VOICE_INPUT_DEVICE') configEnv.zilmateVoiceInputDevice = value;
          if (key === 'ZILMATE_VOICE_LISTEN_MODEL') configEnv.zilmateVoiceListenModel = value;
          if (key === 'ZILMATE_VOICE_TTS_MODEL') configEnv.zilmateVoiceTtsModel = value;
          if (key === 'ZILMATE_VOICE_LANGUAGE') configEnv.zilmateVoiceLanguage = value;

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: String(err) }));
        }
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/voice/speak-test') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const { text } = JSON.parse(body);
          if (!text) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'text is required' }));
            return;
          }
          
          const { playTerminalSpeech } = await import('../voice/terminal.js');
          
          // Speak in background
          playTerminalSpeech(text).catch(err => {
            console.error('[Speak Test Error]', err);
          });
          
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: String(err) }));
        }
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/voice/start-session') {
      try {
        if (activeVoiceSession && activeVoiceSession.running) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, sessionId: activeVoiceSession.sessionId, message: 'Session already running' }));
          return;
        }

        const sessionId = 'web-voice-session';
        const events: any[] = [{
          type: 'status',
          label: 'Session starting...',
          timestamp: new Date().toISOString()
        }];
        let stopFn: (() => void) | undefined;

        activeVoiceSession = {
          running: true,
          sessionId,
          events,
          stop: () => {
            if (stopFn) {
              try { stopFn(); } catch {}
            }
          }
        };

        // Run the voice agent in the background so it doesn't block the request!
        const runBackgroundVoice = async () => {
          const { startTerminalVoiceSession } = await import('../voice/terminal.js');
          await startTerminalVoiceSession({
            sessionId,
            onEvent: (event) => {
              events.push(event);
              if (events.length > 500) events.shift();
            },
            onStopPrompt: (stop) => {
              stopFn = stop;
            },
            onUserTranscript: async (text) => {
              const { loadTurns, saveTurns } = await import('../memory/history.js');
              const { recall } = await import('../memory/long-term.js');
              
              let turns = await loadTurns(sessionId);
              const transcriptContext = turns.length === 0 ? '' : turns
                .slice(-12)
                .map((turn) => `${turn.role === 'user' ? 'User' : 'ZilMate'}: ${turn.content}`)
                .join('\n');
              
              const relevantMemory = await recall(text, 6).catch(() => []);
              const memoryText = relevantMemory.length === 0 ? '' : relevantMemory
                .map((m: any) => `- [${m.id}] ${m.text}${m.tags?.length ? ` (tags: ${m.tags.join(', ')})` : ''}`)
                .join('\n');
                
              const contextBlock = [
                transcriptContext ? `Conversation so far in this same session:\n${transcriptContext}` : '',
                memoryText ? `Relevant long-term memory:\n${memoryText}` : '',
              ].filter(Boolean).join('\n\n');
              
              const { runManager } = await import('../agents/manager.js');
              const prompt = `${contextBlock ? `${contextBlock}\n\n` : ''}New user voice message:\n${text}\n\nVoice response rules:
- You are currently inside ZilMate realtime voice mode. The user is speaking to you and you can answer out loud.
- Current capabilities include: spoken replies, shared text/voice session history, long-term memory, background jobs and schedules, Composio app tools/triggers, web/docs research, time/date tools, local file tools, clipboard, screenshots, camera/photo analysis, image generation, and specialist subagents.
- If asked what tools/features you lack, do not say you lack voice, memory, tools, or app integrations. Mention genuine future gaps only.
- Answer as ZilMate in a natural spoken style.
- Keep the first response short: usually 1 to 3 sentences.
- Ask one clear follow-up if the request is vague.
- Do not use markdown bullets, long menus, emojis, or internal debug details unless the user asks.
- Do not mention specific product/domain names unless the user asked about them or they are necessary.
- If the user asks what you were doing earlier, where you left off, or to continue, use the conversation-so-far block first, then memory/scratchpad, before saying you do not remember.
- You may use your tools and subagents when useful, but keep the spoken answer concise.
- When a tool needs permission, the user can say yes, no, or session — they do not need to type.`;

              const reply = await runManager(prompt, { sessionId });
              
              // Process and clean speech formatting
              const cleanSpokenText = (text: string) => text.replace(/[🛠️✨🚀✅❌⚠️]/g, '').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/\n{3,}/g, '\n\n').trim();
              const cleaned = cleanSpokenText(reply);
              
              turns.push(
                { role: 'user', content: text, createdAt: new Date().toISOString() },
                { role: 'assistant', content: cleaned, createdAt: new Date().toISOString() }
              );
              await saveTurns(sessionId, turns);
              return cleaned;
            }
          });
        };

        runBackgroundVoice()
          .then(() => {
            if (activeVoiceSession) {
              activeVoiceSession.running = false;
              activeVoiceSession.events.push({
                type: 'status',
                label: 'Voice session finished',
                timestamp: new Date().toISOString()
              });
            }
          })
          .catch((err) => {
            if (activeVoiceSession) {
              activeVoiceSession.running = false;
              activeVoiceSession.events.push({
                type: 'error',
                message: `Voice session failed: ${err.message}`,
                timestamp: new Date().toISOString()
              });
            }
          });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, sessionId }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(err) }));
      }
      return;
    }

    if (req.method === 'POST' && pathname === '/api/voice/stop-session') {
      try {
        if (activeVoiceSession) {
          activeVoiceSession.stop?.();
          activeVoiceSession.running = false;
          activeVoiceSession.events.push({
            type: 'status',
            label: 'Voice session stopped by user',
            timestamp: new Date().toISOString()
          });
        }
        
        const { abortTerminalSpeech } = await import('../voice/terminal.js');
        abortTerminalSpeech();
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(err) }));
      }
      return;
    }

    if (req.method === 'GET' && pathname === '/api/models') {
      try {
        const { getModelAvailability } = await import('../config/models.js');
        const selection = await getModelAvailability();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(selection));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(err) }));
      }
      return;
    }

    if (req.method === 'POST' && pathname === '/api/models') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const { role, modelId } = JSON.parse(body);
          if (!role || !modelId) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'role and modelId are required' }));
            return;
          }
          const { saveModelSelection } = await import('../config/model-store.js');
          await saveModelSelection(role, modelId);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: String(err) }));
        }
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found' }));
  });

  server.listen(PORT, '127.0.0.1', () => {
    console.log(theme.ok(`[Ubiquity] ZilMate Daemon listening on http://127.0.0.1:${PORT}`));
    sendOsNotification('ZilMate Daemon', 'ZilMate Ubiquity Service Started 🟢');
  });

  // Start keyboard listener on Windows
  if (process.platform === 'win32') {
    const listenerPath = join(__dirname, 'win-listener.ps1');
    if (existsSync(listenerPath)) {
      console.log(theme.muted(`[Ubiquity] Launching Windows Hotkey Listener at ${listenerPath}...`));
      const logPath = join(homedir(), '.zilmate-listener-error.log');
      let stdioOption: any = 'ignore';
      try {
        const logFile = openSync(logPath, 'a');
        stdioOption = ['ignore', logFile, logFile];
      } catch {
        // Fallback
      }

      const psArgs = [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy', 'Bypass',
        '-WindowStyle', 'Hidden',
        '-Sta',
        '-File', `"${listenerPath}"`,
        '-Port', PORT.toString(),
        '-Token', `"${sessionToken}"`
      ];
      const cmdString = `powershell ${psArgs.join(' ')}`;

      const ps = spawn(cmdString, {
        detached: true,
        shell: true,
        windowsHide: true,
        stdio: stdioOption
      });

      ps.on('error', (err) => {
        console.error(theme.error('[Ubiquity] Failed to start keyboard listener:'), err);
      });
      ps.on('exit', (code, signal) => {
        console.warn(theme.warn(`[Ubiquity] Keyboard listener exited with code ${code} and signal ${signal}`));
      });

      ps.unref();
    } else {
      console.warn(theme.warn(`[Ubiquity] Warning: win-listener.ps1 not found at ${listenerPath}`));
    }
  }
}

