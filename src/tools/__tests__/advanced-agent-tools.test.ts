import test from 'node:test';
import assert from 'node:assert/strict';
import { terminalWorkbenchTools } from '../terminal-workbench.tool.js';
import { browserWorkflowTools } from '../browser-workflow.tool.js';
import { sandboxDevTools } from '../sandbox-dev.tool.js';

test('terminal workbench exposes session lifecycle and inspection tools', () => {
  assert.ok(terminalWorkbenchTools.startTerminalSession);
  assert.ok(terminalWorkbenchTools.sendTerminalInput);
  assert.ok(terminalWorkbenchTools.stopTerminalSession);
  assert.ok(terminalWorkbenchTools.inspectTerminalSession);
  assert.ok(terminalWorkbenchTools.snapshotTerminalSession);
  assert.ok(terminalWorkbenchTools.listTerminalSessions);
});

test('browser workflow exposes rich workflow execution tools', () => {
  assert.ok(browserWorkflowTools.runBrowserWorkflow);
  assert.ok(browserWorkflowTools.inspectBrowserWorkflow);
});

test('sandbox verification loop exposes compile and test orchestration', () => {
  assert.ok(sandboxDevTools.executeSandboxDevLoop);
});
