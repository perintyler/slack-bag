/**
 * Block Kit types, mirrored from the Slack specification.
 *
 * These are structural types written against the published Block Kit schema
 * (docs.slack.dev/reference/block-kit) and cross-checked field-by-field against
 * the `@slack/types` 2.22.0 declarations that ship with `@slack/web-api`.
 *
 * They are declared locally rather than imported so this directory has zero
 * runtime and zero value-level dependencies. `slack-compat.test.ts` asserts
 * structural compatibility with `@slack/web-api`'s `KnownBlock` via a
 * type-only import, so drift between these declarations and the real SDK
 * surfaces as a compile error rather than a Slack API rejection at send time.
 */

/** Style flags permitted on rich text inline elements. */
export interface RichTextStyle {
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  code?: boolean;
}

export interface RichTextText {
  type: "text";
  text: string;
  style?: RichTextStyle;
}

export interface RichTextLink {
  type: "link";
  url: string;
  text?: string;
  style?: RichTextStyle;
}

export interface RichTextEmoji {
  type: "emoji";
  name: string;
}

export interface RichTextUser {
  type: "user";
  user_id: string;
}

export interface RichTextChannel {
  type: "channel";
  channel_id: string;
}

/** Inline elements valid inside a rich_text_section / quote. */
export type RichTextElement =
  | RichTextText
  | RichTextLink
  | RichTextEmoji
  | RichTextUser
  | RichTextChannel;

export interface RichTextSection {
  type: "rich_text_section";
  elements: RichTextElement[];
}

export interface RichTextList {
  type: "rich_text_list";
  style: "bullet" | "ordered";
  elements: RichTextSection[];
  /** 0-8 per the Block Kit spec; deeper markdown nesting is clamped. */
  indent?: number;
  /**
   * Offsets the first number of an ordered list (offset 4 => list starts at 5).
   * Officially documented on the Block Kit reference, but NOT declared by
   * @slack/types 2.22.0 — the SDK types lag the platform here. Slack accepts
   * it; the typed `KnownBlock` boundary in pretty-slacker does not model it.
   */
  offset?: number;
  border?: 0 | 1;
}

export interface RichTextQuote {
  type: "rich_text_quote";
  elements: RichTextElement[];
  border?: 0 | 1;
}

/**
 * Preformatted text. Per @slack/types, `elements` accepts only text and link
 * elements — no styled/emoji children.
 */
export interface RichTextPreformatted {
  type: "rich_text_preformatted";
  elements: (RichTextText | RichTextLink)[];
  border?: 0 | 1;
}

export type RichTextBlockElement =
  | RichTextSection
  | RichTextList
  | RichTextQuote
  | RichTextPreformatted;

export interface RichTextBlock {
  type: "rich_text";
  elements: RichTextBlockElement[];
}

export interface HeaderBlock {
  type: "header";
  text: { type: "plain_text"; text: string; emoji?: boolean };
}

export interface DividerBlock {
  type: "divider";
}

export interface SectionBlock {
  type: "section";
  text: { type: "mrkdwn"; text: string };
}

export interface ContextBlock {
  type: "context";
  elements: { type: "mrkdwn"; text: string }[];
}

export interface ImageBlock {
  type: "image";
  image_url: string;
  alt_text: string;
  title?: { type: "plain_text"; text: string; emoji?: boolean };
}

/** A raw (unformatted) table cell. */
export interface RawTextElement {
  type: "raw_text";
  text: string;
}

export interface TableColumnSettings {
  align?: "left" | "center" | "right";
  is_wrapped?: boolean;
}

/**
 * Table cells are full `rich_text` BLOCKS (or `raw_text` elements) — not a
 * bare inline rich-text object. This is the shape `@slack/types` specifies:
 * `rows: (RichTextBlock | RawTextElement)[][]`.
 */
export type TableCell = RichTextBlock | RawTextElement;

export interface TableBlock {
  type: "table";
  rows: TableCell[][];
  column_settings?: TableColumnSettings[];
}

export type Block =
  | RichTextBlock
  | HeaderBlock
  | DividerBlock
  | SectionBlock
  | ContextBlock
  | ImageBlock
  | TableBlock;

/**
 * Hard limits taken from the Block Kit reference. Exceeding these makes Slack
 * reject the whole message, so the converter enforces them rather than
 * emitting payloads that only fail at send time.
 */
export const LIMITS = {
  /** Max blocks in a single chat.postMessage payload. */
  MAX_BLOCKS: 50,
  /** section.text (mrkdwn/plain_text) max length. */
  SECTION_TEXT: 3000,
  /** header.text max length. */
  HEADER_TEXT: 150,
  /** image.alt_text max length. */
  IMAGE_ALT_TEXT: 2000,
  /** rich_text_list.indent accepted range is 0-8. */
  MAX_LIST_INDENT: 8,
  /** table rows max. */
  MAX_TABLE_ROWS: 100,
  /** cells per table row max. */
  MAX_TABLE_COLUMNS: 20,
  /** aggregate characters across all cells of a table. */
  MAX_TABLE_CHARS: 10000,
} as const;
