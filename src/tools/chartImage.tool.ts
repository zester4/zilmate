// src/tools/chartImage.tool.ts
// Requires: npm install chartjs-node-canvas chart.js
// NOTE: chartjs-node-canvas depends on `canvas`, which needs native build deps
// on the host (Cairo/Pango/libjpeg/librsvg). On Debian/Ubuntu:
//   apt-get install -y libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev
import { tool } from 'ai';
import { z } from 'zod';
import { ChartJSNodeCanvas } from 'chartjs-node-canvas';
import { resolveOutputPath, atomicWriteFile, ToolInputError, safeExecute } from './lib/outputPaths.js';
import { emitProgress } from '../runtime/progress.js';

const chartTypeSchema = z.enum(['bar', 'line', 'pie', 'doughnut']);
const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const MAX_LABELS = 100;
const MAX_DATASETS = 12;
const RENDER_TIMEOUT_MS = 15_000;

const datasetSchema = z.object({
  label: z.string().min(1).max(100),
  data: z.array(z.number().finite()).min(1),
  color: z
    .string()
    .regex(HEX_COLOR_RE, 'color must be a hex string like "#1d4ed8"')
    .optional(),
});

const inputSchema = z.object({
  filename: z.string().min(1).max(200).describe('Base filename, e.g. "revenue-by-quarter.png"'),
  type: chartTypeSchema,
  title: z.string().max(200).optional(),
  labels: z.array(z.string().min(1)).min(1).max(MAX_LABELS),
  datasets: z.array(datasetSchema).min(1).max(MAX_DATASETS),
  width: z.number().int().min(200).max(3000).default(800),
  height: z.number().int().min(200).max(3000).default(450),
});

function validateChartInput(input: z.infer<typeof inputSchema>) {
  const { type, labels, datasets } = input;

  for (const ds of datasets) {
    if (ds.data.length !== labels.length) {
      throw new ToolInputError(
        `Dataset "${ds.label}" has ${ds.data.length} data points but there are ${labels.length} labels — they must match.`,
      );
    }
  }

  if ((type === 'pie' || type === 'doughnut') && datasets.length > 1) {
    throw new ToolInputError(`Chart type "${type}" supports exactly one dataset (got ${datasets.length}).`);
  }

  const hasNegative = datasets.some((d) => d.data.some((v) => v < 0));
  if ((type === 'pie' || type === 'doughnut') && hasNegative) {
    throw new ToolInputError(`Chart type "${type}" cannot render negative values.`);
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new ToolInputError(`${label} timed out after ${ms}ms`)), ms)),
  ]);
}

// Distinct default palette so multi-series charts (up to MAX_DATASETS = 12) stay
// readable without the caller specifying colors. Chosen for pairwise contrast,
// not just "20 colors" — avoids near-duplicates like two similar blues in a row.
const DEFAULT_PALETTE = [
  '#1d4ed8', // blue
  '#dc2626', // red
  '#16a34a', // green
  '#d97706', // amber
  '#7c3aed', // violet
  '#0891b2', // cyan
  '#db2777', // pink
  '#65a30d', // lime
  '#ea580c', // orange
  '#0d9488', // teal
  '#9333ea', // purple
  '#ca8a04', // gold
  '#e11d48', // rose
  '#059669', // emerald
  '#4f46e5', // indigo
  '#b45309', // brown-amber
  '#0369a1', // sky
  '#be123c', // crimson
  '#15803d', // forest
  '#6d28d9', // deep violet
];

export const chartImageTools = {
  createChartImage: tool({
    description:
      'Render a bar/line/pie/doughnut chart to a PNG image from labeled data series, with input validation (mismatched lengths, invalid colors, negative values on pie/doughnut are rejected with a clear error before rendering). Use to embed a chart into a docx/pptx/html report or as a standalone visual. Returns success:false with a message if the input is invalid or rendering fails — do not assume the file was created without checking success.',
    inputSchema,
    execute: async (input) =>
      safeExecute(async () => {
        validateChartInput(input);
        const { filename, type, title, labels, datasets, width, height } = input;

        emitProgress({ type: 'step', label: 'Rendering chart', detail: filename });

        const canvasRenderer = new ChartJSNodeCanvas({ width, height, backgroundColour: 'white' });

        let buffer: Buffer;
        try {
          buffer = await withTimeout(
            canvasRenderer.renderToBuffer({
              type,
              data: {
                labels,
                datasets: datasets.map((d, i) => ({
                  label: d.label,
                  data: d.data,
                  backgroundColor: d.color ?? DEFAULT_PALETTE[i % DEFAULT_PALETTE.length],
                  borderColor: d.color ?? DEFAULT_PALETTE[i % DEFAULT_PALETTE.length],
                })),
              },
              options: {
                plugins: {
                  title: title ? { display: true, text: title } : { display: false },
                  legend: { display: datasets.length > 1 },
                },
              },
            }),
            RENDER_TIMEOUT_MS,
            'Chart rendering',
          );
        } catch (err) {
          if (err instanceof ToolInputError) throw err;
          throw new ToolInputError(
            `Chart rendering failed (likely a missing native canvas dependency on this host): ${err instanceof Error ? err.message : String(err)}`,
          );
        }

        if (!buffer || buffer.length === 0) {
          throw new ToolInputError('Chart renderer produced an empty image buffer.');
        }

        const { absPath, relPath } = await resolveOutputPath(filename);
        await atomicWriteFile(absPath, buffer);

        return { path: absPath, relativePath: relPath, bytes: buffer.length };
      }),
  }),
};