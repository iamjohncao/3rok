import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { ingestXlsx } from "./ingest-xlsx";

// A minimal .xlsx written by hand: a zip of XML parts, inline strings, plain numbers.
type Cell = string | number | null;

function columnName(index: number): string {
  return String.fromCharCode(65 + index);
}

function sheetXml(rows: Cell[][]): string {
  const body = rows
    .map((row, r) => {
      const cells = row
        .map((value, c) => {
          const ref = `${columnName(c)}${r + 1}`;
          if (value === null) return "";
          if (typeof value === "number") return `<c r="${ref}"><v>${value}</v></c>`;
          const text = value.replace(/&/g, "&amp;").replace(/</g, "&lt;");
          return `<c r="${ref}" t="inlineStr"><is><t>${text}</t></is></c>`;
        })
        .join("");
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

function workbook(sheets: { name: string; rows: Cell[][] }[]): ArrayBuffer {
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets
        .map(
          (_, i) =>
            `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
        )
        .join("")}</Types>`,
    ),
    "_rels/.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ),
    "xl/workbook.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets
        .map((s, i) => `<sheet name="${s.name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
        .join("")}</sheets></workbook>`,
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
        .map(
          (_, i) =>
            `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
        )
        .join("")}</Relationships>`,
    ),
  };
  sheets.forEach((s, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(s.rows));
  });
  const zipped = zipSync(files);
  return zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer;
}

const HEADER = [
  "record_id",
  "record_type",
  "chip_family",
  "part_number",
  "test_or_model",
  "particle_or_stress",
  "split",
  "source_url",
  "value_status",
  "source",
  "standard",
  "facility",
  "date",
  "units",
];
const row = (id: string, split = "train"): Cell[] => [
  id,
  "provenance",
  "Jetson Orin",
  "AGX",
  "Test report",
  null,
  split,
  "https://example.com/report",
  "measured",
  "Test report",
  "ESCC 22900",
  "Co-60 cell",
  "2024-05-01",
  "krad(Si)",
];

describe("ingestXlsx", () => {
  it("maps a one-sheet workbook the way the same table in a CSV would map", async () => {
    const result = await ingestXlsx(workbook([{ name: "Records", rows: [HEADER, row("p1"), row("p2", "holdout")] }]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.format).toBe("xlsx");
    expect(result.records.map((r) => [r.record_id, r.split, r.value_status])).toEqual([
      ["p1", "train", "measured"],
      ["p2", "holdout", "measured"],
    ]);
    expect(result.records[0].particle_or_stress).toBeNull();
    expect(JSON.parse(result.records[0].body)).toEqual({
      source: "Test report",
      standard: "ESCC 22900",
      facility: "Co-60 cell",
      date: "2024-05-01",
      units: "krad(Si)",
    });
  });

  it("keeps a number's digits and does not invent a split", async () => {
    const bad = row("p1", "");
    const result = await ingestXlsx(workbook([{ name: "Records", rows: [[...HEADER, "dose"], [...bad, 12.5]] }]));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((e) => e.message).join(" ")).toContain("split");
  });

  it("reads a numeric cell as the number it holds", async () => {
    const result = await ingestXlsx(workbook([{ name: "Records", rows: [[...HEADER, "dose"], [...row("p1"), 12.5]] }]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.parse(result.records[0].body).dose).toBe("12.5");
  });

  it("names the sheet and row when a sheet is wrong, and skips an empty sheet", async () => {
    const broken = row("p2");
    broken[8] = "guessed";
    const result = await ingestXlsx(
      workbook([
        { name: "Notes", rows: [] },
        { name: "Good", rows: [HEADER, row("p1")] },
        { name: "Bad", rows: [HEADER, broken] },
      ]),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0].where).toBe('Sheet "Bad", row 2');
    expect(result.errors[0].message).toContain("value_status");
  });

  it("refuses a workbook with no data", async () => {
    const result = await ingestXlsx(workbook([{ name: "Empty", rows: [] }]));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0].message).toContain("no data");
  });

  it("refuses bytes that are not a workbook, in a sentence", async () => {
    const result = await ingestXlsx(new TextEncoder().encode("a,b\n1,2").buffer as ArrayBuffer);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0].message).toContain("not a readable .xlsx file");
  });
});
