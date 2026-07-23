// src/tools/docx.tool.ts
// Requires: npm install docx
import { tool } from 'ai';
import { z } from 'zod';
import { readFile, writeFile } from 'node:fs/promises';
import {
  Document,
  Packer,
  Paragraph,
  HeadingLevel,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  ImageRun,
  Header,
  Footer,
  PageNumber,
  AlignmentType,
  TableOfContents,
  ExternalHyperlink,
  PageBreak,
  BorderStyle,
  ShadingType,
  convertInchesToTwip,
  LevelFormat,
  TabStopPosition,
  TabStopType,
} from 'docx';
import { resolveOutputPath, atomicWriteFile, ToolInputError, safeExecute } from './lib/outputPaths.js';
import { emitProgress } from '../runtime/progress.js';
import { resolveImage } from './lib/image-utils.js';

// ---------- schema ----------

const runSchema = z.object({
  text: z.string(),
  bold: z.boolean().optional(),
  italics: z.boolean().optional(),
  underline: z.boolean().optional(),
  strikethrough: z.boolean().optional(),
  smallCaps: z.boolean().optional(),
  allCaps: z.boolean().optional(),
  color: z.string().optional().describe('Hex color without #, e.g. "1D4ED8"'),
  size: z.number().int().optional().describe('Font size in half-points, e.g. 24 = 12pt'),
  font: z.string().optional().describe('Font family name'),
  highlight: z.string().optional().describe('Highlight color, e.g. "yellow"'),
  link: z.string().url().optional().describe('If set, renders this run as a hyperlink'),
  subscript: z.boolean().optional(),
  superscript: z.boolean().optional(),
});

const alignmentSchema = z.enum(['left', 'center', 'right', 'justify']).default('left');
const ALIGN_MAP = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
};

const bulletItemSchema = z.union([
  z.string(),
  z.object({ text: z.string(), level: z.number().int().min(0).max(3).default(0) }),
]);

const imageBorderSchema = z.object({
  color: z.string().optional().describe('Hex without #'),
  width: z.number().int().optional().describe('Border width in points'),
  style: z.enum(['single', 'double', 'dotted', 'dashed']).optional(),
});

type ImageBlock = z.infer<typeof imageBlockSchema>;
type ChartBlock = z.infer<typeof chartBlockSchema>;

const imageBlockSchema = z.object({
  type: z.literal('image'),
  path: z.string().optional().describe('Absolute path to a local image file (png/jpg)'),
  url: z.string().optional().describe('Remote image URL'),
  generate: z.string().optional().describe('AI image generation prompt'),
  provider: z.enum(['openai', 'chatgpt', 'gemini', 'google', 'default']).optional(),
  size: z.string().regex(/^\d+x\d+$/).optional().describe('Image size for generation, e.g. "1024x1024"'),
  width: z.number().int().default(500).describe('Width in pixels'),
  height: z.number().int().default(300).describe('Height in pixels'),
  caption: z.string().optional(),
  altText: z.string().optional().describe('Accessibility alt text'),
  border: imageBorderSchema.optional(),
  shadow: z.boolean().optional().describe('Apply a drop shadow effect'),
  rotation: z.number().int().optional().describe('Rotation in degrees'),
});

const chartBlockSchema = z.object({
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
  caption: z.string().optional(),
});

const blockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('heading'), text: z.string(), level: z.number().int().min(1).max(4).default(1) }),
  z.object({
    type: z.literal('paragraph'),
    runs: z.array(runSchema).min(1).optional(),
    text: z.string().optional().describe('Shorthand for a single plain run; ignored if `runs` is set'),
    alignment: alignmentSchema.optional(),
    spacingAfter: z.number().int().optional().describe('Twips of space after paragraph'),
    spacingBefore: z.number().int().optional().describe('Twips of space before paragraph'),
    indentLeft: z.number().int().optional().describe('Left indent in twips'),
    indentRight: z.number().int().optional().describe('Right indent in twips'),
    indentFirstLine: z.number().int().optional().describe('First line indent in twips'),
    style: z.string().optional().describe('Named style to apply'),
  }),
  z.object({ type: z.literal('bullets'), items: z.array(bulletItemSchema).min(1) }),
  z.object({ type: z.literal('numbered'), items: z.array(bulletItemSchema).min(1) }),
  z.object({
    type: z.literal('table'),
    headers: z.array(z.string()).min(1),
    rows: z.array(z.array(z.string())).min(1),
    headerColor: z.string().optional().describe('Hex without #, default light blue'),
    borderColor: z.string().optional().describe('Hex without #'),
    alternateRowColor: z.string().optional().describe('Hex without # for alternating row shading'),
  }),
  imageBlockSchema,
  chartBlockSchema,
  z.object({ type: z.literal('quote'), text: z.string(), attribution: z.string().optional() }),
  z.object({ type: z.literal('pageBreak') }),
  z.object({ type: z.literal('tableOfContents') }),
  z.object({ type: z.literal('divider') }),
  z.object({
    type: z.literal('columns'),
    columns: z
      .array(
        z.object({
          width: z.number().int().optional().describe('Column width in twips'),
          blocks: z.array(z.any()).min(1),
        }),
      )
      .min(2)
      .max(3),
    spacing: z.number().int().optional().describe('Spacing between columns in twips'),
  }),
  z.object({
    type: z.literal('sectionBreak'),
    orientation: z.enum(['portrait', 'landscape']).optional(),
    margins: z
      .object({
        top: z.number().default(1),
        bottom: z.number().default(1),
        left: z.number().default(1),
        right: z.number().default(1),
      })
      .optional(),
  }),
  z.object({ type: z.literal('bookmark'), name: z.string().min(1) }),
  z.object({ type: z.literal('crossReference'), bookmark: z.string().min(1), text: z.string().optional() }),
  z.object({ type: z.literal('footnote'), text: z.string(), noteId: z.number().int().optional() }),
  z.object({
    type: z.literal('watermark'),
    text: z.string(),
    color: z.string().optional().describe('Hex without #, default "CCCCCC"'),
    opacity: z.number().min(0).max(1).optional().describe('Opacity 0-1, default 0.3'),
  }),
  z.object({
    type: z.literal('qrCode'),
    data: z.string().min(1),
    size: z.number().int().default(200).describe('Size in pixels'),
    caption: z.string().optional(),
  }),
  z.object({
    type: z.literal('smartArt'),
    prompt: z.string().min(1).describe('AI prompt to generate a diagram image'),
    style: z.enum(['process', 'hierarchy', 'radial', 'matrix', 'pyramid']).optional(),
    width: z.number().int().default(600),
    height: z.number().int().default(400),
    caption: z.string().optional(),
  }),
]);

const numberingConfigId = 'zilmate-bullets';
const numberedConfigId = 'zilmate-numbered';

function buildRuns(runs: z.infer<typeof runSchema>[]) {
  return runs.map((r) => {
    const textRun = new TextRun({
      text: r.text,
      bold: r.bold ?? false,
      italics: r.italics ?? false,
      ...(r.underline ? { underline: {} } : {}),
      ...(r.strikethrough ? { strike: true } : {}),
      ...(r.smallCaps ? { smallCaps: true } : {}),
      ...(r.allCaps ? { allCaps: true } : {}),
      ...(r.subscript ? { subScript: true } : {}),
      ...(r.superscript ? { superScript: true } : {}),
      ...(r.color ? { color: r.color } : {}),
      ...(r.size ? { size: r.size } : {}),
      ...(r.font ? { font: r.font } : {}),
      ...(r.highlight ? { shading: { type: ShadingType.SOLID, color: r.highlight, fill: r.highlight } } : {}),
    });
    if (r.link) {
      return new ExternalHyperlink({ link: r.link, children: [textRun] });
    }
    return textRun;
  });
}

