# Changelog

All notable changes to ZilMate are documented here.

## [1.12.2] - 2026-07-27

### Added

- Added optional Ubiquity screen context with `ZILMATE_UBIQUITY_SCREEN_CONTEXT=true`.
- Added setup support via `zilmate setup --ubiquity-screen-context true`.
- Added setup prompt support so users can enable screen-aware `@zilmate` hotkey rewrites interactively.
- Added doctor visibility for Ubiquity screen context status.
- Exported desktop screenshot analysis helpers so daemon requests can capture and analyze current screen context before composing selected-text replies.

### Changed

- `@zilmate` Ubiquity requests can now enrich prompts with active window metadata, screenshot file path, and vision-model screen analysis when screen context is enabled.
- Bumped package and CLI version from `1.12.1` to `1.12.2`.
- Updated README version badge and environment examples for Ubiquity screen context.

### Privacy

- Ubiquity screen context is disabled by default.
- When enabled, screenshots are only captured during authenticated local `@zilmate` Ubiquity processing and are used to understand visible app context such as Telegram, WhatsApp, email, browser, editor, or form state.

## [1.12.1] - 2026-07-27

### Fixed

- Reworked the interactive `zilmate talk` composer so pasted text, slash commands, and terminal control keys behave more reliably on Windows terminals.
- Fixed slash command input so `/model`, `/mcp`, and other slash commands keep the leading `/`.
- Fixed doubled printable text when terminals emit both raw `data` and `keypress` events.
- Fixed Ctrl+C handling in both the composer and active agent runs, including terminals that report Ctrl+C as enhanced keyboard sequences.
- Fixed repeated prompt-line redraws while typing by removing padded input rendering.
- Improved long pasted text rendering by anchoring composer redraws to the original input position and clearing downward before repainting.
- Removed `/paste` and `/multiline` from slash suggestions because the composer now accepts pasted and multi-line input directly.

### Changed

- Bumped package and CLI version from `1.12.0` to `1.12.1`.
- Updated `/help` guidance to point users toward direct paste and `Shift+Enter` for new lines.
- Added focused regression coverage for slash completion, enhanced keyboard printable input, normal slash input, and Ctrl+C decoding.

## [1.12.0] - 2026-07-27

### Added

- Added the ZilMate CEO Dashboard interactive chat entrypoint with `/help`, `/swarm`, `/model`, `/mcp`, `/skills`, `/voice`, `/heal`, and `/clear` command affordances.
- Added slash-command autocomplete and suggestion selection for common interactive commands.
- Added the ZilMate Ubiquity daemon for system-wide selected-text processing through a local authenticated HTTP service.
- Added Windows global hotkey listener support through `src/daemon/win-listener.ps1`.
- Added macOS LaunchAgent and Quick Action installer support through `src/daemon/mac-installer.ts`.
- Added the Web Command Center daemon surface for local browser access to chat, models, traces, MCP, skills, apps, doctor checks, and voice controls.
- Added background job management commands for creating, listing, running, cancelling, logging, listening, and processing scheduled jobs.
- Added Composio trigger management and webhook orchestration for external app events.
- Added realtime voice setup, diagnostics, device listing, live mode, speak test, transcript turn testing, and Deepgram agent probing.
- Added camera diagnostics, device listing, and still-image capture support.
- Added durable memory commands for remembering, recalling, forgetting, clearing, and listing long-term memories.
- Added workspace management, `heal`, and notebook/knowledge graph update flows.
- Added model browser and model selection flows for AI Gateway routing.
- Added environment setup and doctor commands for local readiness checks.
- Added SDK/server exports for embedding ZilMate manager, swarm, memory, jobs, and host utilities into Node and backend runtimes.
- Added documentation for architecture, agents, workflows, integrations, testing, deployment, observability, chat integrations, Web Command Center, and Ubiquity.

### Changed

- Expanded ZilMate from a CLI assistant into a broader local operating system for agents, background jobs, voice, web control, Ubiquity, and app-trigger orchestration.
- Standardized the installable package and command identity around `zilmate`.
- Improved setup flows for optional Composio, Tavily, Upstash Redis, QStash, Deepgram, camera, file roots, and storage providers.
- Improved terminal UX with richer dashboards, progress displays, confirmation prompts, and command guidance.
- Updated local daemon responsibilities from a single hotkey bridge into a co-located authenticated API gateway for Web Command Center and platform integrations.

### Security

- Added local daemon bearer-token authorization using a per-run token written to `~/.zilmate-token`.
- Added sensitive file protections for `.env`, keys, credentials, and token-looking local paths.
- Added safety confirmation flows around critical system actions and write-like external app operations.
- Bound daemon service access to `127.0.0.1` for local-only operation.

### Documentation

- Added broad developer and operator docs under `docs/`.
- Added `UBIQUITY.md` for the system-wide hotkey and selected-text workflow.
- Added `SDK.md` for server-side SDK usage and architectural concepts.

### Known Gaps

- `UBIQUITY.md` still references `/run-prompt` in places while the implemented daemon endpoint is `POST /process`.
- Daemon route handling in `src/daemon/service.ts` has grown large and should be split into focused route modules.
- Clipboard preservation in the Windows listener is currently text-oriented and should be upgraded to full clipboard-format preservation.

## Project Roadmap

### CLI & Composer

- Add first-class cursor movement and mid-line editing in the custom composer.
- Add deterministic terminal capability detection for `Shift+Enter` across Windows Terminal, PowerShell, classic console host, macOS Terminal, and iTerm.
- Add a debug key-sequence mode for diagnosing terminal input issues.
- Add snapshot-style terminal rendering tests for the composer.

### Daemon & Web Command Center

- Split daemon routes into focused modules with shared request parsing, response helpers, authentication, and body-size limits.
- Add `/api/health` with version, uptime, listener status, token state, active tasks, active voice session, and route readiness.
- Replace hard-coded daemon status version values with package version.
- Add graceful daemon shutdown and restart support.
- Add listener heartbeat, listener restart, and listener self-test endpoints.
- Add event streaming for long-running daemon requests and agent progress.

### Ubiquity

- Add response modes: replace, append, prepend, copy-only, summarize, rewrite, reply, explain, and translate.
- Add full clipboard-format preservation on Windows.
- Add robust JSON serialization in macOS Quick Action and Windows listener payloads.
- Add configurable global hotkeys per platform.
- Add explicit notifications for no selection, daemon offline, auth failure, timeout, and success.

### Agents & Swarm

- Add durable task checkpoints so long swarm workflows can resume after interruption.
- Add richer trace visualization and specialist-level execution summaries.
- Add stricter tool-result verification before reporting external state changes.
- Add configurable departmental routing policies and budgets.

### Jobs & Triggers

- Add stronger idempotency controls for incoming webhooks and recurring jobs.
- Add job retry policies, dead-letter queues, and execution backoff controls.
- Add richer job run analytics and failure categorization.

### Voice & Desktop Context

- Improve barge-in, interruption, and wake/sleep behavior for live voice.
- Add more robust audio device diagnostics and cross-platform setup hints.
- Add richer camera/screenshot context flows while preserving privacy and sensitive-data boundaries.

### SDK

- Stabilize public SDK types and add more examples for Next.js, Express, chat adapters, and background workers.
- Add contract tests for SDK methods that map to CLI behavior.
- Add clearer boundaries between server-only APIs and client-safe surfaces.
