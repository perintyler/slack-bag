/**
 * Block-level structure: headings, lists, code, quotes, rules, images.
 */

import { describe, expect, test } from "vitest";
import { markdownToSlackBlocks } from "./index.js";
import { LIMITS } from "./types.js";
import { allOfType, firstOfType, textOf } from "./helpers.test-utils.js";

describe("headings", () => {
  test("h1 and h2 become native header blocks", () => {
    const blocks = markdownToSlackBlocks("# One\n\n## Two");
    const headers = blocks.filter((b) => b.type === "header");
    expect(headers).toHaveLength(2);
    expect(headers[0]).toMatchObject({
      type: "header",
      text: { type: "plain_text", text: "One", emoji: true },
    });
  });

  test("h3-h6 become bold rich text so the hierarchy is not flattened", () => {
    const blocks = markdownToSlackBlocks("### Three");
    expect(blocks.some((b) => b.type === "header")).toBe(false);
    const section = firstOfType(blocks, "rich_text_section");
    expect(section?.elements[0]).toMatchObject({ text: "Three", style: { bold: true } });
  });

  test("header text is truncated to Slack's 150-character ceiling", () => {
    const blocks = markdownToSlackBlocks(`# ${"x".repeat(400)}`);
    const header = blocks.find((b) => b.type === "header");
    if (header?.type !== "header") throw new Error("expected header");
    expect(header.text.text.length).toBeLessThanOrEqual(LIMITS.HEADER_TEXT);
  });

  test("headers are plain_text, so inline markup is flattened not leaked", () => {
    const blocks = markdownToSlackBlocks("# A **bold** title");
    const header = blocks.find((b) => b.type === "header");
    if (header?.type !== "header") throw new Error("expected header");
    expect(header.text.text).toBe("A bold title");
  });

  test("useHeaderBlocks:false downgrades headings to bold rich text", () => {
    const blocks = markdownToSlackBlocks("# One", { useHeaderBlocks: false });
    expect(blocks.some((b) => b.type === "header")).toBe(false);
  });
});

describe("lists", () => {
  test("bullets become a rich_text_list, not bullet characters in text", () => {
    const blocks = markdownToSlackBlocks("- a\n- b");
    const list = firstOfType(blocks, "rich_text_list");
    expect(list?.style).toBe("bullet");
    expect(list?.elements).toHaveLength(2);
    expect(textOf(list?.elements[0]?.elements ?? [])).toBe("a");
    // The literal bullet glyph must not appear in the text.
    expect(textOf(list?.elements[0]?.elements ?? [])).not.toContain("•");
  });

  test("ordered lists use style:ordered without numbering in the text", () => {
    const list = firstOfType(markdownToSlackBlocks("1. a\n2. b"), "rich_text_list");
    expect(list?.style).toBe("ordered");
    expect(textOf(list?.elements[0]?.elements ?? [])).toBe("a");
  });

  test("an ordered list starting at N sets offset", () => {
    const list = firstOfType(markdownToSlackBlocks("5. five\n6. six"), "rich_text_list");
    expect(list?.offset).toBe(4);
  });

  test("nested lists become separate lists carrying an indent level", () => {
    const blocks = markdownToSlackBlocks("- a\n  - b\n    - c");
    const lists = allOfType(blocks, "rich_text_list");
    expect(lists.map((l) => l.indent ?? 0)).toEqual([0, 1, 2]);
  });

  test("deep nesting is clamped to the maximum indent Slack accepts", () => {
    const md = Array.from({ length: 14 }, (_, i) => `${" ".repeat(i * 2)}- level ${i}`).join("\n");
    const lists = allOfType(markdownToSlackBlocks(md), "rich_text_list");
    for (const list of lists) {
      expect(list.indent ?? 0).toBeLessThanOrEqual(LIMITS.MAX_LIST_INDENT);
    }
  });

  test("mixed inline formatting survives inside list items", () => {
    const list = firstOfType(markdownToSlackBlocks("- **bold** and `code`"), "rich_text_list");
    const els = list?.elements[0]?.elements ?? [];
    expect(els.some((e) => e.type === "text" && e.style?.bold === true)).toBe(true);
    expect(els.some((e) => e.type === "text" && e.style?.code === true)).toBe(true);
  });

  test("switching bullet -> ordered at the same depth starts a new list", () => {
    const lists = allOfType(markdownToSlackBlocks("- a\n1. b"), "rich_text_list");
    expect(lists.map((l) => l.style)).toEqual(["bullet", "ordered"]);
  });
});