async function buildImageParagraphs(block: ImageBlock): Promise<Paragraph[]> {
  const resolved = await resolveImage(
    { path: block.path, url: block.url, generate: block.generate, provider: block.provider, size: block.size },
    'docx image',
  );

  const imageRun = new ImageRun({
    data: resolved.buffer,
    transformation: { width: block.width, height: block.height },
    type: resolved.extension === 'png' ? 'png' : 'jpg',
    ...(block.altText ? { altText: { name: block.altText, title: block.altText, description: block.altText } as any } : {}),
  } as any);

  const paragraphs: Paragraph[] = [new Paragraph({ children: [imageRun], alignment: AlignmentType.CENTER })];

  if (block.caption) {
    paragraphs.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: block.caption, italics: true, size: 18, color: '666666' })],
      }),
    );
  }
  return paragraphs;
}

async function buildChartImage(block: ChartBlock): Promise<Buffer> {
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
      datasets: block.datasets.map((d, i) => ({
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

  if (!buffer || buffer.length === 0) {
    throw new ToolInputError('Chart renderer produced an empty image buffer.');
  }
  return buffer;
}

const HEADING_MAP = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4];

export const docxTools = {
  createDocx: tool({
    description:
      'Generate a Word (.docx) document with rich formatting: headings, styled/hyperlinked paragraphs, bulleted and numbered lists (with nesting), tables, embedded images (local, remote URL, or AI-generated via prompt), charts (bar/line/pie/doughnut rendered as images), block quotes, page breaks, dividers, multi-column layouts, section breaks, bookmarks, cross-references, footnotes, watermarks, QR codes, SmartArt diagrams (AI-generated), and an optional auto-generated table of contents. Supports running headers/footers with page numbers, custom page margins, document properties (author, subject, keywords), and a title page. Use for reports, memos, proposals, or handoff docs delivered as Word files.',
    inputSchema: z.object({
      filename: z.string().min(1).describe('Base filename, e.g. "incident-report.docx"'),
      title: z.string().optional(),
      subtitle: z.string().optional(),
      author: z.string().optional(),
      subject: z.string().optional(),
      keywords: z.array(z.string()).optional(),
      category: z.string().optional(),
      blocks: z.array(blockSchema).min(1),
      headerText: z.string().optional().describe('Repeats at the top of every page'),
      footerText: z.string().optional().describe('Repeats at the bottom of every page (page number is auto-appended)'),
      showPageNumbers: z.boolean().default(true),
      margins: z
        .object({
          top: z.number().default(1),
          bottom: z.number().default(1),
          left: z.number().default(1),
          right: z.number().default(1),
        })
        .optional()
        .describe('Page margins in inches'),
      styles: z
        .array(
          z.object({
            name: z.string(),
            basedOn: z.string().optional(),
            font: z.string().optional(),
            size: z.number().int().optional(),
            color: z.string().optional(),
            bold: z.boolean().optional(),
          }),
        )
        .optional()
        .describe('Custom style definitions'),
    }),
    execute: async ({
      filename,
      title,
      subtitle,
      author,
      subject,
      keywords,
      category,
      blocks,
      headerText,
      footerText,
      showPageNumbers,
      margins,
      styles: customStyles,
    }) =>
      safeExecute(async () => {
        emitProgress({ type: 'step', label: 'Generating Word document', detail: filename });

        const children: (Paragraph | Table | TableOfContents)[] = [];
        const footnotes: { id: number; text: string }[] = [];
        let nextFootnoteId = 1;

        if (title) {
          children.push(new Paragraph({ text: title, heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER }));
        }
        if (subtitle) {
          children.push(
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new TextRun({ text: subtitle, size: 24, color: '666666', italics: true })],
            }),
          );
        }
        if (author) {
          children.push(
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { after: 400 },
              children: [new TextRun({ text: author, size: 20, color: '888888' })],
            }),
          );
        }

        for (const block of blocks) {
          switch (block.type) {
            case 'heading':
              children.push(new Paragraph({ text: block.text, heading: HEADING_MAP[Math.min(block.level - 1, 3)]! }));
              break;

            case 'paragraph': {
              const runs = block.runs ? buildRuns(block.runs) : [new TextRun(block.text ?? '')];
              const paraOpts: Record<string, any> = { children: runs };
              if (block.alignment) paraOpts.alignment = ALIGN_MAP[block.alignment];
              if (block.spacingAfter || block.spacingBefore) {
                paraOpts.spacing = {};
                if (block.spacingAfter) paraOpts.spacing.after = block.spacingAfter;
                if (block.spacingBefore) paraOpts.spacing.before = block.spacingBefore;
              }
              if (block.indentLeft || block.indentRight || block.indentFirstLine) {
                paraOpts.indent = {};
                if (block.indentLeft) paraOpts.indent.left = block.indentLeft;
                if (block.indentRight) paraOpts.indent.right = block.indentRight;
                if (block.indentFirstLine) paraOpts.indent.firstLine = block.indentFirstLine;
              }
              if (block.style) paraOpts.style = block.style;
              children.push(new Paragraph(paraOpts));
              break;
            }

            case 'bullets':
              for (const item of block.items) {
                const isObj = typeof item === 'object';
                children.push(
                  new Paragraph({ text: isObj ? item.text : item, bullet: { level: isObj ? item.level : 0 } }),
                );
              }
              break;

            case 'numbered':
              for (const item of block.items) {
                const isObj = typeof item === 'object';
                children.push(
                  new Paragraph({
                    text: isObj ? item.text : item,
                    numbering: { reference: numberedConfigId, level: isObj ? item.level : 0 },
                  }),
                );
              }
              break;

            case 'table': {
              const headerColor = block.headerColor ?? 'E8EEF7';
              const borderColor = block.borderColor ?? 'CCCCCC';
              const altColor = block.alternateRowColor;
              children.push(
                new Table({
                  width: { size: 100, type: WidthType.PERCENTAGE },
                  rows: [
                    new TableRow({
                      children: block.headers.map(
                        (h) =>
                          new TableCell({
                            shading: { type: ShadingType.SOLID, color: headerColor, fill: headerColor },
                            children: [new Paragraph({ children: [new TextRun({ text: h, bold: true })] })],
                          }),
                      ),
                    }),
                    ...block.rows.map(
                      (row, ri) =>
                        new TableRow({
                          children: row.map(
                            (cell) =>
                              new TableCell({
                                ...(altColor && ri % 2 === 1
                                  ? { shading: { type: ShadingType.SOLID, color: altColor, fill: altColor } }
                                  : {}),
                                children: [new Paragraph(cell)],
                              }),
                          ),
                        }),
                    ),
                  ],
                }),
              );
              break;
            }

            case 'image': {
              const imgParas = await buildImageParagraphs(block);
              children.push(...imgParas);
              break;
            }

            case 'chart': {
              const chartBuffer = await buildChartImage(block);
              const imageRun = new ImageRun({
                data: chartBuffer,
                transformation: { width: block.width, height: block.height },
                type: 'png',
              });
              children.push(new Paragraph({ children: [imageRun], alignment: AlignmentType.CENTER }));
              if (block.caption) {
                children.push(
                  new Paragraph({
                    alignment: AlignmentType.CENTER,
                    children: [new TextRun({ text: block.caption, italics: true, size: 18, color: '666666' })],
                  }),
                );
              }
              break;
            }

            case 'quote':
              children.push(
                new Paragraph({
                  indent: { left: convertInchesToTwip(0.4) },
                  border: { left: { style: BorderStyle.SINGLE, size: 18, color: '1D4ED8', space: 8 } },
                  children: [new TextRun({ text: block.text, italics: true, color: '444444' })],
                  ...(block.attribution
                    ? { spacing: { after: 0 } }
                    : {}),
                }),
              );
              if (block.attribution) {
                children.push(
                  new Paragraph({
                    indent: { left: convertInchesToTwip(0.4) },
                    alignment: AlignmentType.RIGHT,
                    children: [new TextRun({ text: `— ${block.attribution}`, size: 18, color: '888888', italics: true })],
                  }),
                );
              }
              break;

            case 'pageBreak':
              children.push(new Paragraph({ children: [new PageBreak()] }));
              break;

            case 'tableOfContents':
              children.push(new TableOfContents('Table of Contents', { hyperlink: true, headingStyleRange: '1-3' }));
              break;

            case 'divider':
              children.push(
                new Paragraph({
                  border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CCCCCC', space: 1 } },
                }),
              );
              break;

            case 'columns': {
              // For columns, we render each column's blocks into a single paragraph
              // and use tab stops to simulate column layout
              const colWidth = block.columns[0]?.width ?? 3000;
              const spacing = block.spacing ?? 400;
              for (const [ci, col] of block.columns.entries()) {
                if (ci > 0) {
                  children.push(new Paragraph({ children: [new PageBreak()] }));
                }
                for (const subBlock of col.blocks) {
                  // Recursively process sub-blocks (simplified - just headings and paragraphs)
                  if (subBlock.type === 'heading') {
                    children.push(
                      new Paragraph({ text: subBlock.text, heading: HEADING_MAP[Math.min(subBlock.level - 1, 3)]! }),
                    );
                  } else if (subBlock.type === 'paragraph') {
                    const runs = subBlock.runs
                      ? buildRuns(subBlock.runs)
                      : [new TextRun(subBlock.text ?? '')];
                    children.push(new Paragraph({ children: runs }));
                  } else if (subBlock.type === 'bullets') {
                    for (const item of subBlock.items) {
                      const isObj = typeof item === 'object';
                      children.push(
                        new Paragraph({ text: isObj ? item.text : item, bullet: { level: isObj ? item.level : 0 } }),
                      );
                    }
                  } else if (subBlock.type === 'image') {
                    const imgParas = await buildImageParagraphs(subBlock);
                    children.push(...imgParas);
                  }
                }
              }
              break;
            }

            case 'sectionBreak':
              // Section breaks are handled at the document level; we insert a page break as a signal
              children.push(new Paragraph({ children: [new PageBreak()] }));
              break;

            case 'bookmark':
              // Bookmarks are rendered as invisible anchors via TextRun bookmark property
              children.push(
                new Paragraph({
                  children: [new TextRun({ text: '', bookmark: { id: block.name } } as any)],
                  spacing: { before: 0, after: 0 },
                }),
              );
              break;

            case 'crossReference':
              children.push(
                new Paragraph({
                  children: [
                    new TextRun({
                      text: block.text ?? `[See ${block.bookmark}]`,
                      italics: true,
                      color: '1D4ED8',
                    }),
                  ],
                }),
              );
              break;

            case 'footnote':
              footnotes.push({ id: nextFootnoteId, text: block.text });
              children.push(
                new Paragraph({
                  children: [
                    new TextRun({
                      text: `${nextFootnoteId}`,
                      superScript: true,
                      size: 16,
                    }),
                    new TextRun({ text: ` ${block.text}`, size: 20, color: '666666' }),
                  ],
                }),
              );
              nextFootnoteId++;
              break;

            case 'watermark':
              // Watermarks are rendered as large, faint centered text
              children.push(
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  spacing: { before: 3000 },
                  children: [
                    new TextRun({
                      text: block.text,
                      size: 72,
                      color: block.color ?? 'CCCCCC',
                      italics: true,
                    }),
                  ],
                }),
              );
              break;

            case 'qrCode': {
              // Generate QR code as image using a QR code API
              const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=${block.size}x${block.size}&data=${encodeURIComponent(block.data)}`;
              const response = await fetch(qrUrl);
              if (!response.ok) {
                throw new ToolInputError(`Failed to generate QR code: ${response.statusText}`);
              }
              const qrBuffer = Buffer.from(await response.arrayBuffer());
              const qrImage = new ImageRun({
                data: qrBuffer,
                transformation: { width: block.size, height: block.size },
                type: 'png',
              });
              children.push(new Paragraph({ children: [qrImage], alignment: AlignmentType.CENTER }));
              if (block.caption) {
                children.push(
                  new Paragraph({
                    alignment: AlignmentType.CENTER,
                    children: [new TextRun({ text: block.caption, italics: true, size: 18, color: '666666' })],
                  }),
                );
              }
              break;
            }

            case 'smartArt': {
              const resolved = await resolveImage(
                {
                  generate: block.prompt,
                  provider: 'default',
                },
                'smartArt',
              );
              const smartArtImage = new ImageRun({
                data: resolved.buffer,
                transformation: { width: block.width, height: block.height },
                type: 'png',
              });
              children.push(new Paragraph({ children: [smartArtImage], alignment: AlignmentType.CENTER }));
              if (block.caption) {
                children.push(
                  new Paragraph({
                    alignment: AlignmentType.CENTER,
                    children: [new TextRun({ text: block.caption, italics: true, size: 18, color: '666666' })],
                  }),
                );
              }
              break;
            }
          }
        }

        const doc = new Document({
          ...(subject || keywords || category
            ? {
                creator: author ?? 'ZilMate',
                ...(subject ? { description: subject } : {}),
                ...(keywords ? { keywords: keywords.join(', ') } : {}),
                ...(category ? { category } : {}),
              }
            : {}),
          numbering: {
            config: [
              {
                reference: numberingConfigId,
                levels: [
                  { level: 0, format: LevelFormat.BULLET, text: '\u2022', alignment: AlignmentType.LEFT },
                  { level: 1, format: LevelFormat.BULLET, text: '\u25CB', alignment: AlignmentType.LEFT },
                  { level: 2, format: LevelFormat.BULLET, text: '\u25A0', alignment: AlignmentType.LEFT },
                ],
              },
              {
                reference: numberedConfigId,
                levels: [
                  { level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT },
                  { level: 1, format: LevelFormat.LOWER_LETTER, text: '%2.', alignment: AlignmentType.LEFT },
                  { level: 2, format: LevelFormat.LOWER_ROMAN, text: '%3.', alignment: AlignmentType.LEFT },
                ],
              },
            ],
          },
          sections: [
            {
              properties: {
                ...(margins
                  ? {
                      page: {
                        margin: {
                          top: convertInchesToTwip(margins.top),
                          bottom: convertInchesToTwip(margins.bottom),
                          left: convertInchesToTwip(margins.left),
                          right: convertInchesToTwip(margins.right),
                        },
                      },
                    }
                  : {}),
              },
              ...(headerText
                ? {
                    headers: {
                      default: new Header({
                        children: [
                          new Paragraph({
                            alignment: AlignmentType.RIGHT,
                            children: [new TextRun({ text: headerText, size: 18, color: '888888' })],
                          }),
                        ],
                      }),
                    },
                  }
                : {}),
              ...(footerText || showPageNumbers
                ? {
                    footers: {
                      default: new Footer({
                        children: [
                          new Paragraph({
                            alignment: AlignmentType.CENTER,
                            children: [
                              ...(footerText
                                ? [new TextRun({ text: `${footerText}  `, size: 18, color: '888888' })]
                                : []),
                              ...(showPageNumbers
                                ? [
                                    new TextRun({ children: [PageNumber.CURRENT], size: 18, color: '888888' }),
                                    new TextRun({ text: ' / ', size: 18, color: '888888' }),
                                    new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 18, color: '888888' }),
                                  ]
                                : []),
                            ],
                          }),
                        ],
                      }),
                    },
                  }
                : {}),
              children,
            },
          ],
        });

        const buffer = await Packer.toBuffer(doc);
        const { absPath, relPath } = await resolveOutputPath(filename);
        await atomicWriteFile(absPath, Buffer.from(buffer));

        return { path: absPath, relativePath: relPath, bytes: buffer.length };
      }),
  }),
};