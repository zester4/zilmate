// src/tools/pptx.tool.ts
// Requires: npm install pptxgenjs
import { tool } from 'ai';
import { z } from 'zod';
import * as PptxGenJSModule from 'pptxgenjs';
import { assertReadableFile, resolveOutputPath, ToolInputError, safeExecute } from './lib/outputPaths.js';
import { emitProgress } from '../runtime/progress.js';

// pptxgenjs's type declarations expose the module as a namespace (not a
// class) under moduleResolution "bundler"/"node16"/"nodenext", which makes
// `import pptxgen from 'pptxgenjs'; new pptxgen()` fail to type-check with
// "This expression is not constructable" even though it's fine at runtime
// with esModuleInterop. Resolving the constructor manually side-steps the
// typing mismatch regardless of tsconfig module settings.
const PptxGenJS = ((PptxGenJSModule as unknown as { default?: unknown }).default ??
  PptxGenJSModule) as new () => InstanceType<typeof import('pptxgenjs').default>;

// pptxgenjs has no async writeFile failure surfaced cleanly if the parent dir
// is missing/unwritable, so resolveOutputPath (which mkdir -p's) runs first.

const MAX_SLIDES = 100;
const MAX_BULLETS_PER_SLIDE = 12;
const MAX_BULLET_LENGTH = 300;
const MAX_TITLE_LENGTH = 120;

const HEX_COLOR_RE = /^[0-9a-fA-F]{6}$/; // pptxgenjs wants hex WITHOUT '#'

const bulletSlideSchema = z.object({
  kind: z.literal('bullets').default('bullets'),
  title: z.string().min(1).max(MAX_TITLE_LENGTH),
  bullets: z.array(z.string().min(1).max(MAX_BULLET_LENGTH)).min(1).max(MAX_BULLETS_PER_SLIDE),
  notes: z.string().max(5000).optional(),
});

const imageSlideSchema = z.object({
  kind: z.literal('image'),
  title: z.string().max(MAX_TITLE_LENGTH).optional(),
  imagePath: z.string().min(1),
  caption: z.string().max(300).optional(),
  notes: z.string().max(5000).optional(),
});

const tableSlideSchema = z.object({
  kind: z.literal('table'),
  title: z.string().max(MAX_TITLE_LENGTH).optional(),
  headers: z.array(z.string()).min(1),
  rows: z.array(z.array(z.string())).min(1).max(30),
  notes: z.string().max(5000).optional(),
});

const chartSlideSchema = z.object({
  kind: z.literal('chart'),
  title: z.string().max(MAX_TITLE_LENGTH).optional(),
  chartType: z.enum(['bar', 'line', 'pie']),
  labels: z.array(z.string()).min(1),
  series: z.array(z.object({ name: z.string(), values: z.array(z.number().finite()) })).min(1),
  notes: z.string().max(5000).optional(),
});

const slideSchema = z.discriminatedUnion('kind', [bulletSlideSchema, imageSlideSchema, tableSlideSchema, chartSlideSchema]);

const CHART_TYPE_MAP = {
  bar: 'bar',
  line: 'line',
  pie: 'pie',
} as const;

// Applied to native chart slides so multi-series charts don't all render in
// the same default color — same palette family as chartImage.tool.ts for
// visual consistency between rendered PNG charts and native pptx charts.
const CHART_PALETTE = [
  '1D4ED8', 'DC2626', '16A34A', 'D97706', '7C3AED', '0891B2',
  'DB2777', '65A30D', 'EA580C', '0D9488', '9333EA', 'CA8A04',
];

function validateSlides(slides: z.infer<typeof slideSchema>[]) {
  if (slides.length > MAX_SLIDES) {
    throw new ToolInputError(`Requested ${slides.length} slides, exceeding the ${MAX_SLIDES}-slide limit.`);
  }
  for (const [i, slide] of slides.entries()) {
    if (slide.kind === 'chart') {
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

export const pptxTools = {
  createPptx: tool({
    description:
      'Generate a PowerPoint (.pptx) deck from a mix of slide types: bulleted-text slides, image slides (with caption), data-table slides, and native chart slides (bar/line/pie) — plus optional speaker notes on any slide. Validates slide/bullet counts and chart series lengths up front and returns success:false with a clear message instead of producing a broken or silently-truncated deck. Use for pitch decks, summaries, or handoff presentations.',
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

        // Fail fast on missing image files before we've built any slides.
        for (const [i, slide] of slides.entries()) {
          if (slide.kind === 'image') {
            await assertReadableFile(slide.imagePath, { label: `slide ${i + 1} image` });
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

          if (slide.kind === 'bullets') {
            s.addText(slide.title, { x: 0.5, y: 0.4, w: 12.3, h: 0.9, fontSize: 26, bold: true, color: '1A1A1A' });
            s.addText(
              slide.bullets.map((text) => ({ text, options: { bullet: true, breakLine: true } })),
              { x: 0.6, y: 1.5, w: 12, h: 5.4, fontSize: 18, color: '333333' },
            );
          }

          if (slide.kind === 'image') {
            if (slide.title) s.addText(slide.title, { x: 0.5, y: 0.4, w: 12.3, h: 0.8, fontSize: 24, bold: true });
            s.addImage({ path: slide.imagePath, x: 1.5, y: slide.title ? 1.3 : 0.6, w: 10.3, h: 5.4, sizing: { type: 'contain', w: 10.3, h: 5.4 } });
            if (slide.caption) {
              s.addText(slide.caption, { x: 0.6, y: 7.0, w: 12, h: 0.4, fontSize: 13, color: '666666', align: 'center' });
            }
          }

          if (slide.kind === 'table') {
            if (slide.title) s.addText(slide.title, { x: 0.5, y: 0.4, w: 12.3, h: 0.8, fontSize: 24, bold: true });
            const headerRow = slide.headers.map((h) => ({ text: h, options: { bold: true, fill: { color: 'E8EEF7' }, fontSize: 13 } }));
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

          if (slide.notes) s.addNotes(slide.notes);
        }

        const { absPath, relPath } = await resolveOutputPath(filename);
        // pptxgenjs manages its own file write internally (zip stream), so we
        // rely on it writing directly to the resolved path rather than our
        // atomicWriteFile helper; resolveOutputPath already ensured the dir exists.
        await pptx.writeFile({ fileName: absPath });

        return { path: absPath, relativePath: relPath, slideCount: slides.length + (deckTitle ? 1 : 0) };
      }),
  }),
};