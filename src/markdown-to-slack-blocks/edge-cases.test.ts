/**
 * Degenerate and hostile inputs. The bar is "never produces a payload Slack
 * would reject, and never throws".
 */

import { describe, expect, test } from "vitest";
import { markdownToSlackBlocks, chunkText } from "./index.js";
import { LIMITS } from "./types.js";
import { allOfType, firstOfType, tables, textOf } from "./helpers.test-utils.js";

describe("degenerate input", () => {
  test("empty input yields no blocks", () => {
    expect(markdownToSlackBlocks("")).toEqual([]);
  });

  test("whitespace-only input yields no blocks", () => {
    expect(markdownToSlackBlocks("   \n\n \t \n")).toEqual([]);
  });

  test("CRLF line endings parse identically to LF", () => {
    const lf = markdownToSlackBlocks("# T\n\n- a\n- b");
    const crlf = markdownToSlackBlocks("# T\r\n\r\n- a\r\n- b");
    expect(crlf).toEqual(lf);
  });

  test("lone CR line endings are handled", () => {
    const blocks = markdownToSlackBlocks("# T\r\r- a");
    expect(blocks.some((b) => b.type === "header")).toBe(true);
  });

  test("no stray carriage returns survive into output text", () => {
    const json = JSON.stringify(markdownToSlackBlocks("a\r\nb\r\n\r\n- c\r\n"));
    expect(json).not.toContain("\\r");
  });

  test("a table with only a header and delimiter still emits that header", () => {
    const [table] = tables(markdownToSlackBlocks("| a | b |\n|---|---|"));
    expect(table?.rows).toHaveLength(1);
  });

  test("malformed table rows never throw", () => {
    expect(() => markdownToSlackBlocks("|||\n|---|\n||")).not.toThrow();
  });

  test("unicode and emoji characters survive", () => {
    const blocks = markdownToSlackBlocks("héllo wörld 🎉 日本語");
    expect(textOf(firstOfType(blocks, "rich_text_section")?.elements ?? [])).toContain("🎉");
  });

  test("a lone '#' is not a heading", () => {
    const blocks = markdownToSlackBlocks("#");
    expect(blocks.some((b) => b.type === "header")).toBe(false);
  });
});

describe("Slack hard limits", () => {
  test("never exceeds the 50-block message ceiling", () => {
    const md = Array.from({ length: 400 }, (_, i) => `# H${i}`).join("\n\n");
    expect(markdownToSlackBlocks(md).length).toBeLessThanOrEqual(LIMITS.MAX_BLOCKS);
  });

  test("maxBlocks option is honoured", () => {
    const md = Array.from({ length: 40 }, (_, i) => `# H${i}`).join("\n\n");
    expect(markdownToSlackBlocks(md, { maxBlocks: 5 })).toHaveLength(5);
  });

  test("a very long paragraph is chunked below the per-text ceiling", () => {
    const long = "word ".repeat(3000);
    const blocks = markdownToSlackBlocks(long);
    for (const section of allOfType(blocks, "rich_text_section")) {
      for (const el of section.elements) {
        if (el.type === "text") expect(el.text.length).toBeLessThanOrEqual(LIMITS.SECTION_TEXT);
      }
    }
  });

  test("a very long code block is chunked rather than truncated", () => {
    const code = Array.from({ length: 900 }, (_, i) => `line ${i} of code`).join("\n");
    const blocks = markdownToSlackBlocks("```\n" + code + "\n```");
    const pres = allOfType(blocks, "rich_text_preformatted");
    expect(pres.length).toBeGreaterThan(1);
    for (const pre of pres) {
      for (const el of pre.elements) {
        expect(el.text?.length ?? 0).toBeLessThanOrEqual(LIMITS.SECTION_TEXT);
      }
    }
    // Content is preserved across the chunk boundary, not dropped.
    const joined = pres.map((p) => p.elements.map((e) => e.text ?? "").join("")).join("");
    expect(joined).toContain("line 899 of code");
  });

  test("chunkText breaks on boundaries and loses no characters", () => {
    const text = "alpha beta gamma delta ".repeat(50);
    const chunks = chunkText(text, 100);
    expect(chunks.every((c) => c.length <= 100)).toBe(true);
    expect(chunks.join(" ").replace(/\s+/g, " ").trim()).toBe(text.replace(/\s+/g, " ").trim());
  });

  test("a huge table stays within the aggregate character budget", () => {
    const row = `| ${"x".repeat(300)} | ${"y".repeat(300)} |`;
    const md = ["| a | b |", "|---|---|", ...Array.from({ length: 60 }, () => row)].join("\n");
    const [table] = tables(markdownToSlackBlocks(md));
    const total = JSON.stringify(table?.rows ?? []).length;
    expect(total).toBeLessThanOrEqual(LIMITS.MAX_TABLE_CHARS * 1.5);
  });
});

describe("mixed documents", () => {
  test("a document using every construct produces only valid block types", () => {
    const md = [
      "# Title",
      "",
      "Intro with **bold**, *italic*, `code`, [link](https://e.com) and https://bare.example.com",
      "",
      "## Section",
      "",
      "- bullet **one**",
      "  - nested `two`",
      "",
      "1. first",
      "2. second",
      "",
      "> quoted **text**",
      "",
      "```py",
      "x = 1 & 2",
      "```",
      "",
      "| a | b |",
      "|:--|--:|",
      "| 1 | **2** |",
      "",
      "---",
      "",
      "![img](https://e.com/i.png)",
    ].join("\n");

    const blocks = markdownToSlackBlocks(md);
    const valid = new Set(["rich_text", "header", "divider", "section", "context", "image", "table"]);
    for (const block of blocks) expect(valid.has(block.type)).toBe(true);

    expect(blocks.some((b) => b.type === "header")).toBe(true);
    expect(blocks.some((b) => b.type === "table")).toBe(true);
    expect(blocks.some((b) => b.type === "divider")).toBe(true);
    expect(blocks.some((b) => b.type === "image")).toBe(true);
    expect(allOfType(blocks, "rich_text_list").length).toBeGreaterThan(0);
    expect(allOfType(blocks, "rich_text_preformatted").length).toBe(1);
    expect(allOfType(blocks, "rich_text_quote").length).toBe(1);
  });

  test("a heading immediately after a list does not merge into it", () => {
    const blocks = markdownToSlackBlocks("- a\n# H");
    expect(blocks.some((b) => b.type === "header")).toBe(true);
    expect(allOfType(blocks, "rich_text_list")).toHaveLength(1);
  });

  test("converting is deterministic", () => {
    const md = "# A\n\n- x\n\n| a |\n|---|\n| 1 |";
    expect(markdownToSlackBlocks(md)).toEqual(markdownToSlackBlocks(md));
  });

  test("no block ever carries an empty required elements array", () => {
    const md = "# T\n\n\n\n> \n\n- \n\n```\n```\n";
    for (const block of markdownToSlackBlocks(md)) {
      if (block.type === "rich_text") expect(block.elements.length).toBeGreaterThan(0);
    }
  });
});
