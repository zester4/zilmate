import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { generateText, tool } from 'ai';
import { z } from 'zod';
import { models } from '../config/models.js';
import { requireGatewayAuth } from '../config/env.js';
import { requestConfirmation } from '../runtime/confirm.js';
import { emitProgress } from '../runtime/progress.js';
import { searchWeb } from './web-search.tool.js';
import { getOutputDir } from '../workspace/output-paths.js';

const execFileAsync = promisify(execFile);
const screenshotDir = getOutputDir('screenshots');
const cameraDir = getOutputDir('camera');

export type CameraDoctorCheck = {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
};

export type CameraDeviceInfo = {
  name: string;
  input: string;
};

async function confirmDesktopAction(action: string, details: string[], access: 'Read-only' | 'Write' = 'Read-only') {
  return requestConfirmation({
    toolkitSlug: 'ZILMATE',
    toolSlug: 'DESKTOP',
    action,
    access,
    targetTools: ['ZILMATE_DESKTOP'],
    details,
    summary: details.join('; '),
  });
}

function safeShellText(value: string) {
  return value.replace(/'/g, "''");
}

async function commandExists(command: string) {
  const probe = process.platform === 'win32' ? 'where.exe' : 'which';
  try {
    await execFileAsync(probe, [command], { windowsHide: true, timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

async function simulateMouseAction(action: 'click' | 'double-click' | 'right-click' | 'move' | 'drag' | 'scroll', x?: number, y?: number, endX?: number, endY?: number, scrollAmount?: number) {
  if (process.platform === 'win32') {
    let script = '';
    if (action === 'move' && x !== undefined && y !== undefined) {
      script = `[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x}, ${y})`;
    } else if (action === 'click') {
      script = `
        Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern void mouse_event(int flags, int dx, int dy, int data, int extra);' -Name Mouse -Namespace Win32
        if ($null -ne ${x} -and $null -ne ${y}) { [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x}, ${y}) }
        [Win32.Mouse]::mouse_event(0x0002, 0, 0, 0, 0) # LEFTDOWN
        [Win32.Mouse]::mouse_event(0x0004, 0, 0, 0, 0) # LEFTUP
      `;
    } else if (action === 'double-click') {
      script = `
        Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern void mouse_event(int flags, int dx, int dy, int data, int extra);' -Name Mouse -Namespace Win32
        if ($null -ne ${x} -and $null -ne ${y}) { [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x}, ${y}) }
        [Win32.Mouse]::mouse_event(0x0002, 0, 0, 0, 0)
        [Win32.Mouse]::mouse_event(0x0004, 0, 0, 0, 0)
        Start-Sleep -Milliseconds 100
        [Win32.Mouse]::mouse_event(0x0002, 0, 0, 0, 0)
        [Win32.Mouse]::mouse_event(0x0004, 0, 0, 0, 0)
      `;
    } else if (action === 'right-click') {
      script = `
        Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern void mouse_event(int flags, int dx, int dy, int data, int extra);' -Name Mouse -Namespace Win32
        if ($null -ne ${x} -and $null -ne ${y}) { [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x}, ${y}) }
        [Win32.Mouse]::mouse_event(0x0008, 0, 0, 0, 0) # RIGHTDOWN
        [Win32.Mouse]::mouse_event(0x0010, 0, 0, 0, 0) # RIGHTUP
      `;
    } else if (action === 'drag' && x !== undefined && y !== undefined && endX !== undefined && endY !== undefined) {
      script = `
        Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern void mouse_event(int flags, int dx, int dy, int data, int extra);' -Name Mouse -Namespace Win32
        [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x}, ${y})
        [Win32.Mouse]::mouse_event(0x0002, 0, 0, 0, 0)
        Start-Sleep -Milliseconds 100
        [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${endX}, ${endY})
        Start-Sleep -Milliseconds 100
        [Win32.Mouse]::mouse_event(0x0004, 0, 0, 0, 0)
      `;
    } else if (action === 'scroll') {
      const amount = scrollAmount ?? 120;
      script = `
        Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern void mouse_event(int flags, int dx, int dy, int data, int extra);' -Name Mouse -Namespace Win32
        [Win32.Mouse]::mouse_event(0x0800, 0, 0, ${amount}, 0) # WHEEL
      `;
    }
    if (script) {
      await execFileAsync('powershell.exe', ['-NoProfile', '-Command', `Add-Type -AssemblyName System.Windows.Forms; ${script}`], { windowsHide: true, timeout: 10000 });
    }
  } else if (process.platform === 'darwin') {
    if (x !== undefined && y !== undefined) {
      await execFileAsync('osascript', ['-e', `tell application "System Events" to click at {${x}, ${y}}`], { timeout: 10000 });
    }
  } else {
    if (await commandExists('xdotool')) {
      let args: string[] = [];
      if (action === 'move' && x !== undefined && y !== undefined) {
        args = ['mousemove', String(x), String(y)];
      } else if (action === 'click') {
        if (x !== undefined && y !== undefined) {
          args = ['mousemove', String(x), String(y), 'click', '1'];
        } else {
          args = ['click', '1'];
        }
      } else if (action === 'double-click') {
        if (x !== undefined && y !== undefined) {
          args = ['mousemove', String(x), String(y), 'click', '--repeat', '2', '1'];
        } else {
          args = ['click', '--repeat', '2', '1'];
        }
      } else if (action === 'right-click') {
        if (x !== undefined && y !== undefined) {
          args = ['mousemove', String(x), String(y), 'click', '3'];
        } else {
          args = ['click', '3'];
        }
      } else if (action === 'drag' && x !== undefined && y !== undefined && endX !== undefined && endY !== undefined) {
        args = ['mousemove', String(x), String(y), 'mousedown', '1', 'mousemove', String(endX), String(endY), 'mouseup', '1'];
      } else if (action === 'scroll') {
        const btn = (scrollAmount ?? 120) > 0 ? '4' : '5';
        args = ['click', btn];
      }
      if (args.length > 0) {
        await execFileAsync('xdotool', args, { timeout: 10000 });
      }
    } else {
      throw new Error('xdotool is required for mouse simulation on Linux.');
    }
  }
}

async function showNotification(title: string, message: string) {
  if (process.platform === 'win32') {
    const cleanTitle = safeShellText(title);
    const cleanMsg = safeShellText(message);
    const script = `
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$textNodes = $template.GetElementsByTagName("text")
$textNodes.Item(0).AppendChild($template.CreateTextNode("${cleanTitle}")) | Out-Null
$textNodes.Item(1).AppendChild($template.CreateTextNode("${cleanMsg}")) | Out-Null
$toast = New-Object Windows.UI.Notifications.ToastNotification $template
$notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("ZilMate")
$notifier.Show($toast)
`;
    await execFileAsync('powershell.exe', ['-NoProfile', '-Command', script], { windowsHide: true, timeout: 5000 });
  } else if (process.platform === 'darwin') {
    const script = `display notification "${safeShellText(message)}" with title "${safeShellText(title)}"`;
    await execFileAsync('osascript', ['-e', script], { timeout: 5000 });
  } else {
    if (await commandExists('notify-send')) {
      await execFileAsync('notify-send', [title, message], { timeout: 5000 });
    }
  }
}

async function listAudioDevices(): Promise<string[]> {
  try {
    if (process.platform === 'win32') {
      const result = await execFileAsync('ffmpeg', ['-hide_banner', '-list_devices', 'true', '-f', 'dshow', '-i', 'dummy'], { timeout: 5000 });
      const output = `${result.stdout}\n${result.stderr}`;
      const names = [...output.matchAll(/"([^"]+)"\s+\(audio\)/gi)].map((match) => match[1]!).filter(Boolean);
      return names;
    }
    if (process.platform === 'darwin') {
      const result = await execFileAsync('ffmpeg', ['-hide_banner', '-f', 'avfoundation', '-list_devices', 'true', '-i', ''], { timeout: 5000 });
      const output = `${result.stdout}\n${result.stderr}`;
      const names = [...output.matchAll(/\[(\d+)\]\s+(.+)/g)].map((match) => match[2]!.trim());
      return names;
    }
    return [];
  } catch (error) {
    const output = error && typeof error === 'object' && 'stderr' in error ? String((error as { stderr?: unknown }).stderr || '') : '';
    if (process.platform === 'win32') {
      return [...output.matchAll(/"([^"]+)"\s+\(audio\)/gi)].map((match) => match[1]!).filter(Boolean);
    }
    if (process.platform === 'darwin') {
      return [...output.matchAll(/\[(\d+)\]\s+(.+)/g)].map((match) => match[2]!.trim());
    }
    return [];
  }
}

async function recordAudio(durationSeconds: number) {
  const outputDir = path.join(path.dirname(screenshotDir), 'audio');
  await mkdir(outputDir, { recursive: true });
  const target = path.join(outputDir, `zilmate-audio-${Date.now()}.wav`);

  if (!(await commandExists('ffmpeg'))) {
    throw new Error('Audio recording requires ffmpeg on PATH.');
  }

  let inputDevice = '';
  let format = '';

  if (process.platform === 'win32') {
    format = 'dshow';
    const audios = await listAudioDevices();
    if (audios.length > 0) {
      inputDevice = `audio=${audios[0]}`;
    } else {
      inputDevice = 'audio=default';
    }
  } else if (process.platform === 'darwin') {
    format = 'avfoundation';
    inputDevice = 'none:0';
  } else {
    format = 'alsa';
    inputDevice = 'default';
  }

  const args = ['-y', '-f', format, '-i', inputDevice, '-t', String(durationSeconds), target];
  await execFileAsync('ffmpeg', args, { timeout: (durationSeconds + 15) * 1000, maxBuffer: 2_000_000 });
  return target;
}

async function getActiveWindow() {
  if (process.platform === 'win32') {
    const script = `
$sig = @'
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int count);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
'@
Add-Type -MemberDefinition $sig -Name Window -Namespace Win32
$hwnd = [Win32.Window]::GetForegroundWindow()
if ($hwnd -ne [IntPtr]::Zero) {
  $title = New-Object System.Text.StringBuilder 256
  [Win32.Window]::GetWindowText($hwnd, $title, 256) | Out-Null
  $pid = 0
  [Win32.Window]::GetWindowThreadProcessId($hwnd, [ref]$pid) | Out-Null
  $process = Get-Process -Id $pid -ErrorAction SilentlyContinue
  @{
    title = $title.ToString()
    process = $process.ProcessName
    pid = $pid
  } | ConvertTo-Json
} else {
  "{}"
}
`;
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', script], { windowsHide: true, timeout: 5000 });
    try {
      return JSON.parse(stdout.trim()) as { title?: string; process?: string; pid?: number };
    } catch {
      return {};
    }
  } else if (process.platform === 'darwin') {
    const script = `
tell application "System Events"
  set frontApp to first application process whose frontmost is true
  set appName to name of frontApp
  tell frontApp
    try
      set windowTitle to name of first window
    on error
      set windowTitle to ""
    end try
  end tell
  return appName & "|||" & windowTitle
end tell
`;
    const { stdout } = await execFileAsync('osascript', ['-e', script], { timeout: 5000 });
    const parts = stdout.trim().split('|||');
    return {
      process: parts[0] || 'Unknown',
      title: parts[1] || 'Unknown',
    };
  } else {
    if (await commandExists('xdotool')) {
      try {
        const { stdout: windowId } = await execFileAsync('xdotool', ['getactivewindow'], { timeout: 5000 });
        const { stdout: windowName } = await execFileAsync('xdotool', ['getwindowname', windowId.trim()], { timeout: 5000 });
        return {
          title: windowName.trim(),
          process: 'Unknown',
        };
      } catch {
        return {};
      }
    }
    return {};
  }
}

async function controlVolume(action: 'set' | 'mute' | 'unmute' | 'get' | 'media-play-pause' | 'media-next' | 'media-prev', level?: number) {
  if (process.platform === 'win32') {
    if (action === 'media-play-pause') {
      const ps = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait([char]179)`;
      await execFileAsync('powershell.exe', ['-NoProfile', '-Command', ps], { windowsHide: true, timeout: 5000 });
      return { success: true, action };
    }
    if (action === 'media-next') {
      const ps = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait([char]176)`;
      await execFileAsync('powershell.exe', ['-NoProfile', '-Command', ps], { windowsHide: true, timeout: 5000 });
      return { success: true, action };
    }
    if (action === 'media-prev') {
      const ps = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait([char]177)`;
      await execFileAsync('powershell.exe', ['-NoProfile', '-Command', ps], { windowsHide: true, timeout: 5000 });
      return { success: true, action };
    }
    if (action === 'mute') {
      const ps = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait([char]173)`;
      await execFileAsync('powershell.exe', ['-NoProfile', '-Command', ps], { windowsHide: true, timeout: 5000 });
      return { success: true, action };
    }
    if (action === 'unmute') {
      const ps = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait([char]173)`;
      await execFileAsync('powershell.exe', ['-NoProfile', '-Command', ps], { windowsHide: true, timeout: 5000 });
      return { success: true, action };
    }
    if (action === 'set' && level !== undefined) {
      const script = `
$wsh = New-Object -ComObject WScript.Shell
for ($i = 0; $i -lt 50; $i++) { $wsh.SendKeys([char]174) }
$steps = [Math]::Floor(${level} / 2)
for ($i = 0; $i -lt $steps; $i++) { $wsh.SendKeys([char]175) }
`;
      await execFileAsync('powershell.exe', ['-NoProfile', '-Command', script], { windowsHide: true, timeout: 10000 });
      return { success: true, action, level };
    }
    return { success: false, error: 'Action not supported or requires arguments' };
  } else if (process.platform === 'darwin') {
    if (action === 'set' && level !== undefined) {
      await execFileAsync('osascript', ['-e', `set volume output volume ${level}`], { timeout: 5000 });
      return { success: true, action, level };
    }
    if (action === 'mute') {
      await execFileAsync('osascript', ['-e', 'set volume with output muted'], { timeout: 5000 });
      return { success: true, action };
    }
    if (action === 'unmute') {
      await execFileAsync('osascript', ['-e', 'set volume without output muted'], { timeout: 5000 });
      return { success: true, action };
    }
    if (action === 'get') {
      const { stdout } = await execFileAsync('osascript', ['-e', 'output volume of (get volume settings)'], { timeout: 5000 });
      return { success: true, level: parseInt(stdout.trim(), 10) };
    }
    if (action === 'media-play-pause') {
      await execFileAsync('osascript', ['-e', 'tell application "System Events" to key code 16'], { timeout: 5000 });
      return { success: true, action };
    }
    return { success: false, error: 'Action not supported or requires arguments' };
  } else {
    if (await commandExists('amixer')) {
      if (action === 'set' && level !== undefined) {
        await execFileAsync('amixer', ['set', 'Master', `${level}%`], { timeout: 5000 });
        return { success: true, action, level };
      }
      if (action === 'mute') {
        await execFileAsync('amixer', ['set', 'Master', 'mute'], { timeout: 5000 });
        return { success: true, action };
      }
      if (action === 'unmute') {
        await execFileAsync('amixer', ['set', 'Master', 'unmute'], { timeout: 5000 });
        return { success: true, action };
      }
    }
    return { success: false, error: 'amixer is not available on Linux' };
  }
}

function cameraInstallHint() {
  if (process.platform === 'win32') return 'Install ffmpeg: winget install Gyan.FFmpeg';
  if (process.platform === 'darwin') return 'Install ffmpeg: brew install ffmpeg';
  return 'Install ffmpeg from your package manager, for example: sudo apt install ffmpeg';
}

async function readClipboardText() {
  if (process.platform === 'win32') {
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', 'Get-Clipboard -Raw'], { windowsHide: true, timeout: 10_000, maxBuffer: 2_000_000 });
    return stdout;
  }
  if (process.platform === 'darwin') {
    const { stdout } = await execFileAsync('pbpaste', [], { timeout: 10_000, maxBuffer: 2_000_000 });
    return stdout;
  }
  for (const command of ['wl-paste', 'xclip', 'xsel']) {
    if (await commandExists(command)) {
      const args = command === 'xclip'
        ? ['-selection', 'clipboard', '-o']
        : command === 'xsel'
          ? ['--clipboard', '--output']
          : [];
      const { stdout } = await execFileAsync(command, args, { timeout: 10_000, maxBuffer: 2_000_000 });
      return stdout;
    }
  }
  throw new Error('No supported clipboard reader found. Install wl-clipboard, xclip, or xsel on Linux.');
}

async function writeClipboardText(text: string) {
  if (process.platform === 'win32') {
    const script = `Set-Clipboard -Value '${safeShellText(text)}'`;
    await execFileAsync('powershell.exe', ['-NoProfile', '-Command', script], { windowsHide: true, timeout: 10_000 });
    return;
  }
  if (process.platform === 'darwin') {
    await writeToCommand('pbcopy', [], text);
    return;
  }
  for (const command of ['wl-copy', 'xclip', 'xsel']) {
    if (await commandExists(command)) {
      const args = command === 'xclip'
        ? ['-selection', 'clipboard']
        : command === 'xsel'
          ? ['--clipboard', '--input']
          : [];
      await writeToCommand(command, args, text);
      return;
    }
  }
  throw new Error('No supported clipboard writer found. Install wl-clipboard, xclip, or xsel on Linux.');
}

function writeToCommand(command: string, args: string[], input: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `${command} exited with code ${code}`));
    });
    child.stdin.end(input);
  });
}

async function captureScreenshot() {
  await mkdir(screenshotDir, { recursive: true });
  const target = path.join(screenshotDir, `zilmate-screen-${Date.now()}.png`);

  if (process.platform === 'win32') {
    const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$bitmap.Save('${safeShellText(target)}', [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()
`;
    await execFileAsync('powershell.exe', ['-NoProfile', '-Command', script], { windowsHide: true, timeout: 20_000 });
    return target;
  }

  if (process.platform === 'darwin') {
    await execFileAsync('screencapture', ['-x', target], { timeout: 20_000 });
    return target;
  }

  for (const command of ['gnome-screenshot', 'grim', 'import']) {
    if (await commandExists(command)) {
      const args = command === 'gnome-screenshot'
        ? ['-f', target]
        : command === 'grim'
          ? [target]
          : ['-window', 'root', target];
      await execFileAsync(command, args, { timeout: 20_000 });
      return target;
    }
  }

  throw new Error('No supported screenshot tool found. Install gnome-screenshot, grim, or ImageMagick import on Linux.');
}

function cameraCandidates(device?: string) {
  if (device) return [device];
  if (process.platform === 'win32') {
    return [
      process.env.ZILMATE_CAMERA_DEVICE,
      'video=Integrated Camera',
      'video=USB Camera',
      'video=HD Webcam',
      'video=Integrated Webcam',
      'video=Camera',
    ].filter((value): value is string => Boolean(value));
  }
  if (process.platform === 'darwin') {
    return [process.env.ZILMATE_CAMERA_DEVICE, 'default', '0', '1'].filter((value): value is string => Boolean(value));
  }
  return [process.env.ZILMATE_CAMERA_DEVICE, '/dev/video0', '/dev/video1', '/dev/video2'].filter((value): value is string => Boolean(value));
}

function ffmpegCameraArgs(inputDevice: string, target: string) {
  if (process.platform === 'win32') return ['-y', '-f', 'dshow', '-i', inputDevice, '-frames:v', '1', target];
  if (process.platform === 'darwin') return ['-y', '-f', 'avfoundation', '-i', inputDevice, '-frames:v', '1', target];
  return ['-y', '-f', 'video4linux2', '-i', inputDevice, '-frames:v', '1', target];
}

function friendlyCameraError(error: unknown, attempts: Array<{ device: string; error: string }>) {
  const message = error instanceof Error ? error.message : String(error);
  if (/cannot find|could not find|No such file|video device|Could not open|I\/O error/i.test(message)) {
    return `Could not open the camera device. Try \`zilmate camera list\`, then pass the exact device name. Attempts: ${attempts.map((item) => item.device).join(', ')}`;
  }
  if (/busy|in use|resource unavailable/i.test(message)) {
    return 'Camera appears to be busy. Close Camera, Teams, Zoom, browser tabs, or other apps using it, then retry.';
  }
  if (/permission|denied|access/i.test(message)) {
    return 'Camera permission was denied. Allow terminal/desktop apps to access the camera in OS privacy settings, then retry.';
  }
  return `${message}\nTried: ${attempts.map((item) => item.device).join(', ')}`;
}

export async function listCameraDevices(): Promise<CameraDeviceInfo[]> {
  if (!(await commandExists('ffmpeg'))) return [];
  try {
    if (process.platform === 'win32') {
      const result = await execFileAsync('ffmpeg', ['-hide_banner', '-list_devices', 'true', '-f', 'dshow', '-i', 'dummy'], { timeout: 15_000, maxBuffer: 2_000_000 });
      const output = `${result.stdout}\n${result.stderr}`;
      const names = [...output.matchAll(/"([^"]+)"\s+\(video\)/gi)].map((match) => match[1]!).filter(Boolean);
      return names.map((name) => ({ name, input: `video=${name}` }));
    }
    if (process.platform === 'darwin') {
      const result = await execFileAsync('ffmpeg', ['-hide_banner', '-f', 'avfoundation', '-list_devices', 'true', '-i', ''], { timeout: 15_000, maxBuffer: 2_000_000 });
      const output = `${result.stdout}\n${result.stderr}`;
      const names = [...output.matchAll(/\[(\d+)\]\s+(.+)/g)].map((match) => ({ name: match[2]!.trim(), input: match[1]! }));
      return names;
    }
    const candidates = cameraCandidates();
    const available = [];
    for (const input of candidates) {
      if (existsSync(input)) available.push({ name: input, input });
    }
    return available;
  } catch (error) {
    const output = error && typeof error === 'object' && 'stderr' in error ? String((error as { stderr?: unknown }).stderr || '') : '';
    if (process.platform === 'win32') {
      const names = [...output.matchAll(/"([^"]+)"\s+\(video\)/gi)].map((match) => match[1]!).filter(Boolean);
      return names.map((name) => ({ name, input: `video=${name}` }));
    }
    if (process.platform === 'darwin') {
      return [...output.matchAll(/\[(\d+)\]\s+(.+)/g)].map((match) => ({ name: match[2]!.trim(), input: match[1]! }));
    }
    return [];
  }
}

export async function runCameraDoctor(): Promise<CameraDoctorCheck[]> {
  const checks: CameraDoctorCheck[] = [
    { name: 'OS', status: 'pass', detail: `${process.platform} ${process.arch}` },
  ];
  const hasFfmpeg = await commandExists('ffmpeg');
  checks.push({
    name: 'ffmpeg',
    status: hasFfmpeg ? 'pass' : 'fail',
    detail: hasFfmpeg ? 'ffmpeg is available' : cameraInstallHint(),
  });
  if (!hasFfmpeg) return checks;

  const devices = await listCameraDevices();
  checks.push({
    name: 'Camera devices',
    status: devices.length > 0 ? 'pass' : 'warn',
    detail: devices.length > 0 ? devices.map((device) => device.input).join(', ') : 'No camera devices listed. Try setting ZILMATE_CAMERA_DEVICE manually.',
  });
  checks.push({
    name: 'Default candidates',
    status: 'pass',
    detail: cameraCandidates().join(', '),
  });
  return checks;
}

export async function captureCameraPhoto(device?: string) {
  await mkdir(cameraDir, { recursive: true });

  if (!(await commandExists('ffmpeg'))) {
    throw new Error(`Camera capture needs ffmpeg installed and available on PATH. ${cameraInstallHint()}.`);
  }

  const attempts: Array<{ device: string; error: string }> = [];
  const listed = await listCameraDevices();
  const candidates = [...new Set([...cameraCandidates(device), ...listed.map((item) => item.input)])];
  for (const candidate of candidates) {
    const target = path.join(cameraDir, `zilmate-camera-${Date.now()}.jpg`);
    try {
      emitProgress({ type: 'tool:start', label: 'Trying camera', detail: candidate });
      await execFileAsync('ffmpeg', ffmpegCameraArgs(candidate, target), { timeout: 25_000, maxBuffer: 2_000_000 });
      return target;
    } catch (error) {
      attempts.push({ device: candidate, error: error instanceof Error ? error.message : String(error) });
    }
  }

  throw new Error(friendlyCameraError(attempts.at(-1)?.error || 'Camera capture failed.', attempts));
}

async function analyzeImage(imagePath: string, prompt: string, label = 'image') {
  requireGatewayAuth();
  const image = await readFile(imagePath);
  emitProgress({ type: 'tool:start', label: `Analyzing ${label}`, detail: models.screenshotVision });
  const result = await generateText({
    model: models.screenshotVision,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: prompt,
          },
          {
            type: 'image',
            image,
            mediaType: imagePath.toLowerCase().endsWith('.jpg') || imagePath.toLowerCase().endsWith('.jpeg') ? 'image/jpeg' : 'image/png',
          },
        ],
      },
    ],
    providerOptions: {
      gateway: {
        tags: ['zilmate', 'feature:screenshot', 'model:gemini'],
      },
    },
  });
  emitProgress({ type: 'tool:end', label: `${label[0]?.toUpperCase() || 'I'}${label.slice(1)} analyzed`, detail: models.screenshotVision });
  return result.text;
}

const defaultScreenshotPrompt = [
  'Describe this screenshot clearly and usefully.',
  'Include visible apps/pages, important UI elements, visible text, errors, warnings, selected items, and likely user intent.',
  'If this is a coding or app screen, identify the relevant files, terminal output, browser state, or UI issue.',
  'Be precise and avoid claiming hidden information that is not visible.',
].join(' ');

const defaultCameraPrompt = [
  'Describe this camera photo clearly and usefully.',
  'Identify visible objects, environment, text, people only in non-sensitive general terms, safety concerns, and anything the user may be asking about.',
  'Do not identify a person by name or infer sensitive traits.',
  'If the image shows a document, product, device, room, object, or issue, explain what is visible and what might be useful to do next.',
].join(' ');

export const desktopTools = {
  readClipboard: tool({
    description: 'Read the current system clipboard text. Use when the user asks ZilMate to inspect copied text, copied errors, URLs, snippets, or prompts.',
    inputSchema: z.object({
      maxCharacters: z.number().int().min(100).max(20_000).optional(),
    }),
    execute: async ({ maxCharacters }) => {
      const text = await readClipboardText();
      const limit = maxCharacters ?? 8000;
      emitProgress({ type: 'fetch:end', label: 'Clipboard read', detail: `${text.length} character${text.length === 1 ? '' : 's'}` });
      return {
        characters: text.length,
        truncated: text.length > limit,
        text: text.slice(0, limit),
      };
    },
  }),

  writeClipboard: tool({
    description: 'Write text to the system clipboard. Use when the user asks ZilMate to copy an answer, command, file path, draft, or summary.',
    inputSchema: z.object({
      text: z.string().min(1).max(100_000),
    }),
    execute: async ({ text }) => {
      await writeClipboardText(text);
      emitProgress({ type: 'tool:end', label: 'Clipboard updated' });
      return { copied: true, characters: text.length };
    },
  }),

  takeScreenshot: tool({
    description: 'Capture the current screen to a local PNG file. Use when the user asks ZilMate to look at the screen or capture current UI state.',
    inputSchema: z.object({}),
    execute: async () => {
      const file = await captureScreenshot();
      emitProgress({ type: 'tool:end', label: 'Screenshot captured', detail: file });
      return { file };
    },
  }),

  analyzeScreenshot: tool({
    description: 'Capture or read a screenshot and analyze it with Gemini 3.1 Flash Lite. Gives a detailed description, visible text, UI/error diagnosis, and optional web search context.',
    inputSchema: z.object({
      path: z.string().min(1).optional().describe('Existing screenshot path. If omitted, ZilMate captures the current screen.'),
      prompt: z.string().min(3).optional(),
      searchWeb: z.boolean().optional().describe('If true, search the web using the screenshot analysis for extra context. Requires Tavily.'),
      maxSearchResults: z.number().int().min(1).max(5).optional(),
    }),
    execute: async ({ path: imagePath, prompt, searchWeb: shouldSearchWeb, maxSearchResults }) => {
      let file = imagePath ? path.resolve(imagePath) : '';
      if (!file) {
        file = await captureScreenshot();
      }

      const analysis = await analyzeImage(file, prompt || defaultScreenshotPrompt);
      let webResults: Awaited<ReturnType<typeof searchWeb>> | undefined;
      if (shouldSearchWeb) {
        webResults = await searchWeb(`Help explain or troubleshoot this screen: ${analysis.slice(0, 800)}`, maxSearchResults ?? 3);
      }
      return {
        file,
        model: models.screenshotVision,
        analysis,
        ...(webResults ? { webResults } : {}),
      };
    },
  }),

  takeCameraPhoto: tool({
    description: 'Open the laptop camera and capture one photo after user approval. Requires ffmpeg on PATH. Use when the user asks ZilMate to look through the camera or take a picture.',
    inputSchema: z.object({
      device: z.string().min(1).optional().describe('Optional ffmpeg camera device. Windows example: video=Integrated Camera; Linux: /dev/video0; macOS: default or device index.'),
    }),
    execute: async ({ device }) => {
      const approved = await confirmDesktopAction('Take camera photo', [
        'Open the laptop camera',
        'Capture one still image',
        ...(device ? [`Device: ${device}`] : []),
      ]);
      if (!approved) throw new Error('Blocked camera capture. Ask the user to approve using the laptop camera.');
      const file = await captureCameraPhoto(device);
      emitProgress({ type: 'tool:end', label: 'Camera photo captured', detail: file });
      return { file };
    },
  }),

  analyzeCameraPhoto: tool({
    description: 'Open the laptop camera, capture one photo, and analyze it with Gemini 3.1 Flash Lite after user approval. Can optionally search the web based on the analysis.',
    inputSchema: z.object({
      device: z.string().min(1).optional(),
      prompt: z.string().min(3).optional(),
      searchWeb: z.boolean().optional(),
      maxSearchResults: z.number().int().min(1).max(5).optional(),
    }),
    execute: async ({ device, prompt, searchWeb: shouldSearchWeb, maxSearchResults }) => {
      const approved = await confirmDesktopAction('Capture and analyze camera photo', [
        'Open the laptop camera',
        'Capture one still image',
        `Send the image to ${models.screenshotVision} for analysis`,
        ...(device ? [`Device: ${device}`] : []),
      ]);
      if (!approved) throw new Error('Blocked camera analysis. Ask the user to approve using the laptop camera.');
      const file = await captureCameraPhoto(device);
      const analysis = await analyzeImage(file, prompt || defaultCameraPrompt, 'camera photo');
      let webResults: Awaited<ReturnType<typeof searchWeb>> | undefined;
      if (shouldSearchWeb) {
        webResults = await searchWeb(`Help explain or troubleshoot this camera image: ${analysis.slice(0, 800)}`, maxSearchResults ?? 3);
      }
      return {
        file,
        model: models.screenshotVision,
        analysis,
        ...(webResults ? { webResults } : {}),
      };
    },
  }),

  openFile: tool({
    description: 'Open a file with its default application. Examples: open a PDF in reader, image in viewer, spreadsheet in Excel, code in editor, or any file with its registered app.',
    inputSchema: z.object({
      path: z.string().min(1).describe('File path to open'),
    }),
    execute: async ({ path: filePath }) => {
      emitProgress({ type: 'tool:start', label: 'Opening file', detail: filePath });

      try {
        const resolvedPath = path.resolve(filePath);
        if (!existsSync(resolvedPath)) {
          throw new Error(`File not found: ${resolvedPath}`);
        }

        if (process.platform === 'win32') {
          await execFileAsync('cmd.exe', ['/c', 'start', '', resolvedPath], { windowsHide: true });
        } else if (process.platform === 'darwin') {
          await execFileAsync('open', [resolvedPath]);
        } else {
          await execFileAsync('xdg-open', [resolvedPath]);
        }

        emitProgress({ type: 'tool:end', label: 'File opened', detail: resolvedPath });
        return { opened: true, path: resolvedPath };
      } catch (error: any) {
        emitProgress({ type: 'tool:error', label: 'Failed to open file', detail: error.message });
        return { opened: false, error: error.message };
      }
    },
  }),

  openApplication: tool({
    description: 'Open an application by name or path. Examples: "chrome", "firefox", "code", "notepad", "explorer", "terminal", etc.',
    inputSchema: z.object({
      application: z.string().min(1).describe('App name or path (e.g., "code", "chrome", "powershell", "/Applications/Safari.app")'),
      args: z.array(z.string()).optional().describe('Command line arguments to pass to the app'),
    }),
    execute: async ({ application, args }) => {
      emitProgress({ type: 'tool:start', label: 'Opening application', detail: application });

      try {
        if (process.platform === 'win32') {
          await execFileAsync('cmd.exe', ['/c', 'start', application, ...(args || [])], { windowsHide: true });
        } else if (process.platform === 'darwin') {
          const openArgs = ['-a', application];
          if (args && args.length > 0) {
            openArgs.push('--args', ...args);
          }
          await execFileAsync('open', openArgs);
        } else {
          await execFileAsync(application, args || []);
        }

        emitProgress({ type: 'tool:end', label: 'Application opened', detail: application });
        return { opened: true, application };
      } catch (error: any) {
        emitProgress({ type: 'tool:error', label: 'Failed to open application', detail: error.message });
        return { opened: false, error: error.message };
      }
    },
  }),

  getSystemInfo: tool({
    description: 'Get system information: OS, CPU, memory, disk, installed apps (Windows/macOS), current user, screen resolution, network, and more.',
    inputSchema: z.object({}),
    execute: async () => {
      emitProgress({ type: 'tool:start', label: 'Fetching system info' });

      try {
        const os = await import('node:os');
        const fs = await import('node:fs/promises');

        const cpus = os.cpus();
        const freeMem = os.freemem();
        const totalMem = os.totalmem();
        const uptime = os.uptime();

        let diskInfo: any = {};
        if (process.platform === 'win32') {
          try {
            const { stdout } = await execFileAsync('wmic', ['logicaldisk', 'get', 'name,size,freespace', '/csv']);
            diskInfo = { raw: stdout };
          } catch {}
        } else {
          try {
            const { stdout } = await execFileAsync('df', ['-h']);
            diskInfo = { raw: stdout };
          } catch {}
        }

        const systemInfo = {
          os: os.platform(),
          arch: os.arch(),
          release: os.release(),
          cpuCores: cpus.length,
          cpuModel: cpus[0]?.model,
          memoryGB: {
            total: (totalMem / (1024 ** 3)).toFixed(2),
            free: (freeMem / (1024 ** 3)).toFixed(2),
            used: ((totalMem - freeMem) / (1024 ** 3)).toFixed(2),
          },
          uptimeHours: (uptime / 3600).toFixed(2),
          nodeVersion: process.version,
          homeDir: os.homedir(),
          userInfo: os.userInfo(),
          ...(Object.keys(diskInfo).length > 0 && { disk: diskInfo }),
        };

        emitProgress({ type: 'tool:end', label: 'System info retrieved' });
        return systemInfo;
      } catch (error: any) {
        return {
          os: process.platform,
          error: error.message,
        };
      }
    },
  }),

  listRunningApplications: tool({
    description: 'List running processes/applications. Windows: tasklist, Unix/Mac: ps aux. Can filter by name.',
    inputSchema: z.object({
      filter: z.string().optional().describe('Filter by app/process name (partial match, case-insensitive)'),
      limit: z.number().int().min(1).max(500).optional().describe('Max apps to list (default: 50)'),
    }),
    execute: async ({ filter, limit }) => {
      emitProgress({ type: 'tool:start', label: 'Listing applications' });

      try {
        let output = '';
        if (process.platform === 'win32') {
          const { stdout } = await execFileAsync('tasklist', { windowsHide: true });
          output = stdout;
        } else {
          const { stdout } = await execFileAsync('ps', ['aux']);
          output = stdout;
        }

        let lines = output.trim().split('\n');
        if (filter) {
          const lowerFilter = filter.toLowerCase();
          lines = lines.filter(line => line.toLowerCase().includes(lowerFilter));
        }

        lines = lines.slice(0, limit ?? 50);

        emitProgress({ type: 'tool:end', label: `Found ${lines.length} applications` });

        return {
          applications: lines,
          count: lines.length,
          filtered: !!filter,
          platform: process.platform,
        };
      } catch (error: any) {
        emitProgress({ type: 'tool:error', label: 'Failed to list applications', detail: error.message });
        return {
          error: error.message,
          applications: [],
          count: 0,
        };
      }
    },
  }),

  simulateKeyboard: tool({
    description: 'Send keyboard input to the system. Use for automation: typing text, pressing keys (Enter, Tab, Esc, arrow keys), hotkeys (Ctrl+C, Ctrl+V, Ctrl+S, Alt+Tab), etc.',
    inputSchema: z.object({
      input: z.string().min(1).describe('Text to type or key to press (e.g., "Hello World", "Enter", "Ctrl+C", "Alt+Tab", "Escape")'),
    }),
    execute: async ({ input }) => {
      emitProgress({ type: 'tool:start', label: 'Sending keyboard input', detail: input });

      try {
        const { execSync } = await import('node:child_process');

        if (process.platform === 'win32') {
          const ps = `Add-Type -AssemblyName System.Windows.Forms;[System.Windows.Forms.SendKeys]::SendWait('${input.replace(/'/g, "''")}')'`;
          execSync(`powershell.exe -Command "${ps}"`, { windowsHide: true });
        } else if (process.platform === 'darwin') {
          const script = `tell application "System Events" to keystroke "${input.replace(/"/g, '\\"')}"`;
          execSync(`osascript -e '${script}'`);
        } else {
          // Linux: try xdotool
          execSync(`xdotool type '${input.replace(/'/g, "'\\''")}'`);
        }

        emitProgress({ type: 'tool:end', label: 'Keyboard input sent' });
        return { sent: true, input };
      } catch (error: any) {
        emitProgress({ type: 'tool:error', label: 'Failed to send keyboard input', detail: error.message });
        return { sent: false, error: error.message };
      }
    },
  }),

  simulateMouse: tool({
    description: 'Simulate mouse movements, clicks, drags, or scrolls. Use for automating GUI interactions, clicking buttons, scrollable areas, etc.',
    inputSchema: z.object({
      action: z.enum(['click', 'double-click', 'right-click', 'move', 'drag', 'scroll']).describe('Mouse action to simulate'),
      x: z.number().int().optional().describe('X coordinate (pixels) from the top-left of the primary screen'),
      y: z.number().int().optional().describe('Y coordinate (pixels) from the top-left of the primary screen'),
      endX: z.number().int().optional().describe('Ending X coordinate for drag action'),
      endY: z.number().int().optional().describe('Ending Y coordinate for drag action'),
      scrollAmount: z.number().int().optional().describe('Amount to scroll (default 120. Positive for scroll up, negative for scroll down)'),
    }),
    execute: async ({ action, x, y, endX, endY, scrollAmount }) => {
      emitProgress({ type: 'tool:start', label: 'Simulating mouse action', detail: `${action} at (${x ?? 'current'}, ${y ?? 'current'})` });
      try {
        await simulateMouseAction(action, x, y, endX, endY, scrollAmount);
        emitProgress({ type: 'tool:end', label: 'Mouse action simulated' });
        return { success: true, action };
      } catch (error: any) {
        emitProgress({ type: 'tool:error', label: 'Mouse action failed', detail: error.message });
        return { success: false, error: error.message };
      }
    },
  }),

  displaySystemNotification: tool({
    description: 'Display a native OS toast, banner, or alert notification with a custom title and message.',
    inputSchema: z.object({
      title: z.string().min(1).describe('The title of the notification'),
      message: z.string().min(1).describe('The main body message of the notification'),
    }),
    execute: async ({ title, message }) => {
      emitProgress({ type: 'tool:start', label: 'Displaying system notification', detail: title });
      try {
        await showNotification(title, message);
        emitProgress({ type: 'tool:end', label: 'System notification displayed' });
        return { success: true };
      } catch (error: any) {
        emitProgress({ type: 'tool:error', label: 'Failed to display notification', detail: error.message });
        return { success: false, error: error.message };
      }
    },
  }),

  recordAudioSnippet: tool({
    description: 'Record an audio snippet from the microphone/audio input device as a WAV file. Requires ffmpeg.',
    inputSchema: z.object({
      durationSeconds: z.number().int().min(1).max(60).describe('Duration of the audio recording in seconds (max 60)'),
    }),
    execute: async ({ durationSeconds }) => {
      emitProgress({ type: 'tool:start', label: 'Recording audio snippet', detail: `${durationSeconds}s` });
      try {
        const file = await recordAudio(durationSeconds);
        emitProgress({ type: 'tool:end', label: 'Audio snippet recorded', detail: file });
        return { success: true, file, durationSeconds };
      } catch (error: any) {
        emitProgress({ type: 'tool:error', label: 'Failed to record audio', detail: error.message });
        return { success: false, error: error.message };
      }
    },
  }),

  getActiveWindowContext: tool({
    description: 'Retrieve context of the active, foreground window, including application process name, window title, and process ID (PID) if available.',
    inputSchema: z.object({}),
    execute: async () => {
      emitProgress({ type: 'tool:start', label: 'Retrieving active window context' });
      try {
        const context = await getActiveWindow();
        emitProgress({ type: 'tool:end', label: 'Active window context retrieved', detail: context.title || context.process || 'Unknown' });
        return { success: true, ...context };
      } catch (error: any) {
        emitProgress({ type: 'tool:error', label: 'Failed to retrieve active window context', detail: error.message });
        return { success: false, error: error.message };
      }
    },
  }),

  controlSystemVolume: tool({
    description: 'Control system audio volume, mute status, or simulate media playback keys (play/pause, next, previous track).',
    inputSchema: z.object({
      action: z.enum(['set', 'mute', 'unmute', 'get', 'media-play-pause', 'media-next', 'media-prev']).describe('Volume or media key action to perform'),
      level: z.number().int().min(0).max(100).optional().describe('Volume percentage level (0 to 100), required only when action is "set"'),
    }),
    execute: async ({ action, level }) => {
      emitProgress({ type: 'tool:start', label: 'Controlling system volume/media', detail: action });
      try {
        const result = await controlVolume(action, level);
        emitProgress({ type: 'tool:end', label: 'System volume/media controlled' });
        return result;
      } catch (error: any) {
        emitProgress({ type: 'tool:error', label: 'Failed to control system volume/media', detail: error.message });
        return { success: false, error: error.message };
      }
    },
  }),
};
