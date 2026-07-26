import { tool } from 'ai';
import { z } from 'zod';
import { spawn } from 'node:child_process';
import { emitProgress } from '../runtime/progress.js';

interface SessionHandle {
  id: string;
  command: string;
  cwd: string;
  process: ReturnType<typeof spawn>;
  output: string[];
  status: 'running' | 'finished' | 'stopped';
  startedAt: string;
  lastActivityAt: string;
  exitCode: number | null;
}

const sessions = new Map<string, SessionHandle>();

function createSessionId() {
  return `term-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function serializeSession(handle: SessionHandle) {
  return {
    sessionId: handle.id,
    command: handle.command,
    cwd: handle.cwd,
    status: handle.status,
    startedAt: handle.startedAt,
    lastActivityAt: handle.lastActivityAt,
    exitCode: handle.exitCode,
    outputTail: handle.output.slice(-20),
  };
}

export const terminalWorkbenchTools = {
  startTerminalSession: tool({
    description: 'Start an interactive terminal session for long-running commands, streaming output and allowing follow-up input.',
    inputSchema: z.object({
      command: z.string().min(1),
      cwd: z.string().optional(),
      shell: z.enum(['bash', 'sh', 'powershell']).optional(),
    }),
    execute: async ({ command, cwd, shell }) => {
      emitProgress({ type: 'tool:start', label: 'Starting terminal session', detail: command });
      const id = createSessionId();
      const proc = spawn(command, {
        cwd: cwd ?? process.cwd(),
        shell: shell === 'powershell' ? 'powershell.exe' : shell === 'bash' ? 'bash' : '/bin/sh',
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const now = new Date().toISOString();
      const handle: SessionHandle = {
        id,
        command,
        cwd: cwd ?? process.cwd(),
        process: proc,
        output: [],
        status: 'running',
        startedAt: now,
        lastActivityAt: now,
        exitCode: null,
      };

      proc.stdout.on('data', (chunk) => {
        const text = chunk.toString();
        handle.output.push(text);
        handle.lastActivityAt = new Date().toISOString();
      });
      proc.stderr.on('data', (chunk) => {
        const text = chunk.toString();
        handle.output.push(text);
        handle.lastActivityAt = new Date().toISOString();
      });

      proc.on('exit', (code) => {
        handle.status = code === 0 ? 'finished' : 'stopped';
        handle.exitCode = code;
      });

      sessions.set(id, handle);
      emitProgress({ type: 'tool:end', label: 'Terminal session ready', detail: id });
      return { sessionId: id, status: 'running', command, cwd: cwd ?? process.cwd() };
    },
  }),

  sendTerminalInput: tool({
    description: 'Send input to an active terminal session.',
    inputSchema: z.object({
      sessionId: z.string(),
      input: z.string(),
    }),
    execute: async ({ sessionId, input }) => {
      const handle = sessions.get(sessionId);
      if (!handle) {
        throw new Error(`Session ${sessionId} not found.`);
      }
      handle.process.stdin?.write(`${input}\n`);
      handle.lastActivityAt = new Date().toISOString();
      emitProgress({ type: 'tool:end', label: 'Sent terminal input', detail: sessionId });
      return { sessionId, sent: true, output: handle.output.slice(-20), status: handle.status };
    },
  }),

  inspectTerminalSession: tool({
    description: 'Inspect an existing terminal session for status, recent output, and runtime metadata.',
    inputSchema: z.object({ sessionId: z.string() }),
    execute: async ({ sessionId }) => {
      const handle = sessions.get(sessionId);
      if (!handle) {
        throw new Error(`Session ${sessionId} not found.`);
      }
      emitProgress({ type: 'tool:end', label: 'Inspected terminal session', detail: sessionId });
      return serializeSession(handle);
    },
  }),

  snapshotTerminalSession: tool({
    description: 'Capture a structured snapshot of a terminal session for resumable workflows and debugging.',
    inputSchema: z.object({ sessionId: z.string() }),
    execute: async ({ sessionId }) => {
      const handle = sessions.get(sessionId);
      if (!handle) {
        throw new Error(`Session ${sessionId} not found.`);
      }
      emitProgress({ type: 'tool:end', label: 'Captured terminal snapshot', detail: sessionId });
      return {
        sessionId,
        summary: {
          command: handle.command,
          cwd: handle.cwd,
          status: handle.status,
          startedAt: handle.startedAt,
          lastActivityAt: handle.lastActivityAt,
          exitCode: handle.exitCode,
        },
        output: handle.output.slice(-100),
      };
    },
  }),

  listTerminalSessions: tool({
    description: 'List all active terminal sessions managed by the workbench.',
    inputSchema: z.object({}),
    execute: async () => {
      const sessionsList = Array.from(sessions.values()).map(serializeSession);
      emitProgress({ type: 'tool:end', label: 'Listed terminal sessions' });
      return { count: sessionsList.length, sessions: sessionsList };
    },
  }),

  stopTerminalSession: tool({
    description: 'Stop a running terminal session.',
    inputSchema: z.object({ sessionId: z.string() }),
    execute: async ({ sessionId }) => {
      const handle = sessions.get(sessionId);
      if (!handle) {
        throw new Error(`Session ${sessionId} not found.`);
      }
      handle.process.kill();
      handle.status = 'stopped';
      handle.exitCode = handle.exitCode ?? 1;
      sessions.delete(sessionId);
      emitProgress({ type: 'tool:end', label: 'Stopped terminal session', detail: sessionId });
      return { sessionId, status: 'stopped', exitCode: handle.exitCode };
    },
  }),
};
