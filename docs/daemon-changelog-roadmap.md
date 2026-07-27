# ZilMate Daemon Changelog & Expansion Roadmap

## Current Daemon Snapshot

The daemon is no longer just a Ubiquity hotkey bridge. `src/daemon/service.ts` now acts as the local operating surface for:

- Ubiquity selected-text processing through `POST /process`.
- Web Command Center static assets and APIs.
- Chat sessions, history clearing, model selection, MCP config, skills, apps, traces, and doctor checks.
- Background install actions for Playwright and rembg.
- Voice status, configuration, speak test, start session, and stop session APIs.
- Composio/custom webhook listener orchestration.
- Windows global hotkey listener startup.

The platform bridge files are narrower:

- `src/daemon/win-listener.ps1` registers `Ctrl+Shift+Z`, copies selected text, calls `POST /process`, pastes the result, restores clipboard text, and logs to `~/.zilmate-listener.log`.
- `src/daemon/mac-installer.ts` installs a LaunchAgent plus a macOS Quick Action workflow bound to `Cmd+Shift+Z`.

## Proposed Changelog

### Added

- Local daemon token generation with per-run bearer token written to `~/.zilmate-token`.
- Authenticated local daemon API surface for Ubiquity, Web Command Center, chat, traces, MCP, models, doctor, voice, apps, and webhook orchestration.
- Windows global hotkey listener using WinForms `RegisterHotKey` and clipboard-driven in-place replacement.
- macOS LaunchAgent installation and Quick Action workflow generation.
- Native OS notifications for daemon start, Ubiquity processing, and response readiness.
- Background dependency repair actions exposed through daemon doctor APIs.
- Web voice-session lifecycle endpoints with event buffering and speech cleanup.

### Changed

- Ubiquity processing endpoint is implemented as `POST /process`; docs that still mention `/run-prompt` should be updated.
- Daemon status currently returns a hard-coded API version; it should reflect `package.json` or `program.version()`.
- Daemon has expanded from hotkey bridge into a local API gateway, so route organization should be split before it becomes harder to maintain.

### Security

- Local API requests require `Authorization: Bearer <token>` or the configured webhook secret.
- Token is removed on `exit`, `SIGINT`, and `SIGTERM`.
- Requests are bound to `127.0.0.1`, reducing remote exposure.

### Known Gaps

- Request body size is unbounded in several handlers.
- Many JSON parsers are repeated and do not share consistent error handling.
- CORS allows `*`, even though most authenticated daemon APIs are intended for local clients.
- Windows listener preserves only text clipboard content, not rich formats, images, files, or multi-format clipboard state.
- macOS workflow shell command builds JSON manually, which can break on complex selected text.
- Windows stop command kills listener processes but does not gracefully stop the Node daemon.
- No structured `/api/health` with listener state, token state, uptime, route versions, or active background tasks.
- No daemon route tests or listener contract tests.

## Expansion Plan By File

### `src/daemon/service.ts`

Priority 1: make the daemon reliable and maintainable.

- Split route handling into modules: `ubiquity`, `chat`, `voice`, `doctor`, `models`, `mcp`, `webhooks`, `static`.
- Add shared helpers: `readJsonBody`, `sendJson`, `sendError`, `requireAuth`, `methodNotAllowed`, `limitBodySize`.
- Add max request size defaults, for example 1 MB for chat and Ubiquity, lower for config writes.
- Add request IDs and structured logs for every daemon request.
- Add `/api/health` with `version`, `uptime`, `port`, `platform`, `tokenAvailable`, `listener`, `activeVoiceSession`, and `installations`.
- Replace hard-coded status version `3.5.0` with package version.
- Add graceful shutdown endpoint or local IPC file so `zilmate daemon stop` can stop the Node server, not only the Windows listener.
- Add in-flight cancellation for `/process`, chat, voice, and background repairs.
- Add response mode controls for Ubiquity: `replace`, `append`, `prepend`, `copy-only`, `summarize`, `rewrite`, `reply`.
- Add prompt presets so selected text can start with lightweight commands like `@zilmate tone: friendly`.
- Add per-session memory controls for Ubiquity and web chat.
- Add telemetry-safe trace events for hotkey capture, daemon request, agent run, paste injection, and failure.

Priority 2: improve security posture.

