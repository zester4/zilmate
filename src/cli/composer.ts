// src/cli/composer.ts
import readline from 'node:readline/promises';
import * as readlineBase from 'node:readline';
import type { Key } from 'node:readline';
import { theme, termWidth, boxLine } from './theme.js';
import { resetProgressDisplay } from './format.js';

const SLASH_COMMANDS = [
  '/exit',
  '/quit',
  '/clear',
  '/help',
  '/mcp',
  '/mcp list',
  '/mcp add',
  '/mcp remove',
  '/mcp restart',
  '/model',
  '/model pick',
  '/model next',
  '/voice',
  '/swarm',
  '/heal',
  '/skills',
] as const;

export function getSlashCommandSuggestions(input: string): string[] {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return [];

  const normalized = trimmed.toLowerCase();
  const normalizedRoot = normalized.split(/\s+/)[0] ?? normalized;

  const exactMatches = SLASH_COMMANDS.filter((command) => {
    const commandText = command.toLowerCase();
    return commandText.startsWith(normalized);
  });

  if (exactMatches.length > 0) {
    return exactMatches;
  }

  const familyMatches = SLASH_COMMANDS.filter((command) => {
    const commandText = command.toLowerCase();
    const commandRoot = commandText.split(/\s+/)[0] ?? commandText;
    if (commandRoot === normalizedRoot) {
      return true;
    }
    if (normalizedRoot === '/mod' && commandRoot === '/model') {
      return true;
    }
    if (normalizedRoot === '/modj' && commandRoot === '/model') {
      return true;
    }
    return false;
  });

  return familyMatches;
}

export function selectSlashCommandSuggestion(input: string, index = 0): string | null {
  const suggestions = getSlashCommandSuggestions(input);
  if (suggestions.length === 0) return null;
  return suggestions[Math.min(index, suggestions.length - 1)] ?? null;
}

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

function enableEnhancedKeyboard() {
  if (process.stdin.isTTY) {
    process.stdout.write('\x1b[>4;2m\x1b[>1u');
  }
}

function disableEnhancedKeyboard() {
  if (process.stdin.isTTY) {
    process.stdout.write('\x1b[>4;m\x1b[<u');
  }
}

function showCursor() {
  if (process.stdout.isTTY) {
    process.stdout.write('\x1b[?25h');
  }
}

