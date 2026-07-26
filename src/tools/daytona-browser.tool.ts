import { tool } from 'ai';
import { z } from 'zod';
import { Daytona, type Sandbox } from '@daytona/sdk';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { requestConfirmation } from '../runtime/confirm.js';
import { emitProgress } from '../runtime/progress.js';

/**
 * Daytona Browser-Use Tool
 *
 * Runs real Playwright browser automation INSIDE an isolated Daytona sandbox —
 * not on your local machine. This means:
 *   - Login sessions, cookies, and downloaded files never touch your laptop
 *   - You can run untrusted/scraping-heavy workloads with zero blast radius
 *   - Sandboxes are full Linux VMs — Chromium runs headless (or headed) inside them
 *   - Daytona's native `computerUse` interface additionally gives mouse/keyboard/
 *     screenshot control of the sandbox's own desktop — useful as a fallback when
 *     a site defeats Playwright selectors (canvas-based UIs, captchas, native
 *     dialogs) or when you want the agent to literally "look" at a live desktop.
 *
 * Verified against Daytona's official TypeScript SDK docs (daytona.io/docs):
 *   - Package name is `@daytona/sdk` (the old `@daytona/sdk` name was renamed;
 *     the API is unchanged, just re-published under this scope).
 *   - `daytona.create(params?)` takes CreateSandboxParams: no literal `ephemeral`
 *     flag exists — short-lived sandboxes are created via `autoDeleteInterval`
 *     (minutes until the sandbox is permanently deleted after stopping) combined
 *     with `autoStopInterval` (minutes of inactivity before auto-stop). This
 *     tool corrects the earlier (invalid) `{ ephemeral: true }` usage.
 *   - `sandbox.process.codeRun(code, options?, timeoutSeconds?)` returns
 *     `{ exitCode, result, artifacts: { stdout, charts } }`.
 *   - `sandbox.process.executeCommand(command, cwd?, env?, timeoutSeconds?)`
 *     runs a raw shell command and returns `{ exitCode, result }`.
 *   - `sandbox.fs.uploadFile(buffer, remotePath, timeout?)` and
 *     `sandbox.fs.downloadFile(remotePath, timeout?)` move bytes in/out of the
 *     sandbox filesystem (Buffer in, Buffer out — loads fully into memory, so
 *     it's meant for small/medium files like screenshots, cookies, CSVs).
 *   - `sandbox.computerUse` exposes native desktop automation (mouse, keyboard,
 *     screenshot) inside the sandbox's own display — independent of Playwright.
 *   - Preview URLs for any port a process listens on come from
 *     `sandbox.getPreviewLink(port)`, backed by
 *     `GET /sandbox/{id}/ports/{port}/preview-url`.
 *
 * Architecture:
 *   1. getOrCreateBrowserSandbox — reuses one warm sandbox across calls (fast),
 *      or spins up a short-lived one for isolated one-off tasks.
 *   2. browserNavigate / browserAction / browserRunScript / browserExtract /
 *      browserScreenshot / browserDownloadFile / browserUploadFile — Playwright-
 *      driven page automation, each running a small Python script via
 *      sandbox.process.codeRun().
 *   3. computerUseScreenshot / computerUseClick / computerUseType /
 *      computerUseHotkey — native desktop-level fallback automation via
 *      sandbox.computerUse, for when Playwright selectors aren't enough.
 *   4. getBrowserPreviewUrl — exposes a live, human-viewable URL for a
 *      non-headless session (e.g. a VNC/noVNC server) so the user can watch.
 *   5. closeBrowserSandbox — tears down the sandbox when done (saves cost).
 *
 * Requires DAYTONA_API_KEY in env. Get one free at app.daytona.io.
 */

let daytonaClient: Daytona | null = null;
let warmSandbox: Sandbox | null = null;
let warmSandboxId: string | null = null;

const outputDir = path.resolve('outputs', 'daytona-browser');

async function ensureOutputDir() {
  await mkdir(outputDir, { recursive: true });
  return outputDir;
}

function ts() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function getClient(): Daytona {
  if (!daytonaClient) {
    if (!process.env.DAYTONA_API_KEY) {
      throw new Error('DAYTONA_API_KEY is not set. Get a free key at https://app.daytona.io and add it to your .env.');
    }
    daytonaClient = new Daytona({ apiKey: process.env.DAYTONA_API_KEY });
  }
  return daytonaClient;
}

async function confirmBrowserAction(action: string, details: string[]) {
  return requestConfirmation({
    toolkitSlug: 'ZILMATE',
    toolSlug: 'DAYTONA_BROWSER',
    action,
    access: 'Read-only',
    targetTools: ['ZILMATE_DAYTONA_BROWSER'],
    details: details.filter(Boolean),
    summary: details.filter(Boolean).join('; '),
  });
}

