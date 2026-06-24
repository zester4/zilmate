# ZilMate Chat Integration Guide

ZilMate is now a fully multi-channel agent. You can communicate with it via **Slack**, **Telegram**, **iMessage**, and the **Terminal** simultaneously, with a unified brain and persistent memory.

## 1. Professional Setup & Diagnostics

As the project owner, I've integrated Chat as a first-class citizen. Use the built-in wizard to configure your bots.

### Interactive Setup
```bash
# Configure everything
zilmate setup

# OR configure chat specifically
zilmate setup chat
```

You will be prompted for:
*   **Slack:** Bot Token and Signing Secret.
*   **Telegram:** Bot Token.
*   **iMessage:** Local macOS mode or Remote Photon mode.

### Health Checks
```bash
zilmate doctor
```
The doctor verifies your channel configurations and ensures adapters are ready.

## 2. Running the Chat Bot (Production Grade)

Once configured, start the production listener. This connects to all enabled platforms and starts processing messages.

```bash
zilmate chat listen
```

*   **Persistent Sessions:** ZilMate automatically maps users to unique session IDs (e.g., `chat-slack-U12345`). This ensures that if you start a task on Slack, the agent remembers it when you follow up on Telegram.
*   **Shared Brain:** The same Manager used in the CLI handles your chat messages, giving you full orchestration and tool access (Stripe, GitHub, etc.) from your phone.

## 3. Trigger-Based Proactive Reporting

ZilMate doesn't just wait for you to speak; it can report to you.

### Automatic Event Responses
Using the `TriggerOrchestrator`, ZilMate can detect events (like a Stripe payout or a GitHub push) and proactively send a summary to your Telegram or Slack.

### Scheduled Briefings
```bash
# Create a scheduled report
zilmate jobs create "At 9 AM, research my competitor's latest news and send a summary to Slack." --schedule "0 9 * * *"
```

## 4. Architecture Reference

The integration is built on the [Chat SDK](https://github.com/vercel/chat), providing a stable normalization layer for:
*   `@chat-adapter/slack`
*   `@chat-adapter/telegram`
*   `chat-adapter-imessage` (Supports local macOS DB and remote bridge)

## 5. Terminal vs Chat Parity

You have 100% feature parity.
*   **Terminal:** Use `zilmate talk` for deep work.
*   **Chat:** Use Telegram/Slack for mobile access and alerts.
*   **SDK:** Use `createZilMate()` to build custom UI integrations.

All interfaces share the same **Workspace Memory**, ensuring ZilMate stays smart regardless of where you talk to it.