- Restrict CORS to local web origins instead of `*`, while still supporting the web command center.
- Store token in an app-specific config directory where possible, not only `~/.zilmate-token`.
- Use constant-time token comparison.
- Add token rotation endpoint used by listener restart.
- Add origin/referer diagnostics without logging secrets.
- Add optional allowlist for webhook routes separate from local Ubiquity auth.

Priority 3: improve product capability.

- Add `/api/ubiquity/history` for recent transformations.
- Add `/api/ubiquity/retry` to retry last selected-text action with a different mode.
- Add `/api/clipboard/preview` only when invoked by trusted local listeners.
- Add `/api/listener/status` and `/api/listener/restart`.
- Add SSE or WebSocket events for long-running agent progress so hotkey clients can show progress.

### `src/daemon/win-listener.ps1`

Priority 1: make Windows replacement safer.

- Preserve full clipboard state, not just text, using `System.Windows.Forms.IDataObject`.
- Restore clipboard in a `finally` path even when daemon request, JSON parse, or paste fails.
- Use `System.Text.Json` or escaped JSON serialization instead of manual string replacement.
- Add HTTP timeout and explicit daemon-unavailable notification.
- Add configurable hotkey via script params: modifiers, key, endpoint, timeout.
- Add named mutex to prevent multiple listeners from registering the same hotkey.
- Add listener status heartbeat file containing PID, hotkey, port, token age, last trigger, last error.
- Add tray/toast feedback: processing, success, no selection, daemon offline, auth failed.
- Add copy polling that detects unchanged clipboard vs failed selection more accurately.

Priority 2: broaden interaction modes.

- Add second hotkey for "copy result only" so text is not pasted automatically.
- Add hotkey for "ask about selection" that opens the web command center with selected text prefilled.
- Add active-window metadata in request payload: process name, window title, selection length.
- Add support for preserving line endings and indentation for code edits.
- Add large-selection confirmation threshold.

Priority 3: improve diagnostics.

- Write JSONL logs with event type, duration, status code, and error category.
- Add `-Verbose` and `-LogPath` params.
- Add self-test mode: register hotkey, ping daemon, copy/paste roundtrip test, token read test.

### `src/daemon/mac-installer.ts`

Priority 1: make macOS install safer and more correct.

- Generate JSON payload using a safe encoder, not shell string interpolation.
- Use configured daemon port instead of hard-coded `8124`.
- Use `launchctl bootstrap/gui/$UID` and `bootout` on modern macOS, with fallback for older versions.
- Write logs under `~/Library/Logs/ZilMate/` instead of `/tmp`.
- Add uninstall/reinstall/status functions for LaunchAgent and Quick Action.
- Validate Node path and built `dist/index.js` path before writing plist.
- Avoid forceful plist writes unless content changed; print diff-like status.
- Improve `pbs.plist` shortcut registration with verification after update.

Priority 2: improve macOS user experience.

- Add an optional "copy result only" Quick Action.
- Add "append result" and "replace selection" workflow variants.
- Add first-run permissions checklist for Accessibility, Automation, and Services.
- Add notification feedback for no selection, daemon offline, auth failure, and success.
- Add a small launcher command to open System Settings directly to Keyboard Shortcuts.

Priority 3: improve portability.

- Respect custom `ZILMATE_DAEMON_PORT`.
- Store token path in a generated workflow variable.
- Support packaged global installs where `process.cwd()` is not the project root.
- Add AppleScript/JXA helper files instead of huge inline plist strings.

## Recommended Implementation Order

1. Fix docs drift: update `UBIQUITY.md` from `/run-prompt` to `/process`, update daemon scope, and remove stale version claims.
2. Refactor `service.ts` helpers without changing behavior: shared JSON, auth, route response, body limit.
3. Add `/api/health` and listener heartbeat support.
4. Harden Windows listener clipboard preservation and JSON serialization.
5. Make mac installer port-aware, path-aware, and add uninstall/status.
6. Add configurable hotkeys and Ubiquity action modes.
7. Add progress/event streaming for long agent runs.
8. Add daemon route tests and listener contract tests.

## Definition Of Done

- `npm run build` passes.
- Daemon starts and `GET /api/status` plus new `GET /api/health` work.
- Windows listener can self-test copy, auth, process, paste, and restore.
- macOS installer can install, status-check, and uninstall without manual cleanup.
- Ubiquity docs match implemented endpoints and commands.
- Clipboard is restored on success, empty selection, auth failure, daemon failure, and agent failure.
