// src/cli/composer.ts
import readline from 'node:readline/promises';
import { theme, termWidth, boxLine, wrapText } from './theme.js';
import { resetProgressDisplay } from './format.js';

function enableBracketedPaste() {
  if (process.stdin.isTTY) {
    process.stdout.write('\x1b[?2004h');
  }
}

function disableBracketedPaste() {
  if (process.stdin.isTTY) {
    process.stdout.write('\x1b[?2004l');
  }
}

function showCursor() {
  if (process.stdout.isTTY) {
    process.stdout.write('\x1b[?25h');
  }
}

export async function readComposerLine(
  rl: readline.Interface,
  placeholder = 'Try "plan my week" or "build a Next.js dashboard"',
): Promise<string> {
  resetProgressDisplay(false);
  disableBracketedPaste();
  showCursor();

  const w = termWidth(92);

  console.log('');
  console.log(boxLine('top', w));
  console.log(theme.accent('│ ') + theme.dim(placeholder));

  const promptPrefix = theme.accent('│ ') + theme.brandBright('> ');

  let multilineMode = false;

  try {
    enableBracketedPaste();

    const finalMessage = await new Promise<string>((resolve, reject) => {
      let buffer: string[] = [];
      let timeout: NodeJS.Timeout | null = null;
      let bracketedPasteActive = false;
      let settled = false;

      const cleanup = () => {
        if (settled) return;
        settled = true;
        disableBracketedPaste();
        rl.removeListener('line', onLine);
        rl.removeListener('close', onClose);
        if (timeout) clearTimeout(timeout);
      };

      const finish = (value: string) => {
        cleanup();
        resolve(value);
      };

      const onClose = () => {
        cleanup();
        reject(new Error('readline was closed'));
      };

      process.stdout.write(promptPrefix);

      const onLine = (line: string) => {
        let currentLine = line;

        if (currentLine.includes('\x1b[200~')) {
          bracketedPasteActive = true;
          currentLine = currentLine.replace('\x1b[200~', '');
        }

        const hasEndMarker = currentLine.includes('\x1b[201~');
        if (hasEndMarker) {
          currentLine = currentLine.replace('\x1b[201~', '');
        }

        const trimmed = currentLine.trim();

        if (bracketedPasteActive) {
          buffer.push(currentLine);
          if (hasEndMarker) {
            bracketedPasteActive = false;
            finish(buffer.join('\n'));
          }
          return;
        }

        if (multilineMode) {
          if (!trimmed) {
            finish(buffer.join('\n'));
            return;
          }
          buffer.push(line);
          process.stdout.write(theme.accent('│ ') + theme.brandBright('  '));
          return;
        }

        if (buffer.length === 0 && (trimmed === '/multiline' || trimmed === '/paste')) {
          multilineMode = true;
          console.log(theme.accent('│ ') + theme.muted(' (Multiline mode: Type your message. Send an empty line to finish.)'));
          process.stdout.write(theme.accent('│ ') + theme.brandBright('  '));
          return;
        }

        if (trimmed.endsWith('\\')) {
          buffer.push(line.slice(0, -1));
          if (timeout) {
            clearTimeout(timeout);
            timeout = null;
          }
          process.stdout.write(theme.accent('│ ') + theme.brandBright('  '));
          return;
        }

        buffer.push(line);

        if (timeout) clearTimeout(timeout);

        timeout = setTimeout(() => {
          finish(buffer.join('\n'));
        }, 50);
      };

      rl.on('line', onLine);
      rl.on('close', onClose);
    });

    const linesSplit = finalMessage.split('\n');

    const promptLen = 4;
    let linesUsed = 1;
    linesUsed += 1;
    linesUsed += 1;

    if (multilineMode) {
      linesUsed += 1;
    }

    for (let i = 0; i < linesSplit.length; i++) {
      const line = linesSplit[i];
      if (line !== undefined) {
        const wrapped = wrapText(line, w - promptLen);
        linesUsed += Math.max(1, wrapped.length);
      }
    }

    if (multilineMode) {
      linesUsed += 1;
      linesUsed += 1;
    }

    for (let i = 0; i < linesUsed; i++) {
      process.stdout.write('\x1b[1A\x1b[2K');
    }

    return finalMessage;
  } finally {
    disableBracketedPaste();
    showCursor();
  }
}
