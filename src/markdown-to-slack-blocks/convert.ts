/**
 * Block-level markdown -> Block Kit blocks.
 *
 * Design bias: prefer NATIVE structural blocks over flattening to mrkdwn
 * `section` text. Lists become `rich_text_list` (with real nesting via
 * `indent`), fenced code becomes `rich_text_preformatted`, blockquotes become
 * `rich_text_quote`, and pipe tables become real `table` blocks. A `section`
 * with mrkdwn is used only where Block Kit offers nothing better.
 */

import { escapeMrkdwn, flattenToPlainText, parseInline } from "./inline.js";
import { buildTable, parseDelimiterRow, splitRow } from "./tables.js";
import {
  LIMITS,
  type Block,
  type RichTextBlockElement,
  type RichTextElement,
  type RichTextList,
  type RichTextSection,
  type TableColumnSettings,
} from "./types.js";

export interface ConvertOptions {
  /**
   * Emit `header` blocks for markdown headings (default true). Slack headers
   * are plain_text only — no bold/links/code survive inside them — so callers
   * who need formatted headings can turn this off to get bold sections.
   */
  useHeaderBlocks?: boolean;
  /**
   * Maximum blocks to emit. Defaults to Slack's per-message cap of 50.
   */
  maxBlocks?: number;
  /**
   * Emit `image` blocks for standalone images (default true).
   */
  useImageBlocks?: boolean;
}

const HEADING = /^(#{1,6})\s+(.*)$/;
const FENCE = /^(\s{0,3})(`{3,}|~{3,})\s*([^\s`]*)\s*$/;
const HR = /^\s{0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/;
const BULLET = /^(\s*)([-*+])\s+(.*)$/;
const ORDERED = /^(\s*)(\d{1,9})[.)]\s+(.*)$/;
const BLOCKQUOTE = /^(\s{0,3})>\s?(.*)$/;
const STANDALONE_IMAGE = /^!\[([^\]]*)\]\(([^\s)]+(?:\([^)]*\)[^\s)]*)*)\s*(?:"[^"]*")?\)$/;
const INDENTED_CODE = /^(?: {4}|\t)(.*)$/;

interface ListItem {
  /** Nesting depth, 0-based. */
  depth: number;
  ordered: boolean;
  elements: RichTextElement[];
  /** Starting number of the list this item belongs to. */
  start: number;
}

/** Normalize line endings; CRLF and lone CR both become LF. */
function normalizeLines(markdown: string): string[] {
  return markdown.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

/**
 * Group flat list items into nested `rich_text_list` blocks.
 *
 * Slack expresses nesting with a flat sequence of lists carrying an `indent`
 * level (0-8) rather than by embedding lists inside items, so consecutive runs
 * of items at the same depth+style collapse into one list element.
 */
function buildLists(items: ListItem[]): RichTextBlockElement[] {
  const out: RichTextBlockElement[] = [];
  let current: RichTextList | null = null;
  let currentDepth = -1;
  let currentOrdered = false;

  for (const item of items) {
    const indent = Math.min(item.depth, LIMITS.MAX_LIST_INDENT);
    const section: RichTextSection = {
      type: "rich_text_section",
      elements: item.elements,
    };

    if (current !== null && currentDepth === indent && currentOrdered === item.ordered) {
      current.elements.push(section);
      continue;
    }

    const list: RichTextList = {
      type: "rich_text_list",
      style: item.ordered ? "ordered" : "bullet",
      elements: [section],
    };
    if (indent > 0) list.indent = indent;
    // Honour a list that starts at something other than 1 (e.g. "5.").
    if (item.ordered && item.start > 1) list.offset = item.start - 1;

    out.push(list);
    current = list;
    currentDepth = indent;
    currentOrdered = item.ordered;
  }

  return out;
}

/**
 * Split text into chunks that fit a Block Kit length limit, preferring to
 * break on line and then word boundaries so we never cut mid-word.
 */
export function chunkText(text: string, limit: number): string[] {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > limit) {
    let cut = remaining.lastIndexOf("\n", limit);
    if (cut <= 0) cut = remaining.lastIndexOf(" ", limit);
    if (cut <= 0) cut = limit;
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).replace(/^[\n ]/, "");
  }
  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}

/**
 * Split rich text elements so that no single emitted element exceeds Slack's
 * per-text ceiling. Long code blocks and paragraphs are the realistic cause.
 */
function chunkElements(elements: RichTextElement[], limit: number): RichTextElement[][] {
  const groups: RichTextElement[][] = [];
  let group: RichTextElement[] = [];
  let size = 0;

  for (const el of elements) {
    const length = el.type === "text" ? el.text.length : el.type === "link" ? (el.text ?? el.url).length : 8;

    if (el.type === "text" && length > limit) {
      // A single oversized text run must itself be split.
      for (const piece of chunkText(el.text, limit)) {
        if (size > 0) {
          groups.push(group);
          group = [];
          size = 0;
        }
        const node: RichTextElement = el.style ? { type: "text", text: piece, style: el.style } : { type: "text", text: piece };
        groups.push([node]);
      }
      continue;
    }

    if (size + length > limit && group.length > 0) {
      groups.push(group);
      group = [];
      size = 0;
    }
    group.push(el);
    size += length;
  }

  if (group.length > 0) groups.push(group);
  return groups.length > 0 ? groups : [[]];
}

