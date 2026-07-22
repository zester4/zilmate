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
} from 'docx';
import { resolveOutputPath } from './lib/outputPaths.js';
import { emitProgress } from '../runtime/progress.js';

// ---------- schema ----------

const runSchema = z.object({
  text: z.string(),
  bold: z.boolean().optional(),
  italics: z.boolean().optional(),
  underline: z.boolean().optional(),
  color: z.string().optional().describe('Hex color without #, e.g. "1D4ED8"'),
  size: z.number().int().optional().describe('Font size in half-points, e.g. 24 = 12pt'),
  link: z.string().url().optional().describe('If set, renders this run as a hyperlink'),
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

const blockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('heading'), text: z.string(), level: z.number().int().min(1).max(4).default(1) }),
  z.object({
    type: z.literal('paragraph'),
    runs: z.array(runSchema).min(1).optional(),
    text: z.string().optional().describe('Shorthand for a single plain run; ignored if `runs` is set'),
    alignment: alignmentSchema.optional(),
    spacingAfter: z.number().int().optional().describe('Twips of space after paragraph'),
  }),
  z.object({ type: z.literal('bullets'), items: z.array(bulletItemSchema).min(1) }),
  z.object({ type: z.literal('numbered'), items: z.array(bulletItemSchema).min(1) }),
  z.object({
    type: z.literal('table'),
    headers: z.array(z.string()).min(1),
    rows: z.array(z.array(z.string())).min(1),
    headerColor: z.string().optional().describe('Hex without #, default light blue'),
  }),
  z.object({
    type: z.literal('image'),
    path: z.string().describe('Absolute path to a local image file (png/jpg)'),
    width: z.number().int().default(500).describe('Width in pixels'),
    height: z.number().int().default(300).describe('Height in pixels'),
    caption: z.string().optional(),
  }),
  z.object({ type: z.literal('quote'), text: z.string() }),
  z.object({ type: z.literal('pageBreak') }),
  z.object({ type: z.literal('tableOfContents') }),
  z.object({ type: z.literal('divider') }),
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
      ...(r.color ? { color: r.color } : {}),
      ...(r.size ? { size: r.size } : {}),
    });
    if (r.link) {
      return new ExternalHyperlink({ link: r.link, children: [textRun] });
    }
    return textRun;
  });
}

async function buildImageParagraphs(block: Extract<z.infer<typeof blockSchema>, { type: 'image' }>) {
  const data = await readFile(block.path);
  const imageRun = new ImageRun({
    data,
    transformation: { width: block.width, height: block.height },
    type: block.path.toLowerCase().endsWith('.png') ? 'png' : 'jpg',
  });
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

const HEADING_MAP = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4];

export const docxTools = {
  createDocx: tool({
    description:
      'Generate a Word (.docx) document with rich formatting: headings, styled/hyperlinked paragraphs, bulleted and numbered lists (with nesting), tables, embedded local images with captions, block quotes, page breaks, dividers, and an optional auto-generated table of contents. Supports running headers/footers with page numbers, custom page margins, and a title page. Use for reports, memos, proposals, or handoff docs delivered as Word files.',
    inputSchema: z.object({
      filename: z.string().min(1).describe('Base filename, e.g. "incident-report.docx"'),
      title: z.string().optional(),
      subtitle: z.string().optional(),
      author: z.string().optional(),
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
    }),
    execute: async ({ filename, title, subtitle, author, blocks, headerText, footerText, showPageNumbers, margins }) => {
      emitProgress({ type: 'step', label: 'Generating Word document', detail: filename });

      const children: (Paragraph | Table | TableOfContents)[] = [];

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
            children.push(
              new Paragraph({
                children: runs,
                ...(block.alignment ? { alignment: ALIGN_MAP[block.alignment] } : {}),
                ...(block.spacingAfter ? { spacing: { after: block.spacingAfter } } : {}),
              }),
            );
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
                    (row) =>
                      new TableRow({ children: row.map((cell) => new TableCell({ children: [new Paragraph(cell)] })) }),
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

          case 'quote':
            children.push(
              new Paragraph({
                indent: { left: convertInchesToTwip(0.4) },
                border: { left: { style: BorderStyle.SINGLE, size: 18, color: '1D4ED8', space: 8 } },
                children: [new TextRun({ text: block.text, italics: true, color: '444444' })],
              }),
            );
            break;

          case 'pageBreak':
            children.push(new Paragraph({ children: [new PageBreak()] }));
            break;

          case 'tableOfContents':
            children.push(new TableOfContents('Table of Contents', { hyperlink: true, headingStyleRange: '1-3' }));
            break;

          case 'divider':
            children.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CCCCCC', space: 1 } } }));
            break;
        }
      }

      const doc = new Document({
        numbering: {
          config: [
            {
              reference: numberingConfigId,
              levels: [{ level: 0, format: LevelFormat.BULLET, text: '\u2022', alignment: AlignmentType.LEFT }],
            },
            {
              reference: numberedConfigId,
              levels: [
                { level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT },
                { level: 1, format: LevelFormat.LOWER_LETTER, text: '%2.', alignment: AlignmentType.LEFT },
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
                            ...(footerText ? [new TextRun({ text: `${footerText}  `, size: 18, color: '888888' })] : []),
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
      await writeFile(absPath, buffer);

      return { path: absPath, relativePath: relPath, bytes: buffer.length };
    },
  }),
};