/**
 * The Playwright bootstrap script every page-automation action builds on.
 * Persists browser state across calls in the same sandbox via a JSON
 * "session file" written to /tmp — sandbox.process.codeRun() is stateless
 * between invocations (each call is a fresh Python process), so we re-launch
 * Chromium and reattach to the same storage_state each time to keep
 * cookies/login alive across separate tool calls.
 */
function playwrightScript(body: string, opts: { headless?: boolean; storageStatePath?: string } = {}): string {
  const headless = opts.headless ?? true;
  const storagePath = opts.storageStatePath ?? '/tmp/zilmate-browser-state.json';
  return `
import json, os, sys
from playwright.sync_api import sync_playwright

STORAGE_PATH = "${storagePath}"

with sync_playwright() as p:
    browser = p.chromium.launch(
        headless=${headless ? 'True' : 'False'},
        args=["--no-sandbox", "--disable-dev-shm-usage"] if not ${headless ? 'True' : 'False'} else None,
    )
    context_kwargs = {"accept_downloads": True}
    if os.path.exists(STORAGE_PATH):
        context_kwargs["storage_state"] = STORAGE_PATH
    context = browser.new_context(**context_kwargs, viewport={"width": 1440, "height": 900})
    page = context.new_page()

    result = {}
    error = None
    try:
${body.split('\n').map((l) => '        ' + l).join('\n')}
    except Exception as e:
        error = str(e)
    finally:
        # Persist cookies/session for next call, even on error
        try:
            context.storage_state(path=STORAGE_PATH)
        except Exception:
            pass
        browser.close()

    if error:
        result["__error__"] = error

    print("ZILMATE_RESULT_START")
    print(json.dumps(result, default=str))
    print("ZILMATE_RESULT_END")
`.trim();
}

function extractResult(output: string): Record<string, unknown> {
  const start = output.indexOf('ZILMATE_RESULT_START');
  const end = output.indexOf('ZILMATE_RESULT_END');
  if (start === -1 || end === -1) {
    return { raw: output.slice(-2000) };
  }
  const jsonStr = output.slice(start + 'ZILMATE_RESULT_START'.length, end).trim();
  try {
    const parsed = JSON.parse(jsonStr);
    if (parsed.__error__) {
      throw new Error(`Playwright script error: ${parsed.__error__}`);
    }
    return parsed;
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('Playwright script error')) throw e;
    return { raw: jsonStr };
  }
}

// ─── Sandbox lifecycle ────────────────────────────────────────────────────────