function normalizeInputText(text: string) {
  return text
    .replace(/\x1b\[200~/g, '')
    .replace(/\x1b\[201~/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
}

export function decodeEnhancedKeyboardInput(text: string): string {
  let decoded = '';
  const sequencePattern = /\x1b\[(\d+)(?:;(\d+))?u/g;
  for (const match of text.matchAll(sequencePattern)) {
    const codepoint = Number(match[1]);
    const modifier = match[2] ? Number(match[2]) : 1;
    if (modifier <= 2 && codepoint >= 32 && codepoint !== 127) {
      decoded += String.fromCodePoint(codepoint);
    }
  }
  return decoded;
}

function isShiftEnterSequence(sequence: string | undefined) {
  return sequence === '\x1b[13;2u' || sequence === '\x1b[27;2;13~' || sequence === '\x1b[13;2~';
}

export function isCtrlCInput(text: string) {
  if (text.includes('\u0003')) return true;
  for (const match of text.matchAll(/\x1b\[(\d+);(\d+)u/g)) {
    const codepoint = Number(match[1]);
    const modifier = Number(match[2]);
    const hasCtrl = (modifier - 1 & 4) === 4;
    if (hasCtrl && (codepoint === 67 || codepoint === 99)) return true;
  }
  return false;
}

export function isPrintableInput(text: string) {
  if (text.length === 0) return false;
  for (const char of text) {
    const codepoint = char.codePointAt(0) ?? 0;
    if (codepoint < 32 || codepoint === 127) return false;
  }
  return true;
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
  const continuationPrefix = theme.accent('│ ') + theme.brandBright('  ');
  const terminalWidth = Math.max(20, Math.min(process.stdout.columns || w, w));
  const promptColumns = 4;
  let renderedComposerRows = 1;
  let inputAnchorSaved = false;

  try {
    enableBracketedPaste();
    enableEnhancedKeyboard();
    if (process.stdin.isTTY) {
      readlineBase.emitKeypressEvents(process.stdin);
    }
    if (process.stdin.isTTY && !process.stdin.isRaw) {
      process.stdin.setRawMode(true);
    }

    const finalMessage = await new Promise<string>((resolve, reject) => {
      let bracketedPasteActive = false;
      let settled = false;
      let suggestionIndex = -1;
      let suggestionList: string[] = [];
      let value = '';
      let suppressKeypressUntil = 0;

      const clearRender = () => {
        if (inputAnchorSaved) {
          process.stdout.write('\x1b[u\x1b[J');
        }
      };

      const updateSuggestions = () => {
        const trimmed = value.trim();
        suggestionList = !value.includes('\n') && trimmed.startsWith('/') ? getSlashCommandSuggestions(value) : [];
        if (suggestionList.length === 0) {
          suggestionIndex = -1;
        } else if (suggestionIndex < 0 || suggestionIndex >= suggestionList.length) {
          suggestionIndex = 0;
        }
      };

      const render = () => {
        updateSuggestions();
        clearRender();

        const rows: string[] = [];
        let physicalRows = 0;
        const countPhysicalRows = (visibleColumns: number) => Math.max(1, Math.floor(visibleColumns / terminalWidth) + 1);
        const logicalLines = value.split('\n');
        for (let lineIndex = 0; lineIndex < logicalLines.length; lineIndex++) {
          const logicalLine = logicalLines[lineIndex] ?? '';
          const isFirstRow = lineIndex === 0;
          rows.push(`${isFirstRow ? promptPrefix : continuationPrefix}${logicalLine}`);
          physicalRows += countPhysicalRows(promptColumns + logicalLine.length);
        }

        if (suggestionList.length > 0) {
          rows.push(theme.dim('  ↳ '));
          physicalRows += 1;
          for (const [index, suggestion] of suggestionList.slice(0, 4).entries()) {
            const styled = index === suggestionIndex ? theme.brandBright(suggestion) : theme.muted(suggestion);
            rows.push(`${theme.dim('  · ')}${styled}`);
            physicalRows += 1;
          }
        }

        process.stdout.write(rows.join('\n'));
        renderedComposerRows = physicalRows;
      };

      const insertText = (text: string) => {
        value += normalizeInputText(text);
        render();
      };

      const cleanup = () => {
        if (settled) return;
        settled = true;
        disableBracketedPaste();
        rl.removeListener('close', onClose);
        process.stdin.removeListener('data', onData);
        process.stdin.removeListener('keypress', onKeypress);
        rl.resume();
        if (process.stdin.isTTY && process.stdin.isRaw) {
          process.stdin.setRawMode(false);
        }
      };

      const finish = () => {
        cleanup();
        resolve(value);
      };

      const onClose = () => {
        cleanup();
        reject(new Error('readline was closed'));
      };

      const onData = (chunk: Buffer | string) => {
        const text = String(chunk);
        if (isCtrlCInput(text)) {
          cleanup();
          reject(new Error('aborted'));
          return;
        }

        if (isShiftEnterSequence(text)) {
          suppressKeypressUntil = Date.now() + 30;
          insertText('\n');
          return;
        }

        const startsPaste = text.includes('\x1b[200~');
        const endsPaste = text.includes('\x1b[201~');
        if (bracketedPasteActive || startsPaste) {
          bracketedPasteActive = !endsPaste;
          suppressKeypressUntil = Date.now() + 30;
          insertText(text);
          return;
        }

        const enhancedText = decodeEnhancedKeyboardInput(text);
        if (enhancedText) {
          suppressKeypressUntil = Date.now() + 30;
          insertText(enhancedText);
          return;
        }

        if (isPrintableInput(text)) {
          suppressKeypressUntil = Date.now() + 30;
          insertText(text);
          return;
        }

        if (text.length > 1 && !text.startsWith('\x1b[') && !text.includes('\u0003')) {
          suppressKeypressUntil = Date.now() + 30;
          insertText(text);
        }
      };

      const onKeypress = (str: string, key: Key) => {
        if (Date.now() < suppressKeypressUntil || bracketedPasteActive) return;
        if (!key || typeof key.name !== 'string') return;

        const shouldSuggest = !value.includes('\n') && value.trim().startsWith('/') && suggestionList.length > 0;

        if (key.name === 'tab' && shouldSuggest) {
          const selected = suggestionList[suggestionIndex >= 0 ? suggestionIndex : 0] ?? suggestionList[0];
          if (selected) {
            value = selected;
            suggestionIndex = suggestionList.indexOf(selected);
            render();
          }
          return;
        }

        if (key.name === 'up' || key.name === 'down') {
          if (!shouldSuggest) return;
          if (key.name === 'up') {
            suggestionIndex = suggestionIndex <= 0 ? suggestionList.length - 1 : suggestionIndex - 1;
          } else {
            suggestionIndex = suggestionIndex >= suggestionList.length - 1 ? 0 : suggestionIndex + 1;
          }
          const selected = suggestionList[suggestionIndex] ?? suggestionList[0];
          if (selected) {
            value = selected;
            render();
          }
          return;
        }

        if (key.name === 'return' || key.name === 'enter') {
          if (key.shift || isShiftEnterSequence(key.sequence)) {
            insertText('\n');
            return;
          }
          if (!value.trim()) {
            render();
            return;
          }
          if (shouldSuggest) {
            const selected = selectSlashCommandSuggestion(value, suggestionIndex >= 0 ? suggestionIndex : 0);
            if (selected) {
              value = selected;
              finish();
              return;
            }
          }
          finish();
          return;
        }

        if (key.name === 'backspace') {
          value = value.slice(0, -1);
          render();
          return;
        }

        if (key.name === 'delete') {
          return;
        }

        if (key.ctrl && key.name === 'c') {
          cleanup();
          reject(new Error('aborted'));
          return;
        }

        if (key.ctrl && key.name === 'd') {
          if (!value) {
            cleanup();
            reject(new Error('readline was closed'));
          }
          return;
        }

        if (key.name === 'escape' || key.name === 'left' || key.name === 'right') {
          return;
        }

        // Printable characters are inserted from the raw data event. Keeping
        // keypress for controls only prevents doubled text on terminals that
        // emit both data and keypress for normal characters.
      };

      rl.pause();
      rl.on('close', onClose);
      process.stdin.on('data', onData);
      process.stdin.on('keypress', onKeypress);
      process.stdin.resume();
      process.stdout.write('\x1b[s');
      inputAnchorSaved = true;
      render();
    });

    if (inputAnchorSaved) {
      process.stdout.write('\x1b[u\x1b[J');
    } else {
      const rowsToClear = renderedComposerRows + 2;
      process.stdout.write('\r');
      for (let i = 0; i < rowsToClear; i++) {
        process.stdout.write('\x1b[2K');
        if (i < rowsToClear - 1) {
          process.stdout.write('\x1b[1A');
        }
      }
      process.stdout.write('\r');
    }

    return finalMessage;
  } finally {
    disableBracketedPaste();
    disableEnhancedKeyboard();
    showCursor();
  }
}