/**
 * Convert markdown into Block Kit blocks.
 */
export function convert(markdown: string, options: ConvertOptions = {}): Block[] {
  const useHeaders = options.useHeaderBlocks ?? true;
  const useImages = options.useImageBlocks ?? true;
  const maxBlocks = options.maxBlocks ?? LIMITS.MAX_BLOCKS;

  const lines = normalizeLines(markdown);
  const blocks: Block[] = [];

  /** Rich text elements pending flush into a rich_text block. */
  let richBuffer: RichTextBlockElement[] = [];
  /** Paragraph lines pending inline parsing. */
  let paragraph: string[] = [];
  let listItems: ListItem[] = [];
  let quoteLines: string[] = [];

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return;
    const text = paragraph.join("\n");
    paragraph = [];
    const elements = parseInline(text);
    if (elements.length === 0) return;
    for (const group of chunkElements(elements, LIMITS.SECTION_TEXT)) {
      if (group.length > 0) richBuffer.push({ type: "rich_text_section", elements: group });
    }
  };

  const flushList = (): void => {
    if (listItems.length === 0) return;
    richBuffer.push(...buildLists(listItems));
    listItems = [];
  };

  const flushQuote = (): void => {
    if (quoteLines.length === 0) return;
    // A multi-line blockquote is ONE quote element with newlines preserved,
    // which is how Slack renders a continuous quoted passage.
    const elements = parseInline(quoteLines.join("\n"));
    quoteLines = [];
    if (elements.length > 0) richBuffer.push({ type: "rich_text_quote", elements });
  };

  const flushRich = (): void => {
    flushParagraph();
    flushList();
    flushQuote();
    if (richBuffer.length === 0) return;
    blocks.push({ type: "rich_text", elements: richBuffer });
    richBuffer = [];
  };

  /** Flush only the inline accumulators, keeping the rich_text block open. */
  const flushInline = (): void => {
    flushParagraph();
    flushList();
    flushQuote();
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";

    // --- Fenced code block -------------------------------------------------
    const fence = FENCE.exec(line);
    if (fence && fence[2] !== undefined) {
      const marker = fence[2];
      const fenceChar = marker[0] ?? "`";
      const codeLines: string[] = [];
      let closed = false;
      i += 1;
      for (; i < lines.length; i++) {
        const candidate = lines[i] ?? "";
        const closing = new RegExp(`^\\s{0,3}\\${fenceChar}{${marker.length},}\\s*$`);
        if (closing.test(candidate)) {
          closed = true;
          break;
        }
        codeLines.push(candidate);
      }
      // An unterminated fence still yields the code collected so far rather
      // than swallowing the remainder of the message.
      void closed;
      flushInline();
      const code = codeLines.join("\n");
      for (const piece of chunkText(code, LIMITS.SECTION_TEXT)) {
        richBuffer.push({
          type: "rich_text_preformatted",
          elements: [{ type: "text", text: piece }],
        });
      }
      continue;
    }

    // --- Heading -----------------------------------------------------------
    const heading = HEADING.exec(line);
    if (heading && heading[1] !== undefined && heading[2] !== undefined) {
      flushRich();
      const level = heading[1].length;
      const inline = parseInline(heading[2].trim());
      const plain = flattenToPlainText(inline).trim();
      if (plain === "") continue;

      if (useHeaders && level <= 2) {
        blocks.push({
          type: "header",
          text: {
            type: "plain_text",
            text: plain.slice(0, LIMITS.HEADER_TEXT),
            emoji: true,
          },
        });
      } else {
        // h3-h6 render as bold rich text: a `header` block has one visual
        // weight, so using it for every level would flatten the hierarchy.
        blocks.push({
          type: "rich_text",
          elements: [
            {
              type: "rich_text_section",
              elements: inline.map((el) =>
                el.type === "text"
                  ? { type: "text", text: el.text, style: { ...(el.style ?? {}), bold: true } }
                  : el
              ),
            },
          ],
        });
      }
      continue;
    }

    // --- Horizontal rule ---------------------------------------------------
    if (HR.test(line) && line.trim() !== "") {
      flushRich();
      blocks.push({ type: "divider" });
      continue;
    }

    // --- Table -------------------------------------------------------------
    // A table is a header row followed by a delimiter row.
    if (line.includes("|") && i + 1 < lines.length) {
      const alignments = parseDelimiterRow(lines[i + 1] ?? "");
      if (alignments !== null) {
        const headerCells = splitRow(line);
        if (headerCells.length > 0) {
          const rawRows: string[][] = [headerCells];
          i += 2;
          for (; i < lines.length; i++) {
            const bodyLine = lines[i] ?? "";
            if (bodyLine.trim() === "" || !bodyLine.includes("|")) break;
            rawRows.push(splitRow(bodyLine));
          }
          i -= 1;
          flushRich();
          const table = buildTable(rawRows, alignments);
          if (table) blocks.push(table);
          continue;
        }
      }
    }

    // --- Standalone image --------------------------------------------------
    const image = STANDALONE_IMAGE.exec(line.trim());
    if (image && image[2] !== undefined && useImages) {
      flushRich();
      const alt = (image[1] ?? "").trim();
      blocks.push({
        type: "image",
        image_url: image[2],
        alt_text: (alt === "" ? "image" : alt).slice(0, LIMITS.IMAGE_ALT_TEXT),
      });
      continue;
    }

    // --- Blockquote --------------------------------------------------------
    const quote = BLOCKQUOTE.exec(line);
    if (quote && quote[2] !== undefined) {
      flushParagraph();
      flushList();
      quoteLines.push(quote[2]);
      continue;
    }
    if (quoteLines.length > 0 && line.trim() !== "") {
      // Lazy continuation: a bare line directly after `>` stays in the quote.
      quoteLines.push(line.trim());
      continue;
    }
    flushQuote();

    // --- Lists -------------------------------------------------------------
    const bullet = BULLET.exec(line);
    const ordered = ORDERED.exec(line);
    if (bullet ?? ordered) {
      flushParagraph();
      const indentText = (bullet?.[1] ?? ordered?.[1] ?? "").replace(/\t/g, "    ");
      const content = bullet?.[3] ?? ordered?.[3] ?? "";
      const start = ordered?.[2] !== undefined ? Number.parseInt(ordered[2], 10) : 1;
      listItems.push({
        // Two spaces per level is the common authoring convention; four-space
        // indents therefore also land on clean levels.
        depth: Math.floor(indentText.length / 2),
        ordered: ordered !== null,
        elements: parseInline(content),
        start,
      });
      continue;
    }

    // A blank line terminates the current paragraph/list/quote grouping.
    if (line.trim() === "") {
      flushInline();
      continue;
    }

    // --- Indented code (only outside a list context) -----------------------
    const indented = INDENTED_CODE.exec(line);
    if (indented && indented[1] !== undefined && paragraph.length === 0 && listItems.length === 0) {
      const codeLines: string[] = [indented[1]];
      for (; i + 1 < lines.length; i++) {
        const next = lines[i + 1] ?? "";
        const m = INDENTED_CODE.exec(next);
        if (m && m[1] !== undefined) codeLines.push(m[1]);
        else if (next.trim() === "") codeLines.push("");
        else break;
      }
      while (codeLines.length > 0 && codeLines[codeLines.length - 1] === "") codeLines.pop();
      flushInline();
      richBuffer.push({
        type: "rich_text_preformatted",
        elements: [{ type: "text", text: codeLines.join("\n") }],
      });
      continue;
    }

    // --- Continuation of a list item --------------------------------------
    if (listItems.length > 0) {
      const last = listItems[listItems.length - 1];
      if (last !== undefined) {
        last.elements.push({ type: "text", text: "\n" }, ...parseInline(line.trim()));
        continue;
      }
    }

    paragraph.push(line);
  }

  flushRich();

  // Slack rejects a payload with more than MAX_BLOCKS blocks outright.
  return blocks.slice(0, maxBlocks);
}

