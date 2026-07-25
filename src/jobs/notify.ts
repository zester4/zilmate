// src/jobs/notify.ts
// Dispatches job notifications via desktop, webhook, or other channels.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { JobNotification, ZilMateJob } from './types.js';

const execFileAsync = promisify(execFile);

async function sendDesktopNotification(title: string, message: string, urgency: 'low' | 'normal' | 'critical' = 'normal') {
  const safeTitle = title.slice(0, 120);
  const safeMessage = message.slice(0, 500);

  if (process.platform === 'win32') {
    const script = `
Add-Type -AssemblyName System.Windows.Forms
$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Icon = [System.Drawing.SystemIcons]::Information
$notify.Visible = $true
$notify.ShowBalloonTip(8000, '${safeTitle.replace(/'/g, "''")}', '${safeMessage.replace(/'/g, "''")}', [System.Windows.Forms.ToolTipIcon]::Info)
Start-Sleep -Seconds 2
$notify.Dispose()
`.trim();
    await execFileAsync('powershell.exe', ['-NoProfile', '-Command', script], { windowsHide: true, timeout: 15_000 });
    return true;
  }

  if (process.platform === 'darwin') {
    const escaped = `${safeTitle}: ${safeMessage}`.replace(/"/g, '\\"');
    await execFileAsync('osascript', ['-e', `display notification "${escaped}" with title "${safeTitle.replace(/"/g, '\\"')}"`], { timeout: 10_000 });
    return true;
  }

  try {
    await execFileAsync('notify-send', [
      ...(urgency === 'critical' ? ['-u', 'critical'] : urgency === 'low' ? ['-u', 'low'] : []),
      safeTitle,
      safeMessage,
    ], { timeout: 10_000 });
    return true;
  } catch {
    try {
      await execFileAsync('zenity', ['--info', '--title', safeTitle, '--text', safeMessage, '--timeout=8'], { timeout: 12_000 });
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Dispatch notifications for a job based on its notify configuration.
 * Called by the runner after job completion or failure.
 */
export async function dispatchJobNotification(job: ZilMateJob, event: 'success' | 'failure' | 'start') {
  const notify = job.notify;
  if (!notify || !notify.on.includes(event)) return;

  const title = `ZilMate Job ${event === 'success' ? '✅' : event === 'failure' ? '❌' : '▶️'} ${job.task.slice(0, 60)}`;
  const message = event === 'success'
    ? `Job "${job.task.slice(0, 100)}" completed successfully.`
    : event === 'failure'
      ? `Job "${job.task.slice(0, 100)}" failed: ${job.error?.slice(0, 200) ?? 'Unknown error'}`
      : `Job "${job.task.slice(0, 100)}" has started.`;

  // Desktop notification
  if (notify.desktop !== false) {
    const urgency = event === 'failure' ? 'critical' : event === 'start' ? 'low' : 'normal';
    await sendDesktopNotification(title, message, urgency).catch(() => {});
  }

  // Webhook notification
  if (notify.webhook) {
    try {
      await fetch(notify.webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event, jobId: job.id, task: job.task, status: job.status, error: job.error }),
      });
    } catch {
      // Webhook delivery failure is non-fatal
    }
  }

  // Slack notification (via webhook URL)
  if (notify.slack) {
    try {
      const slackMessage = {
        text: `${title}\n${message}\nJob ID: ${job.id}`,
      };
      await fetch(notify.slack, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(slackMessage),
      });
    } catch {
      // Slack delivery failure is non-fatal
    }
  }
}