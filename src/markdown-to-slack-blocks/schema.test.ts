/**
 * Validates emitted blocks against the REAL Block Kit schema.
 *
 * Two layers:
 *  1. A runtime validator encoding the field rules from the Block Kit
 *     reference — a test asserting a shape Slack would reject is worthless.
 *  2. A compile-time assignment to `@slack/web-api`'s `KnownBlock` (type-only
 *     import), so structural drift from the official SDK types fails the build.
 */

import { describe, expect, test } from "vitest";
import type { KnownBlock } from "@slack/web-api";
import { markdownToSlackBlocks } from "./index.js";
import type { Block } from "./types.js";

const RICH_INLINE = new Set(["text", "link", "emoji", "user", "channel", "usergroup", "date", "broadcast", "color"]);
const STYLE_KEYS = new Set(["bold", "italic", "strike", "code", "underline"]);

function validateInline(el: unknown, path: string, errors: string[]): void {
  if (typeof el !== "object" || el === null) {
    errors.push(`${path}: not an object`);
    return;
  }
  const node = el as Record<string, unknown>;
  const type = node["type"];
  if (typeof type !== "string" || !RICH_INLINE.has(type)) {
    errors.push(`${path}: invalid inline element type ${String(type)}`);
    return;
  }
  if (type === "text") {
    if (typeof node["text"] !== "string") errors.push(`${path}: text element needs a string 'text'`);
    if (node["text"] === "") errors.push(`${path}: text element must not be empty`);
  }
  if (type === "link" && typeof node["url"] !== "string") {
    errors.push(`${path}: link element needs a string 'url'`);
  }
  if (type === "emoji" && typeof node["name"] !== "string") {
    errors.push(`${path}: emoji element needs a string 'name'`);
  }
  const style = node["style"];
  if (style !== undefined) {
    if (typeof style !== "object" || style === null) {
      errors.push(`${path}: style must be an object`);
    } else {
      for (const key of Object.keys(style)) {
        if (!STYLE_KEYS.has(key)) errors.push(`${path}: unknown style key '${key}'`);
        if (typeof (style as Record<string, unknown>)[key] !== "boolean") {
          errors.push(`${path}: style.${key} must be boolean`);
        }
      }
    }
  }
}

function validateRichElement(el: unknown, path: string, errors: string[]): void {
  const node = el as Record<string, unknown>;
  const type = node["type"];
  switch (type) {
    case "rich_text_section":
    case "rich_text_quote": {
      const elements = node["elements"];
      if (!Array.isArray(elements) || elements.length === 0) {
        errors.push(`${path}: ${String(type)} needs a non-empty elements array`);
        return;
      }
      elements.forEach((child, i) => validateInline(child, `${path}.elements[${i}]`, errors));
      return;
    }
    case "rich_text_preformatted": {
      const elements = node["elements"];
      if (!Array.isArray(elements) || elements.length === 0) {
        errors.push(`${path}: preformatted needs a non-empty elements array`);
        return;
      }
      elements.forEach((child, i) => {
        const c = child as Record<string, unknown>;
        // Per @slack/types, only text and link are permitted here.
        if (c["type"] !== "text" && c["type"] !== "link") {
          errors.push(`${path}.elements[${i}]: preformatted allows only text/link, got ${String(c["type"])}`);
        }
        validateInline(child, `${path}.elements[${i}]`, errors);
      });
      return;
    }
    case "rich_text_list": {
      const style = node["style"];
      if (style !== "bullet" && style !== "ordered") {
        errors.push(`${path}: list style must be bullet|ordered, got ${String(style)}`);
      }
      const indent = node["indent"];
      if (indent !== undefined) {
        if (typeof indent !== "number" || indent < 0 || indent > 8) {
          errors.push(`${path}: list indent must be 0-8, got ${String(indent)}`);
        }
      }
      const elements = node["elements"];
      if (!Array.isArray(elements) || elements.length === 0) {
        errors.push(`${path}: list needs a non-empty elements array`);
        return;
      }
      elements.forEach((child, i) => {
        const c = child as Record<string, unknown>;
        // A list's children MUST be rich_text_section objects.
        if (c["type"] !== "rich_text_section") {
          errors.push(`${path}.elements[${i}]: list children must be rich_text_section`);
        }
        validateRichElement(child, `${path}.elements[${i}]`, errors);
      });
      return;
    }
    default:
      errors.push(`${path}: invalid rich_text child type ${String(type)}`);
  }
}

