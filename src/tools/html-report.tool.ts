// src/tools/html-report.tool.ts
import { tool } from 'ai';
import { z } from 'zod';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveOutputPath, atomicWriteFile, safeExecute } from './lib/outputPaths.js';
import { emitProgress } from '../runtime/progress.js';
import { resolveImage, imageToBase64, escapeHtml, slugify } from './lib/image-utils.js';

const toneSchema = z.enum(['info', 'warning', 'success', 'danger']).default('info');

const imageInputSchema = z.object({
  path: z.string().optional().describe('Local image file path; will be base64-inlined'),
  url: z.string().optional().describe('Remote URL; used as-is if path is not provided'),
  generate: z.string().optional().describe('AI image generation prompt'),
  provider: z.enum(['openai', 'chatgpt', 'gemini', 'google', 'default']).optional(),
  size: z.string().regex(/^\d+x\d+$/).optional().describe('Image size for generation, e.g. "1024x1024"'),
});

const blockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('heading'), text: z.string(), level: z.number().int().min(1).max(3).default(2), anchor: z.string().optional() }),
  z.object({ type: z.literal('paragraph'), text: z.string(), lead: z.boolean().optional().describe('Render as larger lead/lede paragraph') }),
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
    ...imageInputSchema.shape,
    alt: z.string().default(''),
    caption: z.string().optional(),
    maxWidth: z.number().int().optional().describe('Max width in px'),
    lazy: z.boolean().optional().describe('Lazy load the image'),
    lightbox: z.boolean().optional().describe('Click to enlarge image'),
    borderRadius: z.number().int().optional().describe('Border radius in px'),
    shadow: z.boolean().optional().describe('Apply drop shadow'),
  }),
  z.object({
    type: z.literal('chart'),
    chartType: z.enum(['bar', 'line', 'pie', 'doughnut']),
    title: z.string().max(200).optional(),
    labels: z.array(z.string().min(1)).min(1).max(100),
    datasets: z
      .array(
        z.object({
          label: z.string().min(1).max(100),
          data: z.array(z.number().finite()).min(1),
          color: z.string().optional().describe('Hex color with #, e.g. "#1d4ed8"'),
        }),
      )
      .min(1)
      .max(12),
    width: z.number().int().min(200).max(3000).default(800),
    height: z.number().int().min(200).max(3000).default(450),
    interactive: z.boolean().optional().describe('Render as interactive Chart.js instead of static PNG'),
    caption: z.string().optional(),
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
  z.object({
    type: z.literal('tabs'),
    tabs: z.array(z.object({ title: z.string(), blocks: z.array(z.any()).min(1) })).min(2).max(6),
  }),
  z.object({
    type: z.literal('accordion'),
    items: z.array(z.object({ title: z.string(), blocks: z.array(z.any()).min(1) })).min(1).max(10),
  }),
  z.object({
    type: z.literal('progressBar'),
    value: z.number().min(0).max(100),
    max: z.number().min(1).default(100),
    label: z.string().optional(),
    color: z.string().optional().describe('Hex color with #'),
  }),
  z.object({
    type: z.literal('badge'),
    text: z.string().min(1),
    color: z.string().optional().describe('Hex color with #'),
    size: z.enum(['sm', 'md', 'lg']).optional(),
  }),
  z.object({
    type: z.literal('gallery'),
    images: z
      .array(
        z.object({
          ...imageInputSchema.shape,
          caption: z.string().optional(),
        }),
      )
      .min(1)
      .max(12),
    columns: z.number().int().min(1).max(4).default(3),
  }),
  z.object({
    type: z.literal('timeline'),
    items: z.array(z.object({ date: z.string(), title: z.string(), text: z.string().optional() })).min(1).max(20),
  }),
  z.object({
    type: z.literal('faq'),
    items: z.array(z.object({ question: z.string(), answer: z.string() })).min(1).max(20),
  }),
  z.object({
    type: z.literal('collapsible'),
    title: z.string(),
    blocks: z.array(z.any()).min(1),
    defaultOpen: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('tooltip'),
    text: z.string(),
    tooltip: z.string(),
  }),
  z.object({
    type: z.literal('mermaid'),
    diagram: z.string().min(1).describe('Mermaid diagram definition string, e.g. "graph TD; A-->B;"'),
    caption: z.string().optional(),
  }),
  z.object({
    type: z.literal('smartArt'),
    prompt: z.string().min(1).describe('AI prompt to generate a diagram image'),
    width: z.number().int().default(600),
    height: z.number().int().default(400),
    caption: z.string().optional(),
  }),
]);

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

