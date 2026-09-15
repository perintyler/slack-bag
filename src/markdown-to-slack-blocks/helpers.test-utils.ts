/**
 * Test helpers: navigate emitted blocks without asserting on incidental
 * structure, so tests survive refactors that change grouping but not output.
 */

import type {
  Block,
  RichTextBlock,
  RichTextBlockElement,
  RichTextElement,
  TableBlock,
} from "./types.js";

export function richElements(blocks: Block[]): RichTextBlockElement[] {
  return blocks.flatMap((b) => (b.type === "rich_text" ? (b as RichTextBlock).elements : []));
}

export function firstOfType<T extends RichTextBlockElement["type"]>(
  blocks: Block[],
  type: T
): Extract<RichTextBlockElement, { type: T }> | undefined {
  const found = richElements(blocks).find((el) => el.type === type);
  return found as Extract<RichTextBlockElement, { type: T }> | undefined;
}

export function allOfType<T extends RichTextBlockElement["type"]>(
  blocks: Block[],
  type: T
): Extract<RichTextBlockElement, { type: T }>[] {
  return richElements(blocks).filter((el) => el.type === type) as Extract<
    RichTextBlockElement,
    { type: T }
  >[];
}

export function tables(blocks: Block[]): TableBlock[] {
  return blocks.filter((b): b is TableBlock => b.type === "table");
}

/** Flatten any rich text elements to a comparable plain string. */
export function textOf(elements: RichTextElement[]): string {
  return elements
    .map((el) => {
      switch (el.type) {
        case "text":
          return el.text;
        case "link":
          return el.text ?? el.url;
        case "emoji":
          return `:${el.name}:`;
        case "user":
          return `<@${el.user_id}>`;
        case "channel":
          return `<#${el.channel_id}>`;
      }
    })
    .join("");
}

/** Plain text of a table cell, whatever its cell type. */
export function cellText(cell: TableBlock["rows"][number][number]): string {
  if (cell.type === "raw_text") return cell.text;
  return cell.elements
    .map((el) => (el.type === "rich_text_section" ? textOf(el.elements) : ""))
    .join("");
}
