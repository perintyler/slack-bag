/**
 * Markdown pipe tables -> Block Kit `table` blocks.
 *
 * Slack ships a real `table` block, so tables map to native structure rather
 * than being flattened into a monospaced `section`. Cells are `rich_text`
 * blocks when they carry formatting and `raw_text` when they do not.
 */

import { flattenToPlainText, parseInline } from "./inline.js";
import {
  LIMITS,
  type RichTextElement,
  type TableBlock,
  type TableCell,
  type TableColumnSettings,
} from "./types.js";

/** A table's delimiter row, e.g. `|:---|---:|:--:|`. */
const DELIMITER_CELL = /^:?-{1,}:?$/;

/**
 * Split a markdown table row into cells.
 *
 * This is where the empty-leading-cell bug lived. Splitting `| | b |` on `|`
 * yields ["", " ", " b ", ""] — the FIRST and LAST entries are the artifacts of
 * the outer pipes and are the only ones that may be dropped. Any interior
 * empty string is a legitimate empty cell and MUST be preserved. Filtering all
 * empty strings collapses `| | corrupted output |` to a single column, which
 * then truncates every other row and silently loses a real header label.
 */
export function splitRow(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let i = 0;
  const trimmed = line.trim();

  while (i < trimmed.length) {
    const ch = trimmed[i];
    if (ch === "\\" && trimmed[i + 1] === "|") {
      // An escaped pipe is cell content, not a separator.
      current += "|";
      i += 2;
      continue;
    }
    if (ch === "|") {
      cells.push(current);
      current = "";
      i += 1;
      continue;
    }
    current += ch ?? "";
    i += 1;
  }
  cells.push(current);

  // Drop ONLY the boundary artifacts produced by leading/trailing pipes.
  if (trimmed.startsWith("|")) cells.shift();
  if (trimmed.endsWith("|") && cells.length > 0 && !trimmed.endsWith("\\|")) cells.pop();

  return cells.map((c) => c.trim());
}

/** True when the line is a table delimiter row (and yields the alignments). */
export function parseDelimiterRow(line: string): TableColumnSettings[] | null {
  const cells = splitRow(line);
  if (cells.length === 0) return null;
  const settings: TableColumnSettings[] = [];
  for (const cell of cells) {
    if (!DELIMITER_CELL.test(cell)) return null;
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");
    if (left && right) settings.push({ align: "center" });
    else if (right) settings.push({ align: "right" });
    else settings.push({ align: "left" });
  }
  return settings;
}

function toCell(source: string): TableCell {
  const elements: RichTextElement[] = parseInline(source);

  // An unformatted cell is cheaper and renders identically as raw_text.
  const isPlain = elements.every((el) => el.type === "text" && el.style === undefined);
  if (isPlain) {
    const text = flattenToPlainText(elements);
    // raw_text has a documented minimum length of 1 character, so a genuinely
    // empty cell (legal markdown) is emitted as a single space rather than "".
    return { type: "raw_text", text: text === "" ? " " : text };
  }

  return {
    type: "rich_text",
    elements: [{ type: "rich_text_section", elements }],
  };
}

function cellLength(cell: TableCell): number {
  if (cell.type === "raw_text") return cell.text.length;
  return JSON.stringify(cell).length;
}

/**
 * Build a `table` block from the raw markdown rows (header row, delimiter
 * alignments, body rows).
 *
 * Column count is the width of the WIDEST row — never the header alone — so a
 * ragged table keeps every cell any row provided. Short rows are padded with
 * empty cells so every row has equal arity, which Slack requires.
 */
export function buildTable(
  rawRows: string[][],
  alignments: TableColumnSettings[]
): TableBlock | null {
  if (rawRows.length === 0) return null;

  const columnCount = Math.min(
    Math.max(...rawRows.map((r) => r.length), alignments.length),
    LIMITS.MAX_TABLE_COLUMNS
  );
  if (columnCount === 0) return null;

  const rows: TableCell[][] = [];
  let charBudget = 0;

  for (const raw of rawRows.slice(0, LIMITS.MAX_TABLE_ROWS)) {
    const row: TableCell[] = [];
    for (let c = 0; c < columnCount; c++) {
      row.push(toCell(raw[c] ?? ""));
    }
    const rowChars = row.reduce((sum, cell) => sum + cellLength(cell), 0);
    // Slack rejects the whole message past 10k chars of table content; stop
    // adding rows rather than emitting a payload that cannot send.
    if (charBudget + rowChars > LIMITS.MAX_TABLE_CHARS && rows.length > 0) break;
    charBudget += rowChars;
    rows.push(row);
  }

  if (rows.length === 0) return null;

  const table: TableBlock = { type: "table", rows };
  const settings = alignments.slice(0, columnCount);
  // Only emit column_settings when at least one column is non-default.
  if (settings.some((s) => s.align !== undefined && s.align !== "left")) {
    table.column_settings = settings;
  }
  return table;
}