describe("code blocks", () => {
  test("fenced code becomes rich_text_preformatted", () => {
    const pre = firstOfType(markdownToSlackBlocks("```\nhello\n```"), "rich_text_preformatted");
    expect(pre?.elements[0]).toMatchObject({ type: "text", text: "hello" });
  });

  test("a language tag does not leak into the code body", () => {
    const pre = firstOfType(markdownToSlackBlocks("```js\nconst x=1;\n```"), "rich_text_preformatted");
    expect(pre?.elements[0]?.text).toBe("const x=1;");
  });

  test("~~~ fences are supported", () => {
    const pre = firstOfType(markdownToSlackBlocks("~~~\nplain\n~~~"), "rich_text_preformatted");
    expect(pre?.elements[0]?.text).toBe("plain");
  });

  test("an unterminated fence still emits the code collected so far", () => {
    const pre = firstOfType(markdownToSlackBlocks("```\nno end here"), "rich_text_preformatted");
    expect(pre?.elements[0]?.text).toBe("no end here");
  });

  test("code content is never html-escaped or markdown-parsed", () => {
    const pre = firstOfType(
      markdownToSlackBlocks("```\nif (a & b < c) **x**\n```"),
      "rich_text_preformatted"
    );
    expect(pre?.elements[0]?.text).toBe("if (a & b < c) **x**");
  });

  test("code containing backticks survives inside a fence", () => {
    const pre = firstOfType(markdownToSlackBlocks("```\nlet s = `tpl`;\n```"), "rich_text_preformatted");
    expect(pre?.elements[0]?.text).toBe("let s = `tpl`;");
  });

  test("indented code becomes preformatted too", () => {
    const pre = firstOfType(markdownToSlackBlocks("    indented line"), "rich_text_preformatted");
    expect(pre?.elements[0]?.text).toBe("indented line");
  });

  test("blank lines inside a fence are preserved", () => {
    const pre = firstOfType(markdownToSlackBlocks("```\na\n\nb\n```"), "rich_text_preformatted");
    expect(pre?.elements[0]?.text).toBe("a\n\nb");
  });
});

describe("blockquotes", () => {
  test("a blockquote becomes rich_text_quote", () => {
    const quote = firstOfType(markdownToSlackBlocks("> hi"), "rich_text_quote");
    expect(textOf(quote?.elements ?? [])).toBe("hi");
  });

  test("a multi-line blockquote is one quote element", () => {
    const blocks = markdownToSlackBlocks("> one\n> two");
    expect(allOfType(blocks, "rich_text_quote")).toHaveLength(1);
    expect(textOf(firstOfType(blocks, "rich_text_quote")?.elements ?? [])).toBe("one\ntwo");
  });

  test("inline formatting works inside a blockquote", () => {
    const quote = firstOfType(markdownToSlackBlocks("> **bold** quote"), "rich_text_quote");
    expect(quote?.elements.some((e) => e.type === "text" && e.style?.bold === true)).toBe(true);
  });
});

describe("rules and images", () => {
  test("--- *** ___ all become dividers", () => {
    for (const rule of ["---", "***", "___"]) {
      const blocks = markdownToSlackBlocks(`a\n\n${rule}\n\nb`);
      expect(blocks.some((b) => b.type === "divider")).toBe(true);
    }
  });

  test("a standalone image becomes an image block with alt text", () => {
    const blocks = markdownToSlackBlocks("![a cat](https://example.com/c.png)");
    expect(blocks[0]).toMatchObject({
      type: "image",
      image_url: "https://example.com/c.png",
      alt_text: "a cat",
    });
  });

  test("an image with no alt text still gets non-empty alt_text", () => {
    const blocks = markdownToSlackBlocks("![](https://example.com/c.png)");
    if (blocks[0]?.type !== "image") throw new Error("expected image");
    expect(blocks[0].alt_text.length).toBeGreaterThan(0);
  });

  test("an inline image inside a sentence degrades to a link, not a dropped node", () => {
    const blocks = markdownToSlackBlocks("text ![alt](https://example.com/i.png) more");
    const section = firstOfType(blocks, "rich_text_section");
    const link = section?.elements.find((e) => e.type === "link");
    expect(link).toMatchObject({ url: "https://example.com/i.png", text: "alt" });
  });
});