/**
 * Build a plain-text fallback for the message `text` field — what shows in
 * notifications and to screen readers. Structural markup is stripped rather
 * than left as raw pipes and hashes.
 */
export function plainTextFallback(markdown: string, limit = 300): string {
  const text = normalizeLines(markdown)
    .filter((line) => !parseDelimiterRow(line))
    .map((line) => {
      const heading = HEADING.exec(line);
      if (heading?.[2] !== undefined) return heading[2];
      if (HR.test(line) && line.trim() !== "") return "";
      // Render table rows as " a | b " without the outer pipe scaffolding.
      if (line.includes("|")) {
        const cells = splitRow(line);
        if (cells.length > 1) return cells.join(" | ");
      }
      const bullet = BULLET.exec(line);
      if (bullet?.[3] !== undefined) return bullet[3];
      const ordered = ORDERED.exec(line);
      if (ordered?.[3] !== undefined) return ordered[3];
      const quote = BLOCKQUOTE.exec(line);
      if (quote?.[2] !== undefined) return quote[2];
      if (FENCE.test(line)) return "";
      return line;
    })
    .join("\n");
  const flattened = flattenToPlainText(parseInline(text)).replace(/\n{2,}/g, "\n").trim();
  return escapeMrkdwn(flattened.slice(0, limit));
}
