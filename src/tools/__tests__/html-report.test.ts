// src/tools/__tests__/html-report.test.ts
// Tests for the HTML report tool - verifies default theme (beige + midnight green), scrollbars, and basic rendering
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('HTML Report Tool', () => {
  const originalCwd = process.cwd();

  it('should generate HTML with beige background and midnight green accent by default', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'zilmate-html-test-'));
    process.chdir(tempDir);

    try {
      const { htmlReportTools } = await import('../html-report.tool.js');
      const result: any = await (htmlReportTools.createHtmlReport as any).execute(
        {
          filename: 'test-report.html',
          title: 'Test Report',
          theme: 'light',
          showReadingTime: true,
          blocks: [
            { type: 'heading', text: 'Section 1', level: 2 },
            { type: 'paragraph', text: 'This is a test paragraph.' },
            { type: 'bullets', items: ['Item 1', 'Item 2'] },
            { type: 'table', headers: ['Name', 'Value'], rows: [['A', '1'], ['B', '2']] },
            { type: 'callout', text: 'Important info', tone: 'info' },
            { type: 'divider' },
            { type: 'stats', items: [{ label: 'Total', value: '42', delta: '+10%' }] },
          ],
        },
      );

      assert.ok(result.path, 'Report generation should succeed');
      const html = await readFile(result.path, 'utf-8');

      assert.ok(html.includes('#F5F0E8'), 'Should use beige background (#F5F0E8)');
      assert.ok(html.includes('#004953'), 'Should use midnight green accent (#004953)');
      assert.ok(html.includes('Georgia'), 'Should use Georgia serif font');
      assert.ok(html.includes('serif'), 'Should use serif font stack');
      assert.ok(html.includes('scrollbar-width: thin'), 'Should have thin scrollbar');
      assert.ok(html.includes('::-webkit-scrollbar'), 'Should have webkit scrollbar styles');
      assert.ok(html.includes('width: 6px'), 'Should have 6px scrollbar width');
      assert.ok(html.includes('color: var(--accent)'), 'Headings should use accent color');
      assert.ok(html.includes('Test Report'), 'Should contain title');
      assert.ok(html.includes('Section 1'), 'Should contain heading');
      assert.ok(html.includes('This is a test paragraph'), 'Should contain paragraph');
      assert.ok(html.includes('Item 1'), 'Should contain bullet items');
      assert.ok(html.includes('Important info'), 'Should contain callout');
      assert.ok(html.includes('42'), 'Should contain stat value');
      assert.ok(html.includes('+10%'), 'Should contain stat delta');
      assert.ok(html.includes('Name'), 'Should contain table header');
      assert.ok(html.includes('og:title'), 'Should have Open Graph title');
      assert.ok(html.includes('twitter:card'), 'Should have Twitter card');
      assert.ok(html.includes('min read'), 'Should show reading time');
      assert.ok(html.includes('openLightbox'), 'Should have lightbox function');
      assert.ok(html.includes('switchTab'), 'Should have tab switching function');
      assert.ok(html.includes('@media print'), 'Should have print styles');
    } finally {
      process.chdir(originalCwd);
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('should generate HTML with dark theme', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'zilmate-html-dark-test-'));
    process.chdir(tempDir);

    try {
      const { htmlReportTools } = await import('../html-report.tool.js');
      const result: any = await (htmlReportTools.createHtmlReport as any).execute(
        {
          filename: 'dark-report.html',
          title: 'Dark Report',
          theme: 'dark',
          blocks: [
            { type: 'heading', text: 'Dark Section', level: 2 },
            { type: 'paragraph', text: 'Dark content' },
          ],
        },
      );

      assert.ok(result.path);
      const html = await readFile(result.path, 'utf-8');
      assert.ok(html.includes('#0f1115'), 'Dark theme should use dark background');
      assert.ok(html.includes('#e5e7eb'), 'Dark theme should use light text');
    } finally {
      process.chdir(originalCwd);
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('should generate HTML with custom accent color', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'zilmate-html-custom-test-'));
    process.chdir(tempDir);

    try {
      const { htmlReportTools } = await import('../html-report.tool.js');
      const result: any = await (htmlReportTools.createHtmlReport as any).execute(
        {
          filename: 'custom-report.html',
          title: 'Custom Report',
          theme: 'light',
          accentColor: '#8B0000',
          blocks: [
            { type: 'heading', text: 'Custom Section', level: 2 },
          ],
        },
      );

      assert.ok(result.path);
      const html = await readFile(result.path, 'utf-8');
      assert.ok(html.includes('#8B0000'), 'Should use custom accent color');
    } finally {
      process.chdir(originalCwd);
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('should generate HTML with custom font', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'zilmate-html-font-test-'));
    process.chdir(tempDir);

    try {
      const { htmlReportTools } = await import('../html-report.tool.js');
      const result: any = await (htmlReportTools.createHtmlReport as any).execute(
        {
          filename: 'font-report.html',
          title: 'Font Report',
          theme: 'light',
          fontFamily: 'Roboto',
          blocks: [
            { type: 'paragraph', text: 'Font test' },
          ],
        },
      );

      assert.ok(result.path);
      const html = await readFile(result.path, 'utf-8');
      assert.ok(html.includes('fonts.googleapis.com'), 'Should import Google Fonts');
      assert.ok(html.includes('Roboto'), 'Should use Roboto font');
    } finally {
      process.chdir(originalCwd);
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});