export const sandboxLifecycleTools = {
  getOrCreateBrowserSandbox: tool({
    description:
      'Create or reuse a warm Daytona sandbox with Playwright + Chromium installed, ready for browser automation. Call this once at the start of a browsing task. Reuses the same sandbox across calls in this session so login cookies persist, unless shortLived=true.',
    inputSchema: z.object({
      shortLived: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          'If true, always creates a fresh isolated sandbox that auto-deletes shortly after it stops, instead of reusing the warm one. Use for untrusted/one-off scraping tasks you do not want lingering.',
        ),
      domainAllowList: z
        .array(z.string())
        .optional()
        .describe(
          'Restrict outbound network to only these domains (e.g. ["*.example.com", "accounts.google.com"]) — use for sensitive or untrusted browsing tasks so the sandbox literally cannot reach anywhere else.',
        ),
      blockAllNetwork: z
        .boolean()
        .optional()
        .default(false)
        .describe('Block all outbound network. Only useful combined with a later setBrowserNetworkLimits call, or for local-only file work.'),
    }),
    execute: async ({ shortLived, domainAllowList, blockAllNetwork }) => {
      const approved = await confirmBrowserAction('Create Daytona browser sandbox', [
        shortLived ? 'Short-lived sandbox — auto-deletes shortly after stopping' : 'Reusable sandbox — persists across calls this session',
        'Installs Playwright + Chromium inside an isolated cloud VM',
        domainAllowList?.length ? `Restricted to domains: ${domainAllowList.join(', ')}` : '',
      ]);
      if (!approved) throw new Error('Blocked sandbox creation. Ask user to approve.');

      const daytona = getClient();

      if (!shortLived && warmSandbox && warmSandboxId) {
        emitProgress({ type: 'tool:end', label: 'Reusing existing browser sandbox', detail: warmSandboxId });
        return { sandboxId: warmSandboxId, reused: true };
      }

      emitProgress({ type: 'tool:start', label: 'Creating Daytona sandbox' });

      // NOTE: Daytona's CreateSandboxParams has no boolean "ephemeral" field.
      // Short-lived behavior is achieved with autoStopInterval (minutes idle
      // before auto-stop) + autoDeleteInterval (minutes after stop before
      // permanent deletion). Setting both low gives effectively ephemeral
      // sandboxes without leaking compute cost if we forget to close one.
      const createParams = {
        ...(shortLived ? { autoStopInterval: 10, autoDeleteInterval: 5 } : { autoStopInterval: 30 }),
        ...(domainAllowList?.length ? { domainAllowList: domainAllowList.join(',') } : {}),
        ...(blockAllNetwork ? { networkBlockAll: true } : {}),
        labels: { 'zilmate.io/purpose': 'browser-automation' },
      };
      const sandbox = await daytona.create(createParams);

      emitProgress({ type: 'tool:start', label: 'Installing Playwright + Chromium', detail: sandbox.id });

      const install = await sandbox.process.executeCommand(
        'pip install playwright >/tmp/pw-install.log 2>&1 && playwright install --with-deps chromium >>/tmp/pw-install.log 2>&1 && echo DONE',
        undefined,
        undefined,
        180,
      );

      if (!install.result?.includes('DONE')) {
        throw new Error(`Playwright install failed in sandbox: ${install.result?.slice(-500)}`);
      }

      if (!shortLived) {
        warmSandbox = sandbox;
        warmSandboxId = sandbox.id;
      }

      emitProgress({ type: 'tool:end', label: 'Browser sandbox ready', detail: sandbox.id });
      return { sandboxId: sandbox.id, reused: false, shortLived };
    },
  }),

  setBrowserNetworkLimits: tool({
    description:
      'Update the outbound network restrictions on the active browser sandbox without recreating it — e.g. lock it down to only the domains needed for a login flow, or lift restrictions afterward.',
    inputSchema: z.object({
      domainAllowList: z.array(z.string()).optional().describe('Comma-list of allowed domains, e.g. ["*.example.com"]. Omit to leave unchanged.'),
      networkAllowList: z.array(z.string()).optional().describe('Allowed CIDR ranges, e.g. ["10.0.0.0/24"]. Omit to leave unchanged.'),
      blockAll: z.boolean().optional().describe('Block all outbound network entirely.'),
    }),
    execute: async ({ domainAllowList, networkAllowList, blockAll }) => {
      const approved = await confirmBrowserAction('Update sandbox network limits', [
        domainAllowList?.length ? `Domains: ${domainAllowList.join(', ')}` : '',
        networkAllowList?.length ? `CIDR: ${networkAllowList.join(', ')}` : '',
        blockAll ? 'Block all network' : '',
      ]);
      if (!approved) throw new Error('Blocked network update. Ask user to approve.');

      const sandbox = getActiveSandbox();
      emitProgress({ type: 'tool:start', label: 'Updating sandbox network limits' });

      const res = await (sandbox as any).setNetworkLimits({
        ...(domainAllowList?.length ? { domainAllowList: domainAllowList.join(',') } : {}),
        ...(networkAllowList?.length ? { networkAllowList: networkAllowList.join(',') } : {}),
        ...(blockAll !== undefined ? { networkBlockAll: blockAll } : {}),
      });

      emitProgress({ type: 'tool:end', label: 'Network limits updated' });
      return res;
    },
  }),

  closeBrowserSandbox: tool({
    description: 'Stop and release the warm browser sandbox to stop incurring compute cost. Call when a browsing task is fully done.',
    inputSchema: z.object({}),
    execute: async () => {
      if (!warmSandbox) {
        return { closed: false, message: 'No active browser sandbox to close.' };
      }
      const id = warmSandboxId;
      emitProgress({ type: 'tool:start', label: 'Closing browser sandbox', ...(id ? { detail: id } : {}) });
      await warmSandbox.stop();
      warmSandbox = null;
      warmSandboxId = null;
      emitProgress({ type: 'tool:end', label: 'Browser sandbox closed' });
      return { closed: true, sandboxId: id };
    },
  }),
};

// ─── Core browsing actions ───────────────────────────────────────────────────

function getActiveSandbox(): Sandbox {
  if (!warmSandbox) {
    throw new Error('No active browser sandbox. Call getOrCreateBrowserSandbox first.');
  }
  return warmSandbox;
}

