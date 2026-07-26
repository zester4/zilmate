import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNpmInstallArgs, shouldRetryWithoutScripts } from '../cli/update.js';

test('buildNpmInstallArgs adds safer npm flags for global installs', () => {
  assert.deepEqual(buildNpmInstallArgs('zilmate@latest', { platform: 'win32' as NodeJS.Platform }), ['install', '-g', 'zilmate@latest', '--no-audit', '--no-fund', '--force']);
  assert.deepEqual(buildNpmInstallArgs('zilmate@latest', { platform: 'linux' as NodeJS.Platform }), ['install', '-g', 'zilmate@latest', '--no-audit', '--no-fund']);
});

test('shouldRetryWithoutScripts triggers for common Windows install blockers', () => {
  assert.equal(shouldRetryWithoutScripts('EPERM: operation not permitted'), true);
  assert.equal(shouldRetryWithoutScripts('Access is denied'), true);
  assert.equal(shouldRetryWithoutScripts('playwright postinstall failed'), true);
  assert.equal(shouldRetryWithoutScripts('package.json missing'), false);
});
