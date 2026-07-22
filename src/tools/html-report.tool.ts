// src/tools/htmlReport.tool.ts
// No external dependency required.
import { tool } from 'ai';
import { z } from 'zod';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveOutputPath } from './lib/outputPaths.js';
import { emitProgress } from '../runtime/progress.js';

const toneSchema = z.enum(['info', 'warning', 'success', 'danger']).default('info');

const blockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('heading'), text: z.string(), level: z.number().int().min(1).max(3).default(2), anchor: z.string().optional() }),
  z.object({ type: z.literal('paragraph'), text: z.string() }),
  z.object({ type: z.literal('bullets'), items: z.array(z.string()).min(1) }),
  z.object({ type: z.literal('numbered'), items: z.array(z.string()).min(1) }),
  z.object({
    type: z.literal('table'),
    headers: z.array(z.string()).min(1),
    rows: z.array(z.array(z.string())).min(1),
  }),
  z.object({ type: z.literal('callout'), text: z.string(), tone: toneSchema, title: z.string().optional() }),
  z.object({ type: z.literal('quote'), text: z.string(), attribution: z.string().optional() }),
  z.object({ type: z.literal('code'), code: z.string(), language: z.string().optional() }),
  z.object({ type: z.literal('divider') }),
  z.object({
    type: z.literal('image'),
    path: z.string().optional().describe('Local file path; will be base64-inlined'),
    url: z.string().optional().describe('Remote URL; used as-is if path is not provided'),
    alt: z.string().default(''),
    caption: z.string().optional(),
    maxWidth: z.number().int().optional().describe('Max width in px'),
  }),
  z.object({
    type: z.literal('stats'),
    items: z.array(z.object({ label: z.string(), value: z.string(), delta: z.string().optional(), tone: toneSchema.optional() })).min(1),
  }),
  z.object({
    type: z.literal('columns'),
    columns: z.array(z.object({ heading: z.string().optional(), text: z.string() })).min(2).max(3),
  }),
  z.object({ type: z.literal('tableOfContents') }),
]);

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

const TONE_COLORS: Record<string, string> = {
  info: '#2563eb',
  warning: '#d97706',
  success: '#16a34a',
  danger: '#dc2626',
};
const TONE_BG: Record<string, string> = {
  info: '#eff6ff',
  warning: '#fffbeb',
  success: '#f0fdf4',
  danger: '#fef2f2',
};

