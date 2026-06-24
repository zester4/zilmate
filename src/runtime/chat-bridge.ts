import { createZilMate } from '../index.js';
import { env, hasChatIntegration } from '../config/env.js';
import { emitProgress } from './progress.js';

/**
 * The ChatBridge provides a high-level integration between external chat adapters
 * (Slack, Telegram, etc.) and the ZilMate Manager.
 *
 * Production-grade features:
 * - Persistent sessionId per user/platform
 * - Progress/typing indicator hooks
 * - Error reporting to the user
 */
export async function handleChatMessage(input: {
  text: string;
  authorId: string;
  platform: 'slack' | 'telegram' | 'teams' | 'discord' | 'imessage';
  threadId?: string;
  onReply: (text: string) => Promise<void>;
  onStep?: (label: string) => Promise<void>;
}) {
  const sessionId = `chat-${input.platform}-${input.authorId}`;

  emitProgress({
    type: 'thinking',
    label: `Processing ${input.platform} message`,
    detail: `User ${input.authorId}`
  });

  const zilmate = createZilMate({
    sessionId,
    onProgress: async (event) => {
      if (event.type === 'step' && input.onStep) {
        await input.onStep(event.label);
      }
    },
  });

  try {
    const { text } = await zilmate.manager({ message: input.text });
    await input.onReply(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[ChatBridge] Manager error: ${message}`);
    await input.onReply(`⚠️ ZilMate encountered an error: ${message}`);
    throw error;
  }
}

/**
 * Proactive reporting core.
 * Use this to push messages from background jobs to your chat channels.
 */
export async function pushChatNotification(input: {
  message: string;
  platform: 'slack' | 'telegram' | 'imessage';
  recipientId: string;
}) {
  if (!hasChatIntegration()) {
    throw new Error('Chat integration is not configured or enabled.');
  }

  // Implementation logic for pushing to specific platform APIs
  console.log(`[ChatBridge] Pushing proactive alert to ${input.platform} [${input.recipientId}]: ${input.message.slice(0, 50)}...`);

  // Future implementation for direct API pushes without @vercel/chat if needed
}