async function renderBlock(block: any): Promise<string> {
  switch (block.type) {
    case 'heading': {
      const id = block.anchor ? slugify(block.anchor) : slugify(block.text);
      return `<h${block.level} id="${id}">${escapeHtml(block.text)}</h${block.level}>`;
    }
    case 'paragraph': {
      const cls = block.lead ? ' class="lead"' : '';
      return `<p${cls}>${escapeHtml(block.text)}</p>`;
    }
    case 'bullets':
      return `<ul>${block.items.map((i: string) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`;
    case 'numbered':
      return `<ol>${block.items.map((i: string) => `<li>${escapeHtml(i)}</li>`).join('')}</ol>`;
    case 'table':
      return `<table><thead><tr>${block.headers
        .map((h: string) => `<th>${escapeHtml(h)}</th>`)
        .join('')}</tr></thead><tbody>${block.rows
        .map((row: string[]) => `<tr>${row.map((cell: string) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`)
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
      const imgStyles: string[] = [];
      if (block.borderRadius) imgStyles.push(`border-radius:${block.borderRadius}px`);
      if (block.shadow) imgStyles.push('box-shadow:0 4px 12px rgba(0,0,0,0.15)');
      if (block.maxWidth) imgStyles.push(`max-width:${block.maxWidth}px`);
      const styleAttr = imgStyles.length ? ` style="${imgStyles.join(';')}"` : '';
      const loadingAttr = block.lazy ? ' loading="lazy"' : '';
      const lightboxAttr = block.lightbox ? ` onclick="openLightbox(this.src)" class="lightboxable"` : '';

      if (block.path || block.generate) {
        const resolved = await resolveImage(
          { path: block.path, generate: block.generate, provider: block.provider, size: block.size },
          'html image',
        );
        src = imageToBase64(resolved.buffer, resolved.mimeType);
      } else if (!block.url) {
        // No source at all - skip
        return '';
      }

      const img = `<img src="${src}" alt="${escapeHtml(block.alt)}"${loadingAttr}${lightboxAttr}${styleAttr} />`;
      return block.caption
        ? `<figure>${img}<figcaption>${escapeHtml(block.caption)}</figcaption></figure>`
        : `<figure>${img}</figure>`;
    }
    case 'chart': {
      if (block.interactive) {
        return renderInteractiveChart(block);
      }
      // Static chart rendered as image via chartjs-node-canvas
      const { ChartJSNodeCanvas } = await import('chartjs-node-canvas');
      const canvasRenderer = new ChartJSNodeCanvas({ width: block.width, height: block.height, backgroundColour: 'white' });
      const palette = [
        '#1d4ed8', '#dc2626', '#16a34a', '#d97706', '#7c3aed', '#0891b2',
        '#db2777', '#65a30d', '#ea580c', '#0d9488', '#9333ea', '#ca8a04',
      ];
      const buffer = await canvasRenderer.renderToBuffer({
        type: block.chartType,
        data: {
          labels: block.labels,
          datasets: block.datasets.map((d: any, i: number) => ({
            label: d.label,
            data: d.data,
            backgroundColor: d.color ?? palette[i % palette.length],
            borderColor: d.color ?? palette[i % palette.length],
          })),
        },
        options: {
          plugins: {
            title: block.title ? { display: true, text: block.title } : { display: false },
            legend: { display: block.datasets.length > 1 },
          },
        },
      });
      const b64 = buffer.toString('base64');
      const imgSrc = `data:image/png;base64,${b64}`;
      let html = `<figure><img src="${imgSrc}" alt="${escapeHtml(block.title ?? 'Chart')}" style="max-width:100%" />`;
      if (block.caption) html += `<figcaption>${escapeHtml(block.caption)}</figcaption>`;
      html += '</figure>';
      return html;
    }
    case 'stats':
      return `<div class="stats-grid">${block.items
        .map(
          (s: any) => `<div class="stat-card">
            <div class="stat-label">${escapeHtml(s.label)}</div>
            <div class="stat-value">${escapeHtml(s.value)}</div>
            ${s.delta ? `<div class="stat-delta" style="color:${TONE_COLORS[s.tone ?? 'info']}">${escapeHtml(s.delta)}</div>` : ''}
          </div>`,
        )
        .join('')}</div>`;
    case 'columns':
      return `<div class="columns columns-${block.columns.length}">${block.columns
        .map(
          (col: any) => `<div class="column">${col.heading ? `<h4>${escapeHtml(col.heading)}</h4>` : ''}<p>${escapeHtml(col.text)}</p></div>`,
        )
        .join('')}</div>`;
    case 'tableOfContents':
      return `<!--TOC_PLACEHOLDER-->`;
    case 'tabs': {
      const tabId = `tabs-${Date.now()}`;
      let html = `<div class="tabs" id="${tabId}"><div class="tab-nav">`;
      block.tabs.forEach((tab: any, i: number) => {
        html += `<button class="tab-btn${i === 0 ? ' active' : ''}" data-tab="${i}" onclick="switchTab('${tabId}', ${i})">${escapeHtml(tab.title)}</button>`;
      });
      html += '</div>';
      for (const [i, tab] of block.tabs.entries()) {
        html += `<div class="tab-panel" data-panel="${i}" style="display:${i === 0 ? 'block' : 'none'}">`;
        for (const subBlock of tab.blocks) {
          html += await renderBlock(subBlock);
        }
        html += '</div>';
      }
      html += '</div>';
      return html;
    }
    case 'accordion': {
      let html = '<div class="accordion">';
      for (const [i, item] of block.items.entries()) {
        html += `<details class="accordion-item"${i === 0 ? ' open' : ''}><summary>${escapeHtml(item.title)}</summary><div class="accordion-content">`;
        for (const subBlock of item.blocks) {
          html += await renderBlock(subBlock);
        }
        html += '</div></details>';
      }
      html += '</div>';
      return html;
    }
    case 'progressBar': {
      const pct = Math.round((block.value / block.max) * 100);
      const color = block.color ?? '#1d4ed8';
      return `<div class="progress-bar-container">${block.label ? `<span class="progress-label">${escapeHtml(block.label)}</span>` : ''}<div class="progress-bar"><div class="progress-fill" style="width:${pct}%;background-color:${color}">${pct}%</div></div></div>`;
    }
    case 'badge': {
      const color = block.color ?? '#1d4ed8';
      const sizes: Record<string, string> = { sm: '10px', md: '12px', lg: '14px' };
      const fontSize = sizes[block.size ?? 'md'] ?? '12px';
      return `<span class="badge" style="background-color:${color}20;color:${color};border:1px solid ${color}40;font-size:${fontSize}">${escapeHtml(block.text)}</span>`;
    }
    case 'gallery': {
      let html = `<div class="gallery gallery-cols-${block.columns}">`;
      for (const img of block.images) {
        let src = img.url ?? '';
        if (img.path || img.generate) {
          const resolved = await resolveImage(
            { path: img.path, generate: img.generate, provider: img.provider, size: img.size },
            'gallery image',
          );
          src = imageToBase64(resolved.buffer, resolved.mimeType);
        }
        html += `<div class="gallery-item"><img src="${src}" alt="${escapeHtml(img.caption ?? '')}" loading="lazy" />`;
        if (img.caption) html += `<span class="gallery-caption">${escapeHtml(img.caption)}</span>`;
        html += '</div>';
      }
      html += '</div>';
      return html;
    }
    case 'timeline': {
      let html = '<div class="timeline">';
      for (const item of block.items) {
        html += `<div class="timeline-item"><div class="timeline-date">${escapeHtml(item.date)}</div><div class="timeline-content"><h4>${escapeHtml(item.title)}</h4>${item.text ? `<p>${escapeHtml(item.text)}</p>` : ''}</div></div>`;
      }
      html += '</div>';
      return html;
    }
    case 'faq': {
      let html = '<div class="faq">';
      for (const [i, item] of block.items.entries()) {
        html += `<details class="faq-item"${i === 0 ? ' open' : ''}><summary>${escapeHtml(item.question)}</summary><p>${escapeHtml(item.answer)}</p></details>`;
      }
      html += '</div>';
      return html;
    }
    case 'collapsible': {
      const openAttr = block.defaultOpen ? ' open' : '';
      let html = `<details class="collapsible"${openAttr}><summary>${escapeHtml(block.title)}</summary><div class="collapsible-content">`;
      for (const subBlock of block.blocks) {
        html += await renderBlock(subBlock);
      }
      html += '</div></details>';
      return html;
    }
    case 'tooltip':
      return `<span class="tooltip-trigger">${escapeHtml(block.text)}<span class="tooltip-text">${escapeHtml(block.tooltip)}</span></span>`;
    case 'mermaid':
      return `<div class="mermaid">${escapeHtml(block.diagram)}</div>${block.caption ? `<p class="mermaid-caption">${escapeHtml(block.caption)}</p>` : ''}`;
    case 'smartArt': {
      const resolved = await resolveImage({ generate: block.prompt, provider: 'default' }, 'smartArt');
      const src = imageToBase64(resolved.buffer, resolved.mimeType);
      const widthAttr = block.width ? ` style="max-width:${block.width}px"` : '';
      let html = `<figure><img src="${src}" alt="SmartArt diagram"${widthAttr} />`;
      if (block.caption) html += `<figcaption>${escapeHtml(block.caption)}</figcaption>`;
      html += '</figure>';
      return html;
    }
    default:
      return '';
  }
}

function renderInteractiveChart(block: any): string {
  const chartId = `chart-${Date.now()}`;
  const palette = [
    '#1d4ed8', '#dc2626', '#16a34a', '#d97706', '#7c3aed', '#0891b2',
    '#db2777', '#65a30d', '#ea580c', '#0d9488', '#9333ea', '#ca8a04',
  ];

  const datasetsJson = JSON.stringify(
    block.datasets.map((d: any, i: number) => ({
      label: d.label,
      data: d.data,
      backgroundColor: d.color ?? palette[i % palette.length],
      borderColor: d.color ?? palette[i % palette.length],
      borderWidth: 1,
    })),
  );
  const labelsJson = JSON.stringify(block.labels);
  const type = block.chartType === 'doughnut' ? 'doughnut' : block.chartType;
  const titleText = block.title ? block.title : '';

  return `<div class="chart-container"><canvas id="${chartId}" width="${block.width}" height="${block.height}"></canvas></div>
<script>
(function() {
  var ctx = document.getElementById('${chartId}');
  if (!ctx) return;
  new Chart(ctx, {
    type: '${type}',
    data: { labels: ${labelsJson}, datasets: ${datasetsJson} },
    options: {
      responsive: true,
      plugins: {
        title: ${titleText ? `{ display: true, text: '${escapeHtml(titleText)}' }` : '{ display: false }'},
        legend: { display: ${block.datasets.length > 1} }
      }
    }
  });
})();
</script>`;
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
      'Generate a styled standalone HTML report with headings, paragraphs (including lead), bullet/numbered lists, tables, callouts (info/warning/success/danger), block quotes, code blocks, dividers, images (local/remote/AI-generated, with lazy loading, lightbox, border radius, shadow), charts (static PNG or interactive Chart.js), stat/metric card grids, multi-column layouts, tabs, accordion, progress bars, badges, image galleries, timelines, FAQ sections, collapsible sections, tooltips, Mermaid diagrams, SmartArt (AI-generated), and an auto-generated table of contents with anchor links and scrollspy. Supports custom accent color, light/dark theme, Google Fonts, print styles, and social meta tags. Use for dashboards, summaries, or shareable reports not needing Word/PDF.',
    inputSchema: z.object({
      filename: z.string().min(1).describe('Base filename, e.g. "weekly-summary.html"'),
      title: z.string(),
      subtitle: z.string().optional(),
      accentColor: z.string().optional().describe('Hex color, e.g. "#1d4ed8"; defaults to brand blue'),
      theme: z.enum(['light', 'dark']).default('light'),
      footerNote: z.string().optional().describe('Small text shown at the bottom, e.g. generation date/source'),
      fontFamily: z.string().optional().describe('Google Font name, e.g. "Inter" or "Roboto"'),
      showReadingTime: z.boolean().optional().describe('Show estimated reading time'),
      blocks: z.array(blockSchema).min(1),
    }),
    execute: async ({ filename, title, subtitle, accentColor, theme, footerNote, fontFamily, showReadingTime, blocks }) => {
      emitProgress({ type: 'step', label: 'Generating HTML report', detail: filename });

      const accent = accentColor ?? '#1d4ed8';
      const headings = blocks
        .filter((b): b is { type: 'heading'; text: string; level: number; anchor?: string } => b.type === 'heading')
        .map((h) => ({ text: h.text, level: h.level, id: h.anchor ? slugify(h.anchor) : slugify(h.text) }));

      const renderedBlocks = await Promise.all(blocks.map(renderBlock));
      const toc = buildToc(headings);
      const body = renderedBlocks.join('\n').replace('<!--TOC_PLACEHOLDER-->', toc);

      // Calculate reading time
      const wordCount = body.replace(/<[^>]*>/g, '').split(/\s+/).filter(Boolean).length;
      const readingTime = Math.max(1, Math.round(wordCount / 200));

      const isDark = theme === 'dark';
      const bg = isDark ? '#0f1115' : '#ffffff';
      const ink = isDark ? '#e5e7eb' : '#1a1a1a';
      const muted = isDark ? '#9ca3af' : '#666666';
      const border = isDark ? '#262a33' : '#eeeeee';
      const cardBg = isDark ? '#171a21' : '#f8f9fc';
      const preBg = isDark ? '#1a1d24' : '#0f1115';
      const preFg = '#e5e7eb';

      const fontImport = fontFamily
        ? `<link href="https://fonts.googleapis.com/css2?family=${fontFamily.replace(/ /g, '+')}:wght@400;600;700&display=swap" rel="stylesheet" />`
        : '';
      const fontStack = fontFamily
        ? `"${fontFamily}", -apple-system, "Segoe UI", sans-serif`
        : '-apple-system, "Inter", "Segoe UI", sans-serif';

      const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta property="og:title" content="${escapeHtml(title)}" />
<meta property="og:type" content="report" />
<meta name="twitter:card" content="summary_large_image" />
<title>${escapeHtml(title)}</title>
${fontImport}
<style>
  :root { --accent: ${accent}; --ink: ${ink}; --muted: ${muted}; --border: ${border}; --card-bg: ${cardBg}; --bg: ${bg}; --pre-bg: ${preBg}; }
  *, *::before, *::after { box-sizing: border-box; }
  body { font-family: ${fontStack}; max-width: 900px; margin: 40px auto; padding: 0 24px; color: var(--ink); background: var(--bg); line-height: 1.6; -webkit-font-smoothing: antialiased; }
  h1 { font-size: 28px; margin-bottom: 4px; }
  h2 { font-size: 20px; margin-top: 36px; border-bottom: 2px solid var(--border); padding-bottom: 6px; }
  h3 { font-size: 17px; color: var(--accent); margin-top: 24px; }
  .subtitle { color: var(--muted); margin-top: 0; font-size: 16px; }
  .lead { font-size: 18px; color: var(--muted); line-height: 1.7; }
  p { margin: 12px 0; }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }
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
  pre { background: var(--pre-bg); color: ${preFg}; padding: 14px 16px; border-radius: 6px; overflow-x: auto; font-size: 13px; }
  code { font-family: "JetBrains Mono", "Fira Code", monospace; }
  hr { border: none; border-top: 1px solid var(--border); margin: 28px 0; }
  figure { margin: 20px 0; text-align: center; }
  figure img { max-width: 100%; border-radius: 6px; }
  .lightboxable { cursor: pointer; transition: transform 0.2s; }
  .lightboxable:hover { transform: scale(1.02); }
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
  .reading-time { color: var(--muted); font-size: 13px; margin-top: 8px; }

  /* Tabs */
  .tabs { margin: 16px 0; }
  .tab-nav { display: flex; gap: 2px; margin-bottom: 0; }
  .tab-btn { padding: 8px 16px; border: 1px solid var(--border); border-bottom: none; background: var(--bg); cursor: pointer; border-radius: 6px 6px 0 0; font-size: 14px; color: var(--muted); }
  .tab-btn.active { background: var(--card-bg); color: var(--accent); font-weight: 600; }
  .tab-panel { padding: 16px; border: 1px solid var(--border); border-radius: 0 6px 6px 6px; background: var(--bg); }

  /* Accordion */
  .accordion { margin: 16px 0; }
  .accordion-item { border: 1px solid var(--border); border-radius: 6px; margin-bottom: 6px; overflow: hidden; }
  .accordion-item summary { padding: 10px 14px; cursor: pointer; font-weight: 600; font-size: 14px; background: var(--card-bg); }
  .accordion-content { padding: 10px 14px; }

  /* Progress bar */
  .progress-bar-container { margin: 12px 0; }
  .progress-label { font-size: 13px; color: var(--muted); display: block; margin-bottom: 4px; }
  .progress-bar { background: var(--border); border-radius: 99px; height: 20px; overflow: hidden; }
  .progress-fill { height: 100%; border-radius: 99px; text-align: center; font-size: 11px; line-height: 20px; color: #fff; font-weight: 600; transition: width 0.4s ease; }

  /* Badge */
  .badge { display: inline-block; padding: 2px 8px; border-radius: 99px; font-size: 12px; font-weight: 600; }

  /* Gallery */
  .gallery { display: grid; gap: 10px; margin: 16px 0; }
  .gallery-cols-1 { grid-template-columns: 1fr; }
  .gallery-cols-2 { grid-template-columns: repeat(2, 1fr); }
  .gallery-cols-3 { grid-template-columns: repeat(3, 1fr); }
  .gallery-cols-4 { grid-template-columns: repeat(4, 1fr); }
  .gallery-item { position: relative; overflow: hidden; border-radius: 6px; }
  .gallery-item img { width: 100%; height: 180px; object-fit: cover; display: block; }
  .gallery-caption { position: absolute; bottom: 0; left: 0; right: 0; padding: 6px 8px; background: rgba(0,0,0,0.6); color: #fff; font-size: 12px; }

  /* Timeline */
  .timeline { position: relative; margin: 20px 0; padding-left: 24px; }
  .timeline::before { content: ''; position: absolute; left: 8px; top: 0; bottom: 0; width: 2px; background: var(--border); }
  .timeline-item { position: relative; margin-bottom: 20px; }
  .timeline-item::before { content: ''; position: absolute; left: -20px; top: 4px; width: 12px; height: 12px; border-radius: 50%; background: var(--accent); border: 2px solid var(--bg); }
  .timeline-date { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.03em; }
  .timeline-content { margin-top: 4px; }
  .timeline-content h4 { margin: 0; font-size: 15px; }
  .timeline-content p { margin: 4px 0 0; font-size: 14px; color: var(--muted); }

  /* FAQ */
  .faq { margin: 16px 0; }
  .faq-item { border: 1px solid var(--border); border-radius: 6px; margin-bottom: 6px; overflow: hidden; }
  .faq-item summary { padding: 10px 14px; cursor: pointer; font-weight: 600; font-size: 14px; }
  .faq-item p { padding: 0 14px 10px; margin: 0; }

  /* Collapsible */
  .collapsible { margin: 12px 0; }
  .collapsible summary { cursor: pointer; font-weight: 600; padding: 8px 0; }
  .collapsible-content { padding: 8px 0; }

  /* Tooltip */
  .tooltip-trigger { position: relative; cursor: help; border-bottom: 1px dashed var(--muted); }
  .tooltip-text { visibility: hidden; position: absolute; bottom: 100%; left: 50%; transform: translateX(-50%); background: var(--ink); color: var(--bg); padding: 6px 10px; border-radius: 4px; font-size: 12px; white-space: nowrap; z-index: 10; }
  .tooltip-trigger:hover .tooltip-text { visibility: visible; }

  /* Mermaid */
  .mermaid { background: var(--card-bg); padding: 16px; border-radius: 6px; margin: 16px 0; font-family: monospace; white-space: pre; overflow-x: auto; font-size: 13px; }
  .mermaid-caption { text-align: center; font-size: 13px; color: var(--muted); margin-top: 4px; }

  /* Chart */
  .chart-container { margin: 16px 0; text-align: center; }

  /* Lightbox overlay */
  .lightbox-overlay { display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.85); z-index: 9999; justify-content: center; align-items: center; cursor: pointer; }
  .lightbox-overlay img { max-width: 90vw; max-height: 90vh; border-radius: 6px; }

  /* Print */
  @media print { body { margin: 0; padding: 16px; } .tab-btn, .lightbox-overlay { display: none !important; } .tab-panel { display: block !important; } }
</style>
</head>
<body>
${showReadingTime ? `<p class="reading-time">${readingTime} min read</p>` : ''}
<h1>${escapeHtml(title)}</h1>
${subtitle ? `<p class="subtitle">${escapeHtml(subtitle)}</p>` : ''}
${body}
${footerNote ? `<div class="footer-note">${escapeHtml(footerNote)}</div>` : ''}

<!-- Lightbox overlay -->
<div class="lightbox-overlay" id="lightbox" onclick="this.style.display='none'"><img id="lightbox-img" src="" alt="" /></div>

<script>
function openLightbox(src) { document.getElementById('lightbox-img').src = src; document.getElementById('lightbox').style.display = 'flex'; }
function switchTab(tabsId, index) {
  var container = document.getElementById(tabsId);
  if (!container) return;
  container.querySelectorAll('.tab-btn').forEach(function(btn, i) { btn.classList.toggle('active', i === index); });
  container.querySelectorAll('.tab-panel').forEach(function(panel, i) { panel.style.display = i === index ? 'block' : 'none'; });
}
</script>
</body>
</html>`;

      const { absPath, relPath } = await resolveOutputPath(filename);
      await writeFile(absPath, html, 'utf-8');

      return { path: absPath, relativePath: relPath, bytes: Buffer.byteLength(html) };
    },
  }),
};