async function renderBlock(block: z.infer<typeof blockSchema>): Promise<string> {
  switch (block.type) {
    case 'heading': {
      const id = block.anchor ? slugify(block.anchor) : slugify(block.text);
      return `<h${block.level} id="${id}">${escapeHtml(block.text)}</h${block.level}>`;
    }
    case 'paragraph':
      return `<p>${escapeHtml(block.text)}</p>`;
    case 'bullets':
      return `<ul>${block.items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`;
    case 'numbered':
      return `<ol>${block.items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ol>`;
    case 'table':
      return `<table><thead><tr>${block.headers
        .map((h) => `<th>${escapeHtml(h)}</th>`)
        .join('')}</tr></thead><tbody>${block.rows
        .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`)
        .join('')}</tbody></table>`;
    case 'callout':
      return `<div class="callout callout-${block.tone}">${
        block.title ? `<strong>${escapeHtml(block.title)}</strong>` : ''
      }<p>${escapeHtml(block.text)}</p></div>`;
    case 'quote':
      return `<blockquote><p>${escapeHtml(block.text)}</p>${
        block.attribution ? `<cite>${escapeHtml(block.attribution)}</cite>` : ''
      }</blockquote>`;
    case 'code':
      return `<pre><code class="lang-${escapeHtml(block.language ?? 'text')}">${escapeHtml(block.code)}</code></pre>`;
    case 'divider':
      return `<hr />`;
    case 'image': {
      let src = block.url ?? '';
      if (block.path) {
        const data = await readFile(block.path);
        const ext = path.extname(block.path).replace('.', '') || 'png';
        const mime = ext === 'jpg' ? 'jpeg' : ext;
        src = `data:image/${mime};base64,${data.toString('base64')}`;
      }
      const widthAttr = block.maxWidth ? ` style="max-width:${block.maxWidth}px"` : '';
      return `<figure><img src="${src}" alt="${escapeHtml(block.alt)}"${widthAttr} />${
        block.caption ? `<figcaption>${escapeHtml(block.caption)}</figcaption>` : ''
      }</figure>`;
    }
    case 'stats':
      return `<div class="stats-grid">${block.items
        .map(
          (s) => `<div class="stat-card">
            <div class="stat-label">${escapeHtml(s.label)}</div>
            <div class="stat-value">${escapeHtml(s.value)}</div>
            ${s.delta ? `<div class="stat-delta" style="color:${TONE_COLORS[s.tone ?? 'info']}">${escapeHtml(s.delta)}</div>` : ''}
          </div>`,
        )
        .join('')}</div>`;
    case 'columns':
      return `<div class="columns columns-${block.columns.length}">${block.columns
        .map(
          (col) => `<div class="column">${col.heading ? `<h4>${escapeHtml(col.heading)}</h4>` : ''}<p>${escapeHtml(col.text)}</p></div>`,
        )
        .join('')}</div>`;
    case 'tableOfContents':
      return `<!--TOC_PLACEHOLDER-->`;
  }
}

function buildToc(headings: { text: string; level: number; id: string }[]): string {
  if (headings.length === 0) return '';
  const items = headings
    .map((h) => `<li class="toc-level-${h.level}"><a href="#${h.id}">${escapeHtml(h.text)}</a></li>`)
    .join('');
  return `<nav class="toc"><strong>Contents</strong><ul>${items}</ul></nav>`;
}

export const htmlReportTools = {
  createHtmlReport: tool({
    description:
      'Generate a styled standalone HTML report with headings, paragraphs, bullet/numbered lists, tables, callouts (info/warning/success/danger), block quotes, code blocks, dividers, inlined local or remote images with captions, stat/metric card grids, multi-column layouts, and an optional auto-generated table of contents with anchor links. Supports a custom accent color and light/dark theme. Use for dashboards, summaries, or shareable reports not needing Word/PDF.',
    inputSchema: z.object({
      filename: z.string().min(1).describe('Base filename, e.g. "weekly-summary.html"'),
      title: z.string(),
      subtitle: z.string().optional(),
      accentColor: z.string().optional().describe('Hex color, e.g. "#1d4ed8"; defaults to brand blue'),
      theme: z.enum(['light', 'dark']).default('light'),
      footerNote: z.string().optional().describe('Small text shown at the bottom, e.g. generation date/source'),
      blocks: z.array(blockSchema).min(1),
    }),
    execute: async ({ filename, title, subtitle, accentColor, theme, footerNote, blocks }) => {
      emitProgress({ type: 'step', label: 'Generating HTML report', detail: filename });

      const accent = accentColor ?? '#1d4ed8';
      const headings = blocks
        .filter((b): b is Extract<z.infer<typeof blockSchema>, { type: 'heading' }> => b.type === 'heading')
        .map((h) => ({ text: h.text, level: h.level, id: h.anchor ? slugify(h.anchor) : slugify(h.text) }));

      const renderedBlocks = await Promise.all(blocks.map(renderBlock));
      const toc = buildToc(headings);
      const body = renderedBlocks.join('\n').replace('<!--TOC_PLACEHOLDER-->', toc);

      const isDark = theme === 'dark';
      const bg = isDark ? '#0f1115' : '#ffffff';
      const ink = isDark ? '#e5e7eb' : '#1a1a1a';
      const muted = isDark ? '#9ca3af' : '#666666';
      const border = isDark ? '#262a33' : '#eeeeee';
      const cardBg = isDark ? '#171a21' : '#f8f9fc';

      const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
  :root { --accent: ${accent}; --ink: ${ink}; --muted: ${muted}; --border: ${border}; --card-bg: ${cardBg}; --bg: ${bg}; }
  body { font-family: -apple-system, "Inter", "Segoe UI", sans-serif; max-width: 900px; margin: 40px auto; padding: 0 24px; color: var(--ink); background: var(--bg); line-height: 1.6; }
  h1 { font-size: 28px; margin-bottom: 4px; }
  h2 { font-size: 20px; margin-top: 36px; border-bottom: 2px solid var(--border); padding-bottom: 6px; }
  h3 { font-size: 17px; color: var(--accent); margin-top: 24px; }
  .subtitle { color: var(--muted); margin-top: 0; }
  table { width: 100%; border-collapse: collapse; margin: 16px 0; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border); font-size: 14px; }
  th { background: var(--card-bg); font-weight: 600; }
  .callout { border-left: 4px solid var(--accent); background: var(--card-bg); padding: 10px 16px; margin: 16px 0; border-radius: 4px; }
  .callout p { margin: 4px 0 0; }
  .callout-warning { border-left-color: #d97706; }
  .callout-success { border-left-color: #16a34a; }
  .callout-danger { border-left-color: #dc2626; }
  blockquote { border-left: 3px solid var(--border); margin: 16px 0; padding: 4px 16px; color: var(--muted); font-style: italic; }
  blockquote cite { display: block; margin-top: 8px; font-style: normal; font-size: 13px; }
  pre { background: ${isDark ? '#1a1d24' : '#0f1115'}; color: #e5e7eb; padding: 14px 16px; border-radius: 6px; overflow-x: auto; font-size: 13px; }
  hr { border: none; border-top: 1px solid var(--border); margin: 28px 0; }
  figure { margin: 20px 0; text-align: center; }
  figure img { max-width: 100%; border-radius: 6px; }
  figcaption { color: var(--muted); font-size: 13px; margin-top: 6px; }
  .stats-grid { display: flex; flex-wrap: wrap; gap: 12px; margin: 16px 0; }
  .stat-card { flex: 1; min-width: 140px; background: var(--card-bg); border-radius: 8px; padding: 14px 16px; }
  .stat-label { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.03em; }
  .stat-value { font-size: 24px; font-weight: 700; margin-top: 4px; }
  .stat-delta { font-size: 13px; font-weight: 600; margin-top: 2px; }
  .columns { display: flex; gap: 20px; margin: 16px 0; }
  .column { flex: 1; }
  .toc { background: var(--card-bg); border-radius: 8px; padding: 16px 20px; margin: 20px 0; }
  .toc ul { list-style: none; padding-left: 0; margin: 8px 0 0; }
  .toc a { color: var(--accent); text-decoration: none; font-size: 14px; }
  .toc a:hover { text-decoration: underline; }
  .toc-level-2 { margin-left: 0; }
  .toc-level-3 { margin-left: 16px; }
  .footer-note { color: var(--muted); font-size: 12px; margin-top: 48px; border-top: 1px solid var(--border); padding-top: 12px; }
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
${subtitle ? `<p class="subtitle">${escapeHtml(subtitle)}</p>` : ''}
${body}
${footerNote ? `<div class="footer-note">${escapeHtml(footerNote)}</div>` : ''}
</body>
</html>`;

      const { absPath, relPath } = await resolveOutputPath(filename);
      await writeFile(absPath, html, 'utf-8');

      return { path: absPath, relativePath: relPath, bytes: Buffer.byteLength(html) };
    },
  }),
};