// XLSX comes in as rows and is mapped by the same code as CSV. Each sheet is a table with
// a header row. A sheet with nothing on it is skipped. Cell values are read as the text
// the sheet holds: a number keeps its digits, a date becomes a UTC time, nothing is
// rounded or coerced here. The universal reader runs on the page's thread, which a
// 100 MB workbook will feel. A worker build is a later change, not a different mapping.

import readXlsxFile from "read-excel-file/universal";
import { ingestRowSets, type IngestResult, type RowSet } from "./ingest";

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

/** Records from the bytes of an .xlsx file. */
export async function ingestXlsx(bytes: ArrayBuffer): Promise<IngestResult> {
  let sheets: { sheet: string; data: unknown[][] }[];
  try {
    sheets = await readXlsxFile(bytes);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "it could not be read";
    return { ok: false, errors: [{ where: null, message: `This is not a readable .xlsx file: ${reason}.` }] };
  }

  const sets: RowSet[] = sheets
    .map(({ sheet, data }) => ({
      label: `Sheet "${sheet}"`,
      rows: data.map((row) => row.map(cellText)),
    }))
    .filter((set) => set.rows.some((row) => row.some((cell) => cell.trim() !== "")));

  if (sets.length === 0) {
    return { ok: false, errors: [{ where: null, message: "The workbook has no data. Put a header row and records on a sheet." }] };
  }
  return ingestRowSets("xlsx", sets.length === 1 ? [{ ...sets[0], label: null }] : sets);
}
