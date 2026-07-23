// src/tools/pptx.tool.ts
// Requires: npm install pptxgenjs
import { tool } from 'ai';
import { z } from 'zod';
import * as PptxGenJSModule from 'pptxgenjs';
import { assertReadableFile, resolveOutputPath, ToolInputError, safeExecute } from './lib/outputPaths.js';
import { emitProgress } from '../runtime/progress.js';
import { resolveImage, type ImageInput } from './lib/image-utils.js';

const PptxGenJS = ((PptxGenJSModule as unknown as { default?: unknown }).default ??
  PptxGenJSModule) as new () => InstanceType<typeof import('pptxgenjs').default>;

const MAX_SLIDES = 100;
const MAX_BULLETS_PER_SLIDE = 12;
const MAX_BULLET_LENGTH = 300;
const MAX_TITLE_LENGTH = 120;

const HEX_COLOR_RE = /^[0-9a-fA-F]{6}$/;
const IMG_FIT_MODES = ['contain', 'cover', 'stretch'] as const;

const imageInputSchema = z.object({
  path: z.string().optional().describe('Local image file path'),
  url: z.string().optional().describe('Remote image URL'),
  generate: z.string().optional().describe('AI image generation prompt'),
  provider: z.enum(['openai', 'chatgpt', 'gemini', 'google', 'default']).optional(),
  size: z.string().regex(/^\d+x\d+$/).optional().describe('Image size for generation, e.g. "1024x1024"'),
});

const shapeSchema = z.object({
  kind: z.literal('shape'),
  shapeType: z.enum(['rect', 'circle', 'ellipse', 'arrow', 'line', 'chevron', 'pentagon', 'hexagon', 'star', 'heart']),
  x: z.number().min(0).max(13),
  y: z.number().min(0).max(7.5),
  w: z.number().min(0.1).max(13),
  h: z.number().min(0.1).max(7.5),
  fillColor: z.string().regex(HEX_COLOR_RE).optional(),
  borderColor: z.string().regex(HEX_COLOR_RE).optional(),
  borderWidth: z.number().min(0).max(10).optional(),
  shadow: z.boolean().optional(),
  text: z.string().optional(),
  hyperlink: z.string().url().optional(),
});

const bulletSlideSchema = z.object({
  kind: z.literal('bullets'),
  title: z.string().min(1).max(MAX_TITLE_LENGTH),
  bullets: z.array(z.string().min(1).max(MAX_BULLET_LENGTH)).min(1).max(MAX_BULLETS_PER_SLIDE),
  notes: z.string().max(5000).optional(),
  transition: z.enum(['fade', 'push', 'wipe', 'dissolve', 'cover', 'uncover', 'none']).optional(),
  background: z.string().regex(HEX_COLOR_RE).optional(),
});

const imageSlideSchema = z.object({
  kind: z.literal('image'),
  title: z.string().max(MAX_TITLE_LENGTH).optional(),
  ...imageInputSchema.shape,
  caption: z.string().max(300).optional(),
  notes: z.string().max(5000).optional(),
  fitMode: z.enum(IMG_FIT_MODES).optional(),
  hyperlink: z.string().url().optional(),
  altText: z.string().optional(),
  transition: z.enum(['fade', 'push', 'wipe', 'dissolve', 'cover', 'uncover', 'none']).optional(),
  background: z.string().regex(HEX_COLOR_RE).optional(),
});

const tableSlideSchema = z.object({
  kind: z.literal('table'),
  title: z.string().max(MAX_TITLE_LENGTH).optional(),
  headers: z.array(z.string()).min(1),
  rows: z.array(z.array(z.string())).min(1).max(30),
  notes: z.string().max(5000).optional(),
  headerColor: z.string().regex(HEX_COLOR_RE).optional(),
  transition: z.enum(['fade', 'push', 'wipe', 'dissolve', 'cover', 'uncover', 'none']).optional(),
  background: z.string().regex(HEX_COLOR_RE).optional(),
});

const chartSlideSchema = z.object({
  kind: z.literal('chart'),
  title: z.string().max(MAX_TITLE_LENGTH).optional(),
  chartType: z.enum(['bar', 'line', 'pie']),
  labels: z.array(z.string()).min(1),
  series: z.array(z.object({ name: z.string(), values: z.array(z.number().finite()) })).min(1),
  notes: z.string().max(5000).optional(),
  transition: z.enum(['fade', 'push', 'wipe', 'dissolve', 'cover', 'uncover', 'none']).optional(),
  background: z.string().regex(HEX_COLOR_RE).optional(),
});