export const browsingTools = {
  browserNavigate: tool({
    description:
      'Navigate to a URL inside the sandboxed browser and return the page title, final URL (after redirects), and visible text content. The starting point for any browsing task.',
    inputSchema: z.object({
      url: z.string().url(),
      waitForSelector: z.string().optional().describe('CSS selector to wait for before considering the page loaded (useful for SPAs).'),
      timeoutMs: z.number().int().min(1000).max(60_000).optional().default(30_000),
    }),
    execute: async ({ url, waitForSelector, timeoutMs }) => {
      const approved = await confirmBrowserAction('Navigate browser', [`URL: ${url}`]);
      if (!approved) throw new Error('Blocked navigation. Ask user to approve.');

      const sandbox = getActiveSandbox();
      emitProgress({ type: 'tool:start', label: 'Navigating', detail: url });

      const body = `
        page.goto("${url}", timeout=${timeoutMs})
        ${waitForSelector ? `page.wait_for_selector("${waitForSelector}", timeout=${timeoutMs})` : ''}
        result["title"] = page.title()
        result["finalUrl"] = page.url
        result["text"] = page.inner_text("body")[:5000]
      `;

      const out = await sandbox.process.codeRun(playwrightScript(body), undefined, Math.ceil(timeoutMs / 1000) + 15);
      if (out.exitCode !== 0) throw new Error(`Navigation failed (exit ${out.exitCode}): ${out.result?.slice(-1000)}`);
      const parsed = extractResult(out.result ?? '');

      emitProgress({ type: 'tool:end', label: 'Navigation complete', detail: parsed.finalUrl as string });
      return parsed;
    },
  }),

  browserAction: tool({
    description:
      'Perform a single interaction on the current page inside the sandboxed browser: click, type into a field, select a dropdown option, check a checkbox, press a key, or scroll. Use CSS selectors or Playwright text= selectors. For multi-step sequences (e.g. login forms), prefer browserRunScript instead — this action re-navigates to the last known URL first since Playwright pages don\'t persist "current page" across separate process invocations.',
    inputSchema: z.object({
      currentUrl: z.string().url().describe('The URL the page should currently be on (re-navigated to before performing the action, since each call is a fresh browser process).'),
      action: z.enum(['click', 'fill', 'select', 'check', 'uncheck', 'press', 'waitFor', 'scroll']),
      selector: z.string().describe('CSS selector or Playwright selector, e.g. "#submit", "text=Sign in", "[name=email]".'),
      value: z.string().optional().describe('Text to fill, option value to select, or key to press (e.g. "Enter").'),
      timeoutMs: z.number().int().min(500).max(30_000).optional().default(10_000),
    }),
    execute: async ({ currentUrl, action, selector, value, timeoutMs }) => {
      const approved = await confirmBrowserAction('Browser interaction', [`${action} on "${selector}"`, value ? `Value: ${value}` : '']);
      if (!approved) throw new Error('Blocked browser action. Ask user to approve.');

      const sandbox = getActiveSandbox();
      emitProgress({ type: 'tool:start', label: `Browser ${action}`, detail: selector });

      const escapedValue = (value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const body = `
        page.goto("${currentUrl}", timeout=${timeoutMs})
        ${action === 'click' ? `page.click("${selector}", timeout=${timeoutMs})` : ''}
        ${action === 'fill' ? `page.fill("${selector}", "${escapedValue}", timeout=${timeoutMs})` : ''}
        ${action === 'select' ? `page.select_option("${selector}", "${escapedValue}", timeout=${timeoutMs})` : ''}
        ${action === 'check' ? `page.check("${selector}", timeout=${timeoutMs})` : ''}
        ${action === 'uncheck' ? `page.uncheck("${selector}", timeout=${timeoutMs})` : ''}
        ${action === 'press' ? `page.press("${selector}", "${escapedValue}", timeout=${timeoutMs})` : ''}
        ${action === 'waitFor' ? `page.wait_for_selector("${selector}", timeout=${timeoutMs})` : ''}
        ${action === 'scroll' ? `page.locator("${selector}").scroll_into_view_if_needed(timeout=${timeoutMs})` : ''}
        result["action"] = "${action}"
        result["selector"] = "${selector}"
        result["url"] = page.url
        result["title"] = page.title()
      `;

      const out = await sandbox.process.codeRun(playwrightScript(body), undefined, Math.ceil(timeoutMs / 1000) + 15);
      if (out.exitCode !== 0) throw new Error(`Browser action failed (exit ${out.exitCode}): ${out.result?.slice(-1000)}`);
      const parsed = extractResult(out.result ?? '');

      emitProgress({ type: 'tool:end', label: `Browser ${action} complete` });
      return parsed;
    },
  }),

  browserRunScript: tool({
    description:
      'Run a full multi-step Playwright Python script inside the sandboxed browser in one call — navigate, fill a login form, click submit, wait for a result, extract data, download a file — all in a single page session. Prefer this over chaining browserNavigate + browserAction whenever steps depend on each other within the same page load (login flows, multi-field forms, infinite scroll, download-triggering clicks). The script body runs with `page`, `context`, and `result` (dict) already available; populate result with whatever you want returned.',
    inputSchema: z.object({
      startUrl: z.string().url().describe('URL to navigate to first.'),
      scriptBody: z
        .string()
        .describe(
          'Python lines using Playwright sync API: page.fill(...), page.click(...), page.wait_for_selector(...), page.expect_download() as a context manager for downloads, etc. Populate result["key"] = value for anything you want returned. Do NOT include page.goto for startUrl — that is handled automatically.',
        ),
      timeoutMs: z.number().int().min(5000).max(120_000).optional().default(45_000),
      headless: z.boolean().optional().default(true).describe('Set false only if visually debugging via screenshot or getBrowserPreviewUrl is needed mid-script.'),
    }),
    execute: async ({ startUrl, scriptBody, timeoutMs, headless }) => {
      const approved = await confirmBrowserAction('Run multi-step browser script', [
        `Start URL: ${startUrl}`,
        `Script: ${scriptBody.slice(0, 200)}${scriptBody.length > 200 ? '…' : ''}`,
      ]);
      if (!approved) throw new Error('Blocked browser script. Ask user to approve.');

      const sandbox = getActiveSandbox();
      emitProgress({ type: 'tool:start', label: 'Running browser script', detail: startUrl });

      const body = `
        page.goto("${startUrl}", timeout=${timeoutMs})
${scriptBody.split('\n').map((l) => '        ' + l).join('\n')}
        result.setdefault("url", page.url)
        result.setdefault("title", page.title())
      `;

      const out = await sandbox.process.codeRun(
        playwrightScript(body, { headless }),
        undefined,
        Math.ceil(timeoutMs / 1000) + 30,
      );
      if (out.exitCode !== 0) throw new Error(`Browser script failed (exit ${out.exitCode}): ${out.result?.slice(-1000)}`);
      const parsed = extractResult(out.result ?? '');

      emitProgress({ type: 'tool:end', label: 'Browser script complete' });
      return parsed;
    },
  }),

  browserExtract: tool({
    description:
      'Extract structured data from a page using CSS selectors — text content, attribute values, or all matches for a repeated element (e.g. all product titles + prices in a list).',
    inputSchema: z.object({
      url: z.string().url().describe('Page to load before extracting.'),
      fields: z
        .array(
          z.object({
            name: z.string().describe('Output field name.'),
            selector: z.string().describe('CSS selector for this field.'),
            attribute: z.string().optional().describe('HTML attribute to read instead of text content, e.g. "href" or "src".'),
            multiple: z.boolean().optional().default(false).describe('If true, returns an array of all matches instead of just the first.'),
          }),
        )
        .min(1),
      timeoutMs: z.number().int().min(1000).max(60_000).optional().default(30_000),
    }),
    execute: async ({ url, fields, timeoutMs }) => {
      const approved = await confirmBrowserAction('Extract page data', [`URL: ${url}`, `Fields: ${fields.map((f) => f.name).join(', ')}`]);
      if (!approved) throw new Error('Blocked extraction. Ask user to approve.');

      const sandbox = getActiveSandbox();
      emitProgress({ type: 'tool:start', label: 'Extracting data', detail: url });

      const extractLines = fields
        .map((f) => {
          const accessor = f.attribute ? `.get_attribute("${f.attribute}")` : '.inner_text()';
          if (f.multiple) {
            return `result["${f.name}"] = [el${accessor} for el in page.query_selector_all("${f.selector}")]`;
          }
          return `el_${f.name} = page.query_selector("${f.selector}"); result["${f.name}"] = el_${f.name}${accessor} if el_${f.name} else None`;
        })
        .join('\n        ');

      const body = `
        page.goto("${url}", timeout=${timeoutMs})
        ${extractLines}
      `;

      const out = await sandbox.process.codeRun(playwrightScript(body), undefined, Math.ceil(timeoutMs / 1000) + 15);
      if (out.exitCode !== 0) throw new Error(`Extraction failed (exit ${out.exitCode}): ${out.result?.slice(-1000)}`);
      const parsed = extractResult(out.result ?? '');

      emitProgress({ type: 'tool:end', label: 'Extraction complete', detail: `${fields.length} fields` });
      return parsed;
    },
  }),

  browserScreenshot: tool({
    description:
      'Take a Playwright screenshot of a page (or the current one) and save it locally for the agent to view. Useful for visually verifying page state or debugging selectors.',
    inputSchema: z.object({
      url: z.string().url().optional().describe('If provided, navigates here first.'),
      fullPage: z.boolean().optional().default(false).describe('Capture the full scrollable page instead of just the viewport.'),
    }),
    execute: async ({ url, fullPage }) => {
      const approved = await confirmBrowserAction('Browser screenshot', [url ? `URL: ${url}` : 'Current page', fullPage ? 'Full page' : 'Viewport only']);
      if (!approved) throw new Error('Blocked screenshot. Ask user to approve.');

      const sandbox = getActiveSandbox();
      emitProgress({ type: 'tool:start', label: 'Taking browser screenshot' });

      const remotePath = `/tmp/zilmate-shot-${ts()}.png`;
      const body = `
        ${url ? `page.goto("${url}", timeout=30000)` : ''}
        page.screenshot(path="${remotePath}", full_page=${fullPage ? 'True' : 'False'})
        result["remotePath"] = "${remotePath}"
        result["url"] = page.url
      `;

      const out = await sandbox.process.codeRun(playwrightScript(body), undefined, 45);
      if (out.exitCode !== 0) throw new Error(`Screenshot failed (exit ${out.exitCode}): ${out.result?.slice(-1000)}`);
      const parsed = extractResult(out.result ?? '');

      const dir = await ensureOutputDir();
      const localPath = path.join(dir, `screenshot-${ts()}.png`);
      const bytes = await sandbox.fs.downloadFile(remotePath);
      await writeFile(localPath, bytes);

      emitProgress({ type: 'tool:end', label: 'Screenshot saved', detail: localPath });
      return { ...parsed, localPath };
    },
  }),

  browserDownloadFile: tool({
    description:
      'Pull an arbitrary file that was downloaded inside the sandbox (e.g. via a page.expect_download() block in browserRunScript, or a PDF/CSV saved by a script) down to local disk. Give the remote path the download landed at.',
    inputSchema: z.object({
      remotePath: z.string().describe('Absolute path of the file inside the sandbox, e.g. "/tmp/downloads/report.csv".'),
      filename: z.string().optional().describe('Local filename to save as. Defaults to the remote basename.'),
    }),
    execute: async ({ remotePath, filename }) => {
      const approved = await confirmBrowserAction('Download file from sandbox', [`Remote path: ${remotePath}`]);
      if (!approved) throw new Error('Blocked file download. Ask user to approve.');

      const sandbox = getActiveSandbox();
      emitProgress({ type: 'tool:start', label: 'Downloading file from sandbox', detail: remotePath });

      const bytes = await sandbox.fs.downloadFile(remotePath);
      const dir = await ensureOutputDir();
      const localName = filename ?? path.basename(remotePath) ?? `download-${ts()}`;
      const localPath = path.join(dir, localName);
      await writeFile(localPath, bytes);

      emitProgress({ type: 'tool:end', label: 'File downloaded', detail: localPath });
      return { localPath, remotePath, bytes: bytes.length };
    },
  }),

  browserUploadFile: tool({
    description:
      'Upload a local file into the sandbox filesystem so a Playwright script can attach it (e.g. via page.set_input_files) or otherwise use it. Small/medium files only — this loads the whole file into memory.',
    inputSchema: z.object({
      localPath: z.string().describe('Path to a local file (e.g. something previously created in outputs/ or provided by the user).'),
      remotePath: z.string().optional().describe('Destination path inside the sandbox. Defaults to /tmp/uploads/<basename>.'),
    }),
    execute: async ({ localPath, remotePath }) => {
      const approved = await confirmBrowserAction('Upload file to sandbox', [`Local path: ${localPath}`]);
      if (!approved) throw new Error('Blocked file upload. Ask user to approve.');

      const sandbox = getActiveSandbox();
      const dest = remotePath ?? `/tmp/uploads/${path.basename(localPath)}`;
      emitProgress({ type: 'tool:start', label: 'Uploading file to sandbox', detail: dest });

      await sandbox.process.executeCommand(`mkdir -p "${path.dirname(dest)}"`, undefined, undefined, 15);
      const buffer = await readFile(localPath);
      await sandbox.fs.uploadFile(buffer, dest);

      emitProgress({ type: 'tool:end', label: 'File uploaded', detail: dest });
      return { remotePath: dest, bytes: buffer.length };
    },
  }),

  exportBrowserSession: tool({
    description:
      'Export the current login/cookie session (storage_state) from the sandbox to a local JSON file. Use this to save a logged-in session so it can be restored later — even into a different sandbox — instead of logging in again.',
    inputSchema: z.object({
      filename: z.string().optional().describe('Local filename to save as. Defaults to a timestamped name.'),
    }),
    execute: async ({ filename }) => {
      const approved = await confirmBrowserAction('Export browser session', ['Exports cookies/localStorage state — treat the resulting file as a credential.']);
      if (!approved) throw new Error('Blocked session export. Ask user to approve.');

      const sandbox = getActiveSandbox();
      emitProgress({ type: 'tool:start', label: 'Exporting browser session' });

      const bytes = await sandbox.fs.downloadFile('/tmp/zilmate-browser-state.json');
      const dir = await ensureOutputDir();
      const localPath = path.join(dir, filename ?? `session-${ts()}.json`);
      await writeFile(localPath, bytes);

      emitProgress({ type: 'tool:end', label: 'Session exported', detail: localPath });
      return { localPath, bytes: bytes.length };
    },
  }),

  importBrowserSession: tool({
    description:
      'Restore a previously exported session (storage_state JSON) into the sandbox, so the next browserNavigate/browserRunScript call resumes already logged in.',
    inputSchema: z.object({
      localPath: z.string().describe('Path to a session JSON file previously produced by exportBrowserSession.'),
    }),
    execute: async ({ localPath }) => {
      const approved = await confirmBrowserAction('Import browser session', ['Restores cookies/localStorage state into the active sandbox.']);
      if (!approved) throw new Error('Blocked session import. Ask user to approve.');

      const sandbox = getActiveSandbox();
      emitProgress({ type: 'tool:start', label: 'Importing browser session' });

      const buffer = await readFile(localPath);
      await sandbox.fs.uploadFile(buffer, '/tmp/zilmate-browser-state.json');

      emitProgress({ type: 'tool:end', label: 'Session imported' });
      return { imported: true };
    },
  }),

  browserExportPdf: tool({
    description:
      'Render a page to PDF inside the sandboxed browser (headless Chromium print-to-PDF) and download it locally. Good for saving invoices, statements, or article read-later copies.',
    inputSchema: z.object({
      url: z.string().url(),
      filename: z.string().optional().describe('Local filename to save as. Defaults to a timestamped name.'),
      landscape: z.boolean().optional().default(false),
    }),
    execute: async ({ url, filename, landscape }) => {
      const approved = await confirmBrowserAction('Export page to PDF', [`URL: ${url}`]);
      if (!approved) throw new Error('Blocked PDF export. Ask user to approve.');

      const sandbox = getActiveSandbox();
      emitProgress({ type: 'tool:start', label: 'Rendering PDF', detail: url });

      const remotePath = `/tmp/zilmate-pdf-${ts()}.pdf`;
      const body = `
        page.goto("${url}", timeout=30000)
        page.wait_for_load_state("networkidle", timeout=15000)
        page.pdf(path="${remotePath}", landscape=${landscape ? 'True' : 'False'}, print_background=True)
        result["remotePath"] = "${remotePath}"
        result["url"] = page.url
      `;
      // PDF export requires headless Chromium (page.pdf is a Chromium-only,
      // headless-only Playwright API).
      const out = await sandbox.process.codeRun(playwrightScript(body, { headless: true }), undefined, 60);
      if (out.exitCode !== 0) throw new Error(`PDF export failed (exit ${out.exitCode}): ${out.result?.slice(-1000)}`);
      const parsed = extractResult(out.result ?? '');

      const bytes = await sandbox.fs.downloadFile(remotePath);
      const dir = await ensureOutputDir();
      const localPath = path.join(dir, filename ?? `page-${ts()}.pdf`);
      await writeFile(localPath, bytes);

      emitProgress({ type: 'tool:end', label: 'PDF saved', detail: localPath });
      return { ...parsed, localPath };
    },
  }),

  getBrowserPreviewUrl: tool({
    description:
      'Get a live, human-viewable preview URL for a port exposed by the sandbox (e.g. a VNC/noVNC web server running alongside a non-headless browserRunScript call, or a local HTTP server started inside the sandbox). Lets the user actually watch the sandboxed browser instead of relying only on screenshots.',
    inputSchema: z.object({
      port: z.number().int().min(1).max(65_535).describe('Port number inside the sandbox that a viewable process is listening on.'),
    }),
    execute: async ({ port }) => {
      const sandbox = getActiveSandbox();
      emitProgress({ type: 'tool:start', label: 'Fetching preview URL', detail: `port ${port}` });
      const preview = await sandbox.getPreviewLink(port);
      emitProgress({ type: 'tool:end', label: 'Preview URL ready' });
      return preview;
    },
  }),
};

// ─── Native computer-use fallback (desktop-level, not Playwright) ────────────

/**
 * These tools drive the sandbox's own desktop directly via Daytona's built-in
 * computerUse interface, independent of Playwright. Use this when a page
 * defeats CSS-selector automation (canvas/WebGL UIs, drag-and-drop widgets,
 * native browser dialogs, some anti-bot challenges) — take a screenshot,
 * reason about pixel coordinates, then click/type at those coordinates.
 * This only makes sense with a non-headless browser running in the sandbox
 * (launch one via browserRunScript with headless=false first), and pairs well
 * with getBrowserPreviewUrl so a human can watch along.
 */
export const computerUseTools = {
  computerUseScreenshot: tool({
    description:
      "Take a screenshot of the sandbox's own desktop (not just the browser viewport) using Daytona's native computer-use API. Use this to see the full screen state — including native dialogs, download bars, or a non-headless Chromium window — before deciding where to click.",
    inputSchema: z.object({
      showCursor: z.boolean().optional().default(true).describe('Whether to render the mouse cursor in the screenshot.'),
    }),
    execute: async ({ showCursor }) => {
      const approved = await confirmBrowserAction('Native desktop screenshot', ['Screenshots the sandbox desktop']);
      if (!approved) throw new Error('Blocked screenshot. Ask user to approve.');

      const sandbox = getActiveSandbox();
      emitProgress({ type: 'tool:start', label: 'Taking desktop screenshot' });

      const shot = await (sandbox as any).computerUse.screenshot({ showCursor });
      const dir = await ensureOutputDir();
      const localPath = path.join(dir, `desktop-${ts()}.png`);
      const buffer = Buffer.from(shot.screenshot, 'base64');
      await writeFile(localPath, buffer);

      emitProgress({ type: 'tool:end', label: 'Desktop screenshot saved', detail: localPath });
      return { localPath };
    },
  }),

  computerUseClick: tool({
    description: "Click at specific pixel coordinates on the sandbox's own desktop, using Daytona's native mouse control. Coordinates come from reasoning over a computerUseScreenshot.",
    inputSchema: z.object({
      x: z.number().int(),
      y: z.number().int(),
      button: z.enum(['left', 'right', 'middle']).optional().default('left'),
      double: z.boolean().optional().default(false),
    }),
    execute: async ({ x, y, button, double }) => {
      const approved = await confirmBrowserAction('Native desktop click', [`(${x}, ${y})`, `Button: ${button}`, double ? 'Double-click' : '']);
      if (!approved) throw new Error('Blocked click. Ask user to approve.');

      const sandbox = getActiveSandbox();
      emitProgress({ type: 'tool:start', label: 'Clicking desktop', detail: `(${x}, ${y})` });
      const res = await (sandbox as any).computerUse.mouse.click(x, y, { button, double });
      emitProgress({ type: 'tool:end', label: 'Click complete' });
      return res;
    },
  }),

  computerUseType: tool({
    description: "Type text on the sandbox's own desktop using Daytona's native keyboard control (types wherever focus currently is, not tied to a specific selector).",
    inputSchema: z.object({
      text: z.string(),
      delayMs: z.number().int().min(0).max(1000).optional().default(20).describe('Delay between keystrokes in ms — helps with JS inputs that debounce.'),
    }),
    execute: async ({ text, delayMs }) => {
      const approved = await confirmBrowserAction('Native desktop typing', [`Text length: ${text.length}`]);
      if (!approved) throw new Error('Blocked typing. Ask user to approve.');

      const sandbox = getActiveSandbox();
      emitProgress({ type: 'tool:start', label: 'Typing on desktop' });
      const res = await (sandbox as any).computerUse.keyboard.type(text, { delay: delayMs });
      emitProgress({ type: 'tool:end', label: 'Typing complete' });
      return res;
    },
  }),

  computerUseHotkey: tool({
    description: 'Press a keyboard hotkey combination on the sandbox desktop, e.g. "ctrl+c", "ctrl+v", "cmd+a", "Escape", "Tab".',
    inputSchema: z.object({
      combo: z.string().describe('Hotkey combination, e.g. "ctrl+c" or "Escape".'),
    }),
    execute: async ({ combo }) => {
      const approved = await confirmBrowserAction('Native hotkey', [combo]);
      if (!approved) throw new Error('Blocked hotkey. Ask user to approve.');

      const sandbox = getActiveSandbox();
      emitProgress({ type: 'tool:start', label: 'Pressing hotkey', detail: combo });
      const res = await (sandbox as any).computerUse.keyboard.hotkey(combo);
      emitProgress({ type: 'tool:end', label: 'Hotkey sent' });
      return res;
    },
  }),
};

// ─── Barrel export ────────────────────────────────────────────────────────────

export const daytonaBrowserTools = {
  ...sandboxLifecycleTools,
  ...browsingTools,
  ...computerUseTools,
};