/** Validate a full block list against the Block Kit schema. */
export function validateBlocks(blocks: Block[]): string[] {
  const errors: string[] = [];

  if (blocks.length > 50) errors.push(`too many blocks: ${blocks.length}`);

  blocks.forEach((block, bi) => {
    const path = `blocks[${bi}]`;
    switch (block.type) {
      case "rich_text": {
        if (!Array.isArray(block.elements) || block.elements.length === 0) {
          errors.push(`${path}: rich_text needs a non-empty elements array`);
          return;
        }
        block.elements.forEach((el, i) => validateRichElement(el, `${path}.elements[${i}]`, errors));
        return;
      }
      case "header": {
        if (block.text.type !== "plain_text") errors.push(`${path}: header text must be plain_text`);
        if (block.text.text.length === 0) errors.push(`${path}: header text must not be empty`);
        if (block.text.text.length > 150) errors.push(`${path}: header text exceeds 150 chars`);
        return;
      }
      case "section": {
        if (block.text.text.length > 3000) errors.push(`${path}: section text exceeds 3000 chars`);
        if (block.text.text.length === 0) errors.push(`${path}: section text must not be empty`);
        return;
      }
      case "image": {
        if (typeof block.image_url !== "string" || block.image_url === "") {
          errors.push(`${path}: image needs an image_url`);
        }
        if (typeof block.alt_text !== "string" || block.alt_text === "") {
          errors.push(`${path}: image needs non-empty alt_text`);
        }
        if (block.alt_text.length > 2000) errors.push(`${path}: alt_text exceeds 2000 chars`);
        return;
      }
      case "table": {
        if (block.rows.length === 0) errors.push(`${path}: table needs rows`);
        if (block.rows.length > 100) errors.push(`${path}: table exceeds 100 rows`);
        const widths = new Set(block.rows.map((r) => r.length));
        if (widths.size > 1) errors.push(`${path}: ragged table rows: ${[...widths].join(",")}`);
        block.rows.forEach((row, ri) => {
          if (row.length > 20) errors.push(`${path}.rows[${ri}]: exceeds 20 columns`);
          row.forEach((cell, ci) => {
            const cellPath = `${path}.rows[${ri}][${ci}]`;
            if (cell.type === "raw_text") {
              if (typeof cell.text !== "string" || cell.text.length === 0) {
                errors.push(`${cellPath}: raw_text needs a non-empty string (min length 1)`);
              }
            } else if (cell.type === "rich_text") {
              // A table cell must be a full rich_text BLOCK.
              if (!Array.isArray(cell.elements) || cell.elements.length === 0) {
                errors.push(`${cellPath}: rich_text cell needs elements`);
              } else {
                cell.elements.forEach((el, i) =>
                  validateRichElement(el, `${cellPath}.elements[${i}]`, errors)
                );
              }
            } else {
              errors.push(`${cellPath}: invalid cell type`);
            }
          });
        });
        const settings = block.column_settings;
        if (settings !== undefined) {
          if (settings.length > 20) errors.push(`${path}: column_settings exceeds 20 items`);
          for (const s of settings) {
            if (s.align !== undefined && !["left", "center", "right"].includes(s.align)) {
              errors.push(`${path}: invalid align ${String(s.align)}`);
            }
          }
        }
        return;
      }
      case "divider":
        return;
      case "context": {
        if (block.elements.length === 0) errors.push(`${path}: context needs elements`);
        return;
      }
    }
  });

  return errors;
}

const SAMPLES: Record<string, string> = {
  heading: "# Title\n\n## Sub\n\n### Deep",
  paragraph: "Plain **bold** *italic* `code` ~~strike~~ [l](https://e.com)",
  lists: "- a\n  - b\n    - c\n\n1. one\n2. two",
  deepList: Array.from({ length: 14 }, (_, i) => `${" ".repeat(i * 2)}- l${i}`).join("\n"),
  code: "```js\nconst a = 1 & 2;\n```",
  unterminated: "```\nno close",
  quote: "> a\n> b",
  table: "| | corrupted output |\n|---|---|\n| a | **b** |",
  raggedTable: "| a | b |\n|---|---|\n| 1 | 2 | 3 |\n| 4 |",
  alignTable: "| l | c | r |\n|:--|:-:|--:|\n| 1 | 2 | 3 |",
  image: "![alt](https://e.com/i.png)",
  rule: "a\n\n---\n\nb",
  escapes: "a & b < c > d",
  emoji: "ship :rocket: 🎉",
  crlf: "# T\r\n\r\n- a\r\n- b",
  longText: "word ".repeat(3000),
  longCode: "```\n" + Array.from({ length: 900 }, (_, i) => `line ${i}`).join("\n") + "\n```",
  empty: "",
  whitespace: "   \n\t\n",
  malformedTable: "|||\n|---|\n||",
  everything: [
    "# T", "", "para **b**", "", "- x", "  - y", "", "> q", "",
    "```\ncode\n```", "", "| a | b |", "|---|---|", "| 1 | 2 |", "", "---",
  ].join("\n"),
};

describe("Block Kit schema conformance", () => {
  for (const [name, md] of Object.entries(SAMPLES)) {
    test(`'${name}' produces a schema-valid payload`, () => {
      expect(validateBlocks(markdownToSlackBlocks(md))).toEqual([]);
    });
  }

  test("the validator actually rejects known-invalid payloads", () => {
    // A validator that cannot fail is worse than none.
    expect(
      validateBlocks([{ type: "header", text: { type: "plain_text", text: "x".repeat(200) } }])
    ).not.toEqual([]);
    expect(validateBlocks([{ type: "rich_text", elements: [] }])).not.toEqual([]);
    expect(
      validateBlocks([
        { type: "table", rows: [[{ type: "raw_text", text: "a" }], [{ type: "raw_text", text: "b" }, { type: "raw_text", text: "c" }]] },
      ])
    ).not.toEqual([]);
    expect(validateBlocks([{ type: "table", rows: [[{ type: "raw_text", text: "" }]] }])).not.toEqual([]);
  });

  test("output is assignable to the official @slack/web-api KnownBlock type", () => {
    // Compile-time proof: if our local Block types drift from the SDK's, this
    // assignment stops compiling under the repo typecheck.
    const blocks: KnownBlock[] = markdownToSlackBlocks(SAMPLES["everything"] ?? "");
    expect(blocks.length).toBeGreaterThan(0);
  });
});
