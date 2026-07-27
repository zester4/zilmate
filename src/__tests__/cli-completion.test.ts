import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeEnhancedKeyboardInput, getSlashCommandSuggestions, isCtrlCInput, isPrintableInput, selectSlashCommandSuggestion } from '../cli/composer.js';

test('slash autocomplete returns relevant commands for a prefix', () => {
  assert.deepEqual(getSlashCommandSuggestions('/m'), [
    '/mcp',
    '/mcp list',
    '/mcp add',
    '/mcp remove',
    '/mcp restart',
    '/model',
    '/model pick',
    '/model next',
  ]);
});

test('slash autocomplete ignores non-slash input', () => {
  assert.deepEqual(getSlashCommandSuggestions('hello'), []);
});

test('slash autocomplete only returns matching prefix suggestions', () => {
  assert.deepEqual(getSlashCommandSuggestions('/zzzz'), []);
  assert.deepEqual(getSlashCommandSuggestions('/mod'), ['/model', '/model pick', '/model next']);
  assert.deepEqual(getSlashCommandSuggestions('/modj'), ['/model', '/model pick', '/model next']);
});

test('slash suggestion selection resolves the highlighted command', () => {
  assert.equal(selectSlashCommandSuggestion('/m', 0), '/mcp');
  assert.equal(selectSlashCommandSuggestion('/m', 7), '/model next');
  assert.equal(selectSlashCommandSuggestion('hello'), null);
});

test('enhanced keyboard printable input keeps slash commands intact', () => {
  assert.equal(decodeEnhancedKeyboardInput('\x1b[47u'), '/');
  assert.equal(decodeEnhancedKeyboardInput('\x1b[47u\x1b[109u\x1b[111u'), '/mo');
});

test('normal printable input includes slash characters', () => {
  assert.equal(isPrintableInput('/'), true);
  assert.equal(isPrintableInput('/mo'), true);
  assert.equal(isPrintableInput('\r'), false);
});

test('enhanced ctrl-c is handled as interrupt, not text', () => {
  assert.equal(decodeEnhancedKeyboardInput('\x1b[99;5u'), '');
  assert.equal(isCtrlCInput('\x1b[99;5u'), true);
  assert.equal(isCtrlCInput('\u0003'), true);
});
