// src/tools/csv.tool.ts
// Requires: npm install papaparse
// Note: if using TS, also `npm install -D @types/papaparse`
import { tool } from 'ai';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import Papa from 'papaparse';
import { assertReadableFile, resolveOutputPath, atomicWriteFile, ToolInputError, safeExecute } from './lib/outputPaths.js';
import { emitProgress } from '../runtime/progress.js';

const MAX_ROWS_HARD_CAP = 100_000;
const MAX_CSV_BYTES = 25 * 1024 * 1024; // 25MB
const MAX_COLUMNS = 500;

// OWASP CSV/formula-injection guard: a cell opened in Excel/Sheets that starts
// with =, +, -, @, or tab/CR can execute as a formula. Prefixing with a single
// quote forces spreadsheet apps to treat it as literal text, and we still
// write the visible value unchanged (quote is invisible in the cell).
const FORMULA_TRIGGER_RE = /^[=+\-@\t\r]/;

function sanitizeCell(value: string | number | boolean | null): string | number | boolean | null {
  if (typeof value !== 'string') return value;
  return FORMULA_TRIGGER_RE.test(value) ? `'${value}` : value;
}

export const csvTools = {
  parseCsv: tool({
    description:
      'Parse a CSV file from disk into headers + rows, with size/row/column limits enforced and parse errors surfaced explicitly rather than silently dropped. Returns success:false with a clear message if the file is missing, too large, or malformed beyond recovery.',
    inputSchema: z.object({
      path: z.string().min(1),
      hasHeader: z.boolean().default(true),
      maxRows: z.number().int().min(1).max(MAX_ROWS_HARD_CAP).optional(),
    }),
    execute: async ({ path: filePath, hasHeader, maxRows }) =>
      safeExecute(async () => {
        await assertReadableFile(filePath, { maxBytes: MAX_CSV_BYTES, label: 'CSV file' });

        const raw = await readFile(filePath, 'utf-8');
        const parsed = Papa.parse<Record<string, string> | string[]>(raw, {
          header: hasHeader,
          skipEmptyLines: true,
        });

        // Papa doesn't throw on malformed rows, it collects errors — but a
        // high error ratio usually means wrong delimiter/encoding, not a few
        // bad rows, so we treat that as a hard failure instead of returning
        // garbage silently.
        if (parsed.errors.length > 0 && parsed.errors.length > parsed.data.length * 0.1) {
          throw new ToolInputError(
            `CSV parsing produced ${parsed.errors.length} errors across ${parsed.data.length} rows — likely wrong delimiter or encoding. First error: ${parsed.errors[0]!.message} (row ${parsed.errors[0]!.row})`,
          );
        }

        const fieldCount = hasHeader ? parsed.meta.fields?.length ?? 0 : (parsed.data[0] as string[] | undefined)?.length ?? 0;
        if (fieldCount > MAX_COLUMNS) {
          throw new ToolInputError(`CSV has ${fieldCount} columns, exceeding the ${MAX_COLUMNS}-column limit.`);
        }

        const cap = maxRows ?? MAX_ROWS_HARD_CAP;
        const truncated = parsed.data.length > cap;
        const rows = truncated ? parsed.data.slice(0, cap) : parsed.data;

        return {
          headers: hasHeader ? parsed.meta.fields ?? [] : undefined,
          rowCount: rows.length,
          totalRowsInFile: parsed.data.length,
          truncated,
          rows,
          parseErrors: parsed.errors,
        };
      }),
  }),

  writeCsv: tool({
    description:
      'Write tabular data (headers + rows) to a CSV file. Automatically neutralizes formula-injection payloads (cells starting with =, +, -, @) so the file is safe to open in Excel/Sheets, validates that every row matches the header column count, and writes atomically so a crash never leaves a half-written file. Returns success:false with a clear message on validation failure.',
    inputSchema: z.object({
      filename: z.string().min(1).max(200).describe('Base filename, e.g. "export.csv"'),
      headers: z.array(z.string().min(1)).min(1).max(MAX_COLUMNS),
      rows: z.array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()]))).max(MAX_ROWS_HARD_CAP),
    }),
    execute: async ({ filename, headers, rows }) =>
      safeExecute(async () => {
        const badRowIndex = rows.findIndex((r) => r.length !== headers.length);
        if (badRowIndex !== -1) {
          throw new ToolInputError(
            `Row ${badRowIndex + 1} has ${rows[badRowIndex]!.length} cells but there are ${headers.length} headers — every row must match the header count.`,
          );
        }

        emitProgress({ type: 'step', label: 'Writing CSV', detail: filename });

        const sanitizedRows = rows.map((row) => row.map(sanitizeCell));
        const csv = Papa.unparse({ fields: headers, data: sanitizedRows });

        const { absPath, relPath } = await resolveOutputPath(filename);
        await atomicWriteFile(absPath, csv);

        return { path: absPath, relativePath: relPath, rowCount: rows.length };
      }),
  }),
};