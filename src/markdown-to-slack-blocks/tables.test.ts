/**
 * Table conversion, including the empty-leading-cell regression.
 */

import { describe, expect, test } from "vitest";
import { markdownToSlackBlocks } from "./index.js";
import { splitRow } from "./tables.js";
import { cellText, tables } from "./helpers.test-utils.js";

describe("markdown tables", () => {
  test("maps a table to a native table block, not a section of text", () => {
    const blocks = markdownToSlackBlocks(
      ["| a | b |", "|---|---|", "| 1 | 2 |"].join("\n")
    );
    const [table] = tables(blocks);
    expect(table).toBeDefined();
    expect(table?.type).toBe("table");
    expect(table?.rows).toHaveLength(2);
    expect(blocks.some((b) => b.type === "section")).toBe(false);
  });

  /**
   * REGRESSION: a header row beginning with an empty cell used to be parsed as
   * a single column, which silently dropped the real header label and then
   * truncated every body row to match.
   */
  test("preserves an empty LEADING header cell and keeps the real header label", () => {
    const md = [
      "| | corrupted output |",
      "|---|---|",
      "| without the tool | **10/10** |",
      "| with the tool | **0/10** — called it every time |",
    ].join("\n");

    const [table] = tables(markdownToSlackBlocks(md));
    expect(table).toBeDefined();

    // The header must survive as a row of TWO columns.
    expect(table?.rows).toHaveLength(3);
    const header = table?.rows[0];
    expect(header).toHaveLength(2);

    // The empty cell stays empty; the label is NOT lost.
    expect(cellText(header?.[0] ?? { type: "raw_text", text: "?" }).trim()).toBe("");
    expect(cellText(header?.[1] ?? { type: "raw_text", text: "?" })).toBe("corrupted output");

    // And the body rows keep both of their columns.
    expect(table?.rows[1]).toHaveLength(2);
    expect(cellText(table?.rows[1]?.[0] ?? { type: "raw_text", text: "?" })).toBe("without the tool");
    expect(cellText(table?.rows[1]?.[1] ?? { type: "raw_text", text: "?" })).toBe("10/10");
    expect(cellText(table?.rows[2]?.[1] ?? { type: "raw_text", text: "?" })).toContain("called it every time");

    // Every row must have identical arity or Slack rejects the block.
    const widths = new Set(table?.rows.map((r) => r.length));
    expect(widths).toEqual(new Set([2]));
  });

  test("preserves empty leading AND trailing cells", () => {
    const md = ["| | mid | |", "|---|---|---|", "| a | b | c |"].join("\n");
    const [table] = tables(markdownToSlackBlocks(md));
    expect(table?.rows[0]).toHaveLength(3);
    expect(cellText(table?.rows[0]?.[1] ?? { type: "raw_text", text: "?" })).toBe("mid");
    expect(cellText(table?.rows[0]?.[2] ?? { type: "raw_text", text: "?" }).trim()).toBe("");
  });

  test("splitRow keeps interior empties but drops outer-pipe artifacts", () => {
    expect(splitRow("| | b |")).toEqual(["", "b"]);
    expect(splitRow("| a | | c |")).toEqual(["a", "", "c"]);
    expect(splitRow("a | b")).toEqual(["a", "b"]);
  });

  test("column count comes from the widest row, so ragged rows lose nothing", () => {
    const md = [
      "| a | b |",
      "|---|---|",
      "| 1 | 2 | 3 |",
      "| 4 |",
    ].join("\n");
    const [table] = tables(markdownToSlackBlocks(md));
    // The widest row has three cells, so the table is three columns wide.
    expect(table?.rows.every((r) => r.length === 3)).toBe(true);
    expect(cellText(table?.rows[1]?.[2] ?? { type: "raw_text", text: "?" })).toBe("3");
  });

  test("alignment markers become column_settings", () => {
    const md = ["| l | c | r |", "|:---|:---:|---:|", "| 1 | 2 | 3 |"].join("\n");
    const [table] = tables(markdownToSlackBlocks(md));
    expect(table?.column_settings).toEqual([
      { align: "left" },
      { align: "center" },
      { align: "right" },
    ]);
  });

  test("an all-left table omits column_settings entirely", () => {
    const md = ["| a | b |", "|---|---|", "| 1 | 2 |"].join("\n");
    const [table] = tables(markdownToSlackBlocks(md));
    expect(table?.column_settings).toBeUndefined();
  });

  test("formatted cells become rich_text cells, plain cells stay raw_text", () => {
    const md = ["| a | b |", "|---|---|", "| plain | **bold** |"].join("\n");
    const [table] = tables(markdownToSlackBlocks(md));
    expect(table?.rows[1]?.[0]?.type).toBe("raw_text");
    const rich = table?.rows[1]?.[1];
    expect(rich?.type).toBe("rich_text");
    if (rich?.type === "rich_text") {
      const section = rich.elements[0];
      expect(section?.type).toBe("rich_text_section");
      if (section?.type === "rich_text_section") {
        expect(section.elements[0]).toMatchObject({ text: "bold", style: { bold: true } });
      }
    }
  });

  test("raw_text cells are never the empty string (Slack requires min length 1)", () => {
    const md = ["| | b |", "|---|---|", "| | 2 |"].join("\n");
    const [table] = tables(markdownToSlackBlocks(md));
    for (const row of table?.rows ?? []) {
      for (const cell of row) {
        if (cell.type === "raw_text") expect(cell.text.length).toBeGreaterThan(0);
      }
    }
  });

  test("a pipe line with no delimiter row is not a table", () => {
    const blocks = markdownToSlackBlocks("just | some | pipes");
    expect(tables(blocks)).toHaveLength(0);
  });

  test("escaped pipes stay inside the cell", () => {
    const md = ["| a | b |", "|---|---|", String.raw`| x \| y | z |`].join("\n");
    const [table] = tables(markdownToSlackBlocks(md));
    expect(table?.rows[1]).toHaveLength(2);
    expect(cellText(table?.rows[1]?.[0] ?? { type: "raw_text", text: "?" })).toBe("x | y");
  });

  test("caps rows at the documented 100-row maximum", () => {
    const rows = Array.from({ length: 150 }, (_, i) => `| r${i} | v${i} |`);
    const md = ["| a | b |", "|---|---|", ...rows].join("\n");
    const [table] = tables(markdownToSlackBlocks(md));
    expect(table?.rows.length).toBeLessThanOrEqual(100);
  });

  test("caps columns at the documented 20-column maximum", () => {
    const wide = `|${Array.from({ length: 30 }, (_, i) => ` c${i} `).join("|")}|`;
    const delim = `|${Array.from({ length: 30 }, () => "---").join("|")}|`;
    const [table] = tables(markdownToSlackBlocks([wide, delim, wide].join("\n")));
    expect(table?.rows.every((r) => r.length <= 20)).toBe(true);
  });
});
