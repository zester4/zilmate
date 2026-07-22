import readline from 'node:readline/promises';
import type { AskHandler } from '../runtime/ask.js';
import { selectMany, selectOne } from './prompt.js';
import chalk from 'chalk';
import { pauseThinkingTicker, resumeThinkingTicker } from './format.js';

export function createReadlineAskHandler(
  rl: readline.Interface,
  rlPaused?: { value: boolean },
): AskHandler {
  return async (request) => {
    pauseThinkingTicker();
    const wasPaused = rlPaused?.value ?? false;
    if (!wasPaused) {
      rl.pause();
      if (rlPaused) rlPaused.value = true;
    }

    try {
      console.log(chalk.bold.cyan(`\n${request.question}`));
      const options = request.options.map((option) => ({
        id: option.id,
        label: option.label,
        ...(option.description ? { description: option.description } : {}),
      }));

      if (request.allowMultiple) {
        const picked = await selectMany('Select one or more (space toggles, enter confirms)', options);
        return picked.map((item) => item.id);
      }

      const picked = await selectOne('Select an option (↑↓ move, enter confirms)', options, 0);
      return picked ? [picked.id] : null;
    } finally {
      resumeThinkingTicker();
      if (!wasPaused && rlPaused?.value) {
        rl.resume();
        rlPaused.value = false;
      }
    }
  };
}

export function createTerminalAskHandler(): AskHandler {
  return async (request) => {
    if (!process.stdin.isTTY || !process.stdout.isTTY) return null;
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      return await createReadlineAskHandler(rl)(request);
    } finally {
      rl.close();
    }
  };
}