const chartImageSlideSchema = z.object({
  kind: z.literal('chartImage'),
  title: z.string().max(MAX_TITLE_LENGTH).optional(),
  chartType: z.enum(['bar', 'line', 'pie', 'doughnut']),
  labels: z.array(z.string()).min(1),
  series: z.array(z.object({ name: z.string(), values: z.array(z.number().finite()) })).min(1),
  width: z.number().int().min(200).max(3000).default(800),
  height: z.number().int().min(200).max(3000).default(450),
  notes: z.string().max(5000).optional(),
  transition: z.enum(['fade', 'push', 'wipe', 'dissolve', 'cover', 'uncover', 'none']).optional(),
  background: z.string().regex(HEX_COLOR_RE).optional(),
});

const textBoxSlideSchema = z.object({
  kind: z.literal('textBox'),
  text: z.string().min(1),
  x: z.number().min(0).max(13).default(0.5),
  y: z.number().min(0).max(7.5).default(0.5),
  w: z.number().min(0.1).max(13).default(12),
  h: z.number().min(0.1).max(7.5).default(1),
  fontSize: z.number().int().min(8).max(96).default(18),
  color: z.string().regex(HEX_COLOR_RE).optional(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  alignment: z.enum(['left', 'center', 'right']).optional(),
  hyperlink: z.string().url().optional(),
  transition: z.enum(['fade', 'push', 'wipe', 'dissolve', 'cover', 'uncover', 'none']).optional(),
  background: z.string().regex(HEX_COLOR_RE).optional(),
});

const sectionSlideSchema = z.object({
  kind: z.literal('section'),
  title: z.string().min(1).max(MAX_TITLE_LENGTH),
  subtitle: z.string().max(300).optional(),
  transition: z.enum(['fade', 'push', 'wipe', 'dissolve', 'cover', 'uncover', 'none']).optional(),
  background: z.string().regex(HEX_COLOR_RE).optional(),
});

const slideSchema = z.discriminatedUnion('kind', [
  bulletSlideSchema,
  imageSlideSchema,
  tableSlideSchema,
  chartSlideSchema,
  chartImageSlideSchema,
  textBoxSlideSchema,
  sectionSlideSchema,
  shapeSchema,
]);

const CHART_TYPE_MAP = {
  bar: 'bar',
  line: 'line',
  pie: 'pie',
} as const;

const TRANSITION_MAP = {
  fade: 'fade',
  push: 'push',
  wipe: 'wipe',
  dissolve: 'dissolve',
  cover: 'cover',
  uncover: 'uncover',
  none: 'none',
} as const;

const CHART_PALETTE = [
  '1D4ED8', 'DC2626', '16A34A', 'D97706', '7C3AED', '0891B2',
  'DB2777', '65A30D', 'EA580C', '0D9488', '9333EA', 'CA8A04',
];

function validateSlides(slides: z.infer<typeof slideSchema>[]) {
  if (slides.length > MAX_SLIDES) {
    throw new ToolInputError(`Requested ${slides.length} slides, exceeding the ${MAX_SLIDES}-slide limit.`);
  }
  for (const [i, slide] of slides.entries()) {
    if (slide.kind === 'chart' || slide.kind === 'chartImage') {
      for (const s of slide.series) {
        if (s.values.length !== slide.labels.length) {
          throw new ToolInputError(
            `Slide ${i + 1} ("${slide.title ?? 'chart'}"): series "${s.name}" has ${s.values.length} values but ${slide.labels.length} labels.`,
          );
        }
      }
    }
    if (slide.kind === 'table') {
      const badRow = slide.rows.find((r) => r.length !== slide.headers.length);
      if (badRow) {
        throw new ToolInputError(`Slide ${i + 1}: a table row has ${badRow.length} cells but headers define ${slide.headers.length} columns.`);
      }
    }
  }
}

async function renderChartImage(chartType: string, labels: string[], series: { name: string; values: number[] }[], width: number, height: number): Promise<Buffer> {
  const { ChartJSNodeCanvas } = await import('chartjs-node-canvas');
  const canvasRenderer = new ChartJSNodeCanvas({ width, height, backgroundColour: 'white' });

  const palette = [
    '#1d4ed8', '#dc2626', '#16a34a', '#d97706', '#7c3aed', '#0891b2',
    '#db2777', '#65a30d', '#ea580c', '#0d9488', '#9333ea', '#ca8a04',
  ];

  const buffer = await canvasRenderer.renderToBuffer({
    type: chartType as any,
    data: {
      labels,
      datasets: series.map((s, i) => ({
        label: s.name,
        data: s.values,
        backgroundColor: palette[i % palette.length],
        borderColor: palette[i % palette.length],
      })),
    },
    options: {
      plugins: {
        legend: { display: series.length > 1 },
      },
    },
  });

  if (!buffer || buffer.length === 0) {
    throw new ToolInputError('Chart image renderer produced an empty buffer.');
  }
  return buffer;
}

export const pptxTools = {
  createPptx: tool({
    description:
      'Generate a PowerPoint (.pptx) deck from a mix of slide types: bulleted-text slides, image slides (with local/remote/AI-generated images), data-table slides, native chart slides (bar/line/pie), rendered chart-image slides (bar/line/pie/doughnut), rich text boxes, shape slides (rect, circle, arrow, etc.), and section header slides — plus optional speaker notes, slide transitions, per-slide background colors, and hyperlinks on shapes/images/text. Validates slide/bullet counts and chart series lengths up front and returns success:false with a clear message instead of producing a broken or silently-truncated deck. Use for pitch decks, summaries, or handoff presentations.',
    inputSchema: z.object({
      filename: z.string().min(1).max(200).describe('Base filename, e.g. "q3-review.pptx"'),
      deckTitle: z.string().max(MAX_TITLE_LENGTH).optional(),
      subtitle: z.string().max(300).optional(),
      accentColor: z
        .string()
        .regex(HEX_COLOR_RE, 'accentColor must be a 6-digit hex string without "#", e.g. "1D4ED8"')
        .optional(),
      slides: z.array(slideSchema).min(1),
    }),
    execute: async ({ filename, deckTitle, subtitle, accentColor, slides }) =>
      safeExecute(async () => {
        validateSlides(slides);

        // Fail fast on missing image files before building any slides.
        for (const [i, slide] of slides.entries()) {
          if (slide.kind === 'image' && slide.path) {
            await assertReadableFile(slide.path, { label: `slide ${i + 1} image` });
          }
        }

        emitProgress({ type: 'step', label: 'Generating slide deck', detail: filename });

        const pptx = new PptxGenJS();
        pptx.defineLayout({ name: 'WIDE', width: 13.33, height: 7.5 });
        pptx.layout = 'WIDE';

        const accent = accentColor ?? '1D4ED8';

        if (deckTitle) {
          const titleSlide = pptx.addSlide();
          titleSlide.background = { color: 'FFFFFF' };
          titleSlide.addText(deckTitle, { x: 0.6, y: 2.6, w: 12, h: 1.2, fontSize: 36, bold: true, color: '1A1A1A' });
          if (subtitle) {
            titleSlide.addText(subtitle, { x: 0.6, y: 3.7, w: 12, h: 0.8, fontSize: 18, color: '666666' });
          }
          titleSlide.addShape('rect', { x: 0.6, y: 2.45, w: 1.4, h: 0.06, fill: { color: accent } });
        }

        for (const slide of slides) {
          const s = pptx.addSlide();
          const slideAny = slide as any;

          // Apply background
          if (slideAny.background) {
            s.background = { color: slideAny.background };
          } else if (slide.kind !== 'image' && slide.kind !== 'section') {
            s.background = { color: 'FFFFFF' };
          }

          // Apply transition
          if (slideAny.transition && slideAny.transition !== 'none') {
            (s as any).transition = { type: TRANSITION_MAP[slideAny.transition as keyof typeof TRANSITION_MAP] };
          }

          if (slide.kind === 'bullets') {
            s.addText(slide.title, { x: 0.5, y: 0.4, w: 12.3, h: 0.9, fontSize: 26, bold: true, color: '1A1A1A' });
            s.addText(
              slide.bullets.map((text) => ({ text, options: { bullet: true, breakLine: true } })),
              { x: 0.6, y: 1.5, w: 12, h: 5.4, fontSize: 18, color: '333333' },
            );
          }

          if (slide.kind === 'image') {
            let imagePath: string;

            if (slide.generate) {
              emitProgress({ type: 'step', label: 'Generating AI image for slide', detail: slide.title ?? '' });
              const resolved = await resolveImage(
                { generate: slide.generate, provider: slide.provider, size: slide.size },
                'pptx image',
              );
              imagePath = resolved.sourcePath!;
            } else if (slide.url) {
              const resolved = await resolveImage({ url: slide.url }, 'pptx image');
              const { absPath } = await resolveOutputPath(`pptx-img-${Date.now()}.${resolved.extension}`, { unique: false });
              const { writeFile } = await import('node:fs/promises');
              await writeFile(absPath, resolved.buffer);
              imagePath = absPath;
            } else {
              imagePath = slide.path!;
            }

            if (slide.title) {
              s.addText(slide.title, { x: 0.5, y: 0.4, w: 12.3, h: 0.8, fontSize: 24, bold: true });
            }
            const yPos = slide.title ? 1.3 : 0.6;
            const fitType = slide.fitMode ?? 'contain';
            s.addImage({
              path: imagePath,
              x: 1.5,
              y: yPos,
              w: 10.3,
              h: 5.4,
              sizing: { type: fitType as any, w: 10.3, h: 5.4 },
              ...(slide.hyperlink ? { hyperlink: { url: slide.hyperlink } } : {}),
            } as any);
            if (slide.caption) {
              s.addText(slide.caption, { x: 0.6, y: 7.0, w: 12, h: 0.4, fontSize: 13, color: '666666', align: 'center' });
            }
          }

          if (slide.kind === 'table') {
            if (slide.title) s.addText(slide.title, { x: 0.5, y: 0.4, w: 12.3, h: 0.8, fontSize: 24, bold: true });
            const headerFill = slide.headerColor ?? 'E8EEF7';
            const headerRow = slide.headers.map((h) => ({
              text: h,
              options: { bold: true, fill: { color: headerFill }, fontSize: 13 },
            }));
            const dataRows = slide.rows.map((row) => row.map((cell) => ({ text: cell, options: { fontSize: 12 } })));
            s.addTable([headerRow, ...dataRows], { x: 0.6, y: slide.title ? 1.4 : 0.7, w: 12.1, autoPage: false });
          }

          if (slide.kind === 'chart') {
            if (slide.title) s.addText(slide.title, { x: 0.5, y: 0.4, w: 12.3, h: 0.8, fontSize: 24, bold: true });
            s.addChart(
              CHART_TYPE_MAP[slide.chartType],
              slide.series.map((series) => ({ name: series.name, labels: slide.labels, values: series.values })),
              {
                x: 0.6,
                y: slide.title ? 1.4 : 0.7,
                w: 12.1,
                h: 5.4,
                chartColors: CHART_PALETTE.slice(0, Math.max(slide.series.length, 1)),
              },
            );
          }

          if (slide.kind === 'chartImage') {
            if (slide.title) s.addText(slide.title, { x: 0.5, y: 0.4, w: 12.3, h: 0.8, fontSize: 24, bold: true });
            const chartBuffer = await renderChartImage(slide.chartType, slide.labels, slide.series, slide.width, slide.height);
            const { absPath } = await resolveOutputPath(`chart-${Date.now()}.png`, { unique: false });
            const { writeFile } = await import('node:fs/promises');
            await writeFile(absPath, chartBuffer);
            s.addImage({
              path: absPath,
              x: 0.6,
              y: slide.title ? 1.4 : 0.7,
              w: 12.1,
              h: 5.4,
              sizing: { type: 'contain', w: 12.1, h: 5.4 },
            });
          }

          if (slide.kind === 'textBox') {
            const textOpts: Record<string, any> = {
              x: slide.x,
              y: slide.y,
              w: slide.w,
              h: slide.h,
              fontSize: slide.fontSize,
              ...(slide.color ? { color: slide.color } : { color: '1A1A1A' }),
              ...(slide.bold ? { bold: true } : {}),
              ...(slide.italic ? { italic: true } : {}),
              ...(slide.alignment ? { align: slide.alignment } : {}),
              ...(slide.hyperlink ? { hyperlink: { url: slide.hyperlink } } : {}),
            };
            s.addText(slide.text, textOpts);
          }

          if (slide.kind === 'section') {
            s.background = { color: accent };
            s.addText(slide.title, {
              x: 0.6,
              y: 2.5,
              w: 12,
              h: 1.2,
              fontSize: 36,
              bold: true,
              color: 'FFFFFF',
            });
            if (slide.subtitle) {
              s.addText(slide.subtitle, {
                x: 0.6,
                y: 3.7,
                w: 12,
                h: 0.8,
                fontSize: 18,
                color: 'E0E0E0',
              });
            }
          }

          if (slide.kind === 'shape') {
            const shapeOpts: Record<string, any> = {
              x: slide.x,
              y: slide.y,
              w: slide.w,
              h: slide.h,
              ...(slide.fillColor ? { fill: { color: slide.fillColor } } : {}),
              ...(slide.borderColor ? { line: { color: slide.borderColor, width: slide.borderWidth ?? 1 } } : {}),
              ...(slide.shadow ? { shadow: { type: 'outer', blur: 6, offset: 2, color: '000000', opacity: 0.3 } } : {}),
              ...(slide.hyperlink ? { hyperlink: { url: slide.hyperlink } } : {}),
            };
            s.addShape(slide.shapeType as any, shapeOpts);
            if (slide.text) {
              s.addText(slide.text, {
                x: slide.x,
                y: slide.y,
                w: slide.w,
                h: slide.h,
                fontSize: 14,
                color: '1A1A1A',
                align: 'center',
                valign: 'middle',
              });
            }
          }

          if (slideAny.notes) s.addNotes(slideAny.notes);
        }

        const { absPath, relPath } = await resolveOutputPath(filename);
        await pptx.writeFile({ fileName: absPath });

        return { path: absPath, relativePath: relPath, slideCount: slides.length + (deckTitle ? 1 : 0) };
      }),
  